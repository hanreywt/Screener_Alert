import { BINANCE_HOSTS } from "./config";
import type { Candle } from "./types";

async function binanceGet(path: string, params: Record<string, string>) {
  const qs = new URLSearchParams(params).toString();
  let lastErr: unknown;
  for (const host of BINANCE_HOSTS) {
    try {
      const res = await fetch(`${host}${path}?${qs}`, {
        // always fresh — this is realtime market data
        cache: "no-store",
        headers: { "User-Agent": "quant-sr-engine/1.0" },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(`Binance request failed: ${String(lastErr)}`);
}

const MAX_KLINES_PER_REQ = 1000; // Binance hard cap on /klines `limit`

const toCandle = (k: unknown[]): Candle => ({
  time: Math.floor(Number(k[0]) / 1000),
  open: Number(k[1]),
  high: Number(k[2]),
  low: Number(k[3]),
  close: Number(k[4]),
  volume: Number(k[5]),
  takerBuy: Number(k[9]), // taker-buy base volume — powers the order-flow note
});

export async function getKlines(
  symbol: string,
  interval: string,
  limit: number,
): Promise<Candle[]> {
  const raw = (await binanceGet("/api/v3/klines", {
    symbol,
    interval,
    limit: String(Math.min(limit, MAX_KLINES_PER_REQ)),
  })) as unknown[][];

  return raw.map(toCandle);
}

/**
 * Fetch the most recent `limit` candles, paging backwards when `limit` exceeds
 * Binance's 1000-per-request cap. Walks `endTime` back to just before the
 * earliest bar already collected, so pages join without gaps or overlap.
 */
export async function getKlinesPaged(
  symbol: string,
  interval: string,
  limit: number,
): Promise<Candle[]> {
  const out: Candle[] = [];
  let endTime: number | undefined;

  while (out.length < limit) {
    const want = Math.min(MAX_KLINES_PER_REQ, limit - out.length);
    const params: Record<string, string> = {
      symbol,
      interval,
      limit: String(want),
    };
    if (endTime != null) params.endTime = String(endTime);

    const raw = (await binanceGet("/api/v3/klines", params)) as unknown[][];
    if (!raw.length) break; // no history left — return what we have

    out.unshift(...raw.map(toCandle));
    endTime = Number(raw[0][0]) - 1; // just before the earliest bar we now hold
    if (raw.length < want) break; // exchange had fewer bars than asked
  }

  return out;
}

/** Duration of one candle, per interval. */
export const TF_MS: Record<string, number> = {
  "1m": 6e4,
  "5m": 3e5,
  "15m": 9e5,
  "1h": 36e5,
  "4h": 144e5,
  "1d": 864e5,
  "1w": 6048e5,
};

/**
 * Index of the last CLOSED candle — chosen by close time, never by position.
 *
 * The tempting shortcut is `length - 2` ("the last one is still forming"). That
 * breaks at exactly the moment we care about: the daily cron fires at 00:00 UTC,
 * the instant the period rolls, and Binance may not have created the new forming
 * candle yet. Then the final element IS closed, `length - 2` points a full day
 * back, and the report is either mislabelled or silently suppressed by the
 * once-per-day guard. Ask "has this candle's period elapsed?" instead.
 */
export function lastClosedIndex(
  candles: Candle[],
  interval: string,
  now: number = Date.now(),
): number {
  const ms = TF_MS[interval];
  if (!ms) return candles.length - 2; // unknown interval: fall back
  for (let i = candles.length - 1; i >= 0; i--) {
    if (candles[i].time * 1000 + ms <= now) return i;
  }
  return -1;
}

export async function getPrice(symbol: string): Promise<number> {
  const j = (await binanceGet("/api/v3/ticker/price", { symbol })) as {
    price: string;
  };
  return Number(j.price);
}

export function atr(candles: Candle[], period = 14): number {
  if (candles.length < period + 1) return 0;
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const prev = candles[i - 1];
    const tr = Math.max(
      c.high - c.low,
      Math.abs(c.high - prev.close),
      Math.abs(c.low - prev.close),
    );
    trs.push(tr);
  }
  const last = trs.slice(-period);
  return last.reduce((a, b) => a + b, 0) / last.length;
}
