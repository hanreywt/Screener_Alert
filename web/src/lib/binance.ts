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

export async function getKlines(
  symbol: string,
  interval: string,
  limit: number,
): Promise<Candle[]> {
  const raw = (await binanceGet("/api/v3/klines", {
    symbol,
    interval,
    limit: String(limit),
  })) as unknown[][];

  return raw.map((k) => ({
    time: Math.floor(Number(k[0]) / 1000),
    open: Number(k[1]),
    high: Number(k[2]),
    low: Number(k[3]),
    close: Number(k[4]),
    volume: Number(k[5]),
  }));
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
