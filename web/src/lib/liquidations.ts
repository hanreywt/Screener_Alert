import { getRedis } from "./redisClient";
import { LIQ_ALERT } from "./config";

export interface LiqCluster {
  price: number;
  notionalUsd: number;
  side: "long" | "short"; // long-liqs sit below price, short-liqs above
}

export interface LiqMap {
  clusters: LiqCluster[]; // sorted by proximity to current price
  bias: number; // -1..+1: >0 = short-liq magnet above dominates (upside pull)
  samples: number; // how many OI samples backed this (warm-up indicator)
}

// Assumed leverage distribution (weights sum to 1). Higher leverage → liq
// closer to entry. A guess — the whole liq map is an estimate.
const LEVERAGE: [number, number][] = [
  [10, 0.2],
  [25, 0.35],
  [50, 0.3],
  [100, 0.15],
];
const MAX_SAMPLES = 3000; // ~4 days at 2-min cadence
const BIN_FRAC = 0.0025; // 0.25% price bins
const WINDOW = 0.25; // only clusters within ±25% of price matter
const MIN_SAMPLES = 5;

interface Sample {
  ts: number;
  oiUsd: number;
  price: number;
}

/** Append one OI observation for a symbol (called once per cron tick). */
export async function recordOiSample(
  symbol: string,
  oiUsd: number,
  price: number,
): Promise<void> {
  const r = getRedis();
  if (!r || !Number.isFinite(oiUsd) || !Number.isFinite(price)) return;
  await r.lpush(`oi:hist:${symbol}`, JSON.stringify([Date.now(), oiUsd, price]));
  await r.ltrim(`oi:hist:${symbol}`, 0, MAX_SAMPLES - 1);
}

async function loadSamples(symbol: string): Promise<Sample[]> {
  const r = getRedis();
  if (!r) return [];
  const raw = await r.lrange(`oi:hist:${symbol}`, 0, MAX_SAMPLES - 1);
  const arr = raw
    .map((x) => (typeof x === "string" ? JSON.parse(x) : x))
    .map((a: [number, number, number]) => ({ ts: a[0], oiUsd: a[1], price: a[2] }));
  return arr.reverse(); // chronological (lpush stored newest first)
}

/**
 * Pure liq-density estimator. For each *increase* in OI, assume new leveraged
 * notional opened at that price, split 50/50 long/short across leverage
 * buckets; a position at P with leverage L liquidates at P·(1∓1/L). Accumulate
 * into price bins and pull out the biggest clusters near current price.
 */
export function estimateLiquidations(
  samples: Sample[],
  currentPrice: number,
): LiqMap {
  if (samples.length < MIN_SAMPLES || currentPrice <= 0) {
    return { clusters: [], bias: 0, samples: samples.length };
  }
  const binSize = currentPrice * BIN_FRAC;
  const longDens = new Map<number, number>();
  const shortDens = new Map<number, number>();
  const add = (m: Map<number, number>, price: number, n: number) => {
    const b = Math.round(price / binSize) * binSize;
    m.set(b, (m.get(b) ?? 0) + n);
  };

  for (let i = 1; i < samples.length; i++) {
    const d = samples[i].oiUsd - samples[i - 1].oiUsd;
    if (d <= 0) continue; // only new positions create liq levels
    const P = samples[i].price;
    for (const [L, w] of LEVERAGE) {
      const n = d * w * 0.5;
      add(longDens, P * (1 - 1 / L), n);
      add(shortDens, P * (1 + 1 / L), n);
    }
  }

  const lo = currentPrice * (1 - WINDOW);
  const hi = currentPrice * (1 + WINDOW);
  const topOf = (m: Map<number, number>, side: "long" | "short") =>
    [...m.entries()]
      .filter(([p]) => p >= lo && p <= hi)
      .map(([price, notionalUsd]) => ({ price, notionalUsd, side }))
      .sort((a, b) => b.notionalUsd - a.notionalUsd)
      .slice(0, 5);

  const longC = topOf(longDens, "long").filter((c) => c.price < currentPrice);
  const shortC = topOf(shortDens, "short").filter((c) => c.price > currentPrice);
  const clusters = [...longC, ...shortC].sort(
    (a, b) => Math.abs(a.price - currentPrice) - Math.abs(b.price - currentPrice),
  );

  const nearShort = shortC.reduce((a, c) => a + c.notionalUsd, 0);
  const nearLong = longC.reduce((a, c) => a + c.notionalUsd, 0);
  const bias =
    nearShort + nearLong > 0 ? (nearShort - nearLong) / (nearShort + nearLong) : 0;

  return {
    clusters,
    bias: Math.round(bias * 100) / 100,
    samples: samples.length,
  };
}

/** Read stored samples and compute the current liq map for a symbol. */
export async function getLiqMap(
  symbol: string,
  currentPrice: number,
): Promise<LiqMap> {
  return estimateLiquidations(await loadSamples(symbol), currentPrice);
}

export interface LiqAlert {
  symbol: string;
  side: "long" | "short";
  price: number; // where the cluster sits
  notionalUsd: number; // ESTIMATED notional — see estimateLiquidations
  distPct: number; // absolute distance from current price, in percent
  currentPrice: number;
}

/**
 * Pick the biggest cluster per side that clears the size floor.
 *
 * Size alone is the gate — deliberately no proximity condition. Clusters are
 * built only from OI increases at prices we actually sampled, so they sit near
 * recent price BY CONSTRUCTION; a "within X%" filter would pass nearly always
 * and tell you nothing. Notional is the part that varies meaningfully.
 *
 * Pure — no Redis, no clock. Cooldown is applied separately.
 */
export function findLiqAlerts(
  symbol: string,
  map: LiqMap,
  currentPrice: number,
): LiqAlert[] {
  if (currentPrice <= 0) return [];
  const out: LiqAlert[] = [];
  for (const side of ["long", "short"] as const) {
    const best = map.clusters
      .filter((c) => c.side === side && c.notionalUsd >= LIQ_ALERT.minNotionalUsd)
      .sort((a, b) => b.notionalUsd - a.notionalUsd)[0];
    if (!best) continue;
    out.push({
      symbol,
      side,
      price: best.price,
      notionalUsd: best.notionalUsd,
      distPct: (Math.abs(best.price - currentPrice) / currentPrice) * 100,
      currentPrice,
    });
  }
  return out;
}

/**
 * Drop alerts fired for the same symbol+side within the cooldown, and mark the
 * survivors. Keyed per SIDE so a long-cluster alert can't mute a short one.
 * Without Redis nothing is suppressed (same degradation as dedupe.ts).
 */
export async function filterLiqCooldown(alerts: LiqAlert[]): Promise<LiqAlert[]> {
  const r = getRedis();
  if (!r) return alerts;
  const fresh: LiqAlert[] = [];
  for (const a of alerts) {
    const set = await r.set(`liq:alert:${a.symbol}:${a.side}`, Date.now(), {
      nx: true,
      ex: LIQ_ALERT.cooldownSec,
    });
    if (set === "OK") fresh.push(a);
  }
  return fresh;
}

/** Largest estimated cluster per side, for observability (JSON response only —
 *  lets you watch the real distribution without waiting on an alert to fire). */
export function topClusterUsd(map: LiqMap): { long: number; short: number } {
  const top = (side: "long" | "short") =>
    Math.round(
      map.clusters
        .filter((c) => c.side === side)
        .reduce((m, c) => Math.max(m, c.notionalUsd), 0),
    );
  return { long: top("long"), short: top("short") };
}

const usd = (n: number) => (n >= 1e9 ? `$${(n / 1e9).toFixed(1)}B` : `$${(n / 1e6).toFixed(0)}M`);
const px = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: n < 10 ? 4 : 0 });

/** One-line human summary of the liq map, or null if still warming up. */
export function formatLiqNote(m: LiqMap): string | null {
  if (m.clusters.length === 0) {
    return m.samples < MIN_SAMPLES ? null : "liq map warming up";
  }
  const nearest = m.clusters[0];
  const arrow = nearest.side === "short" ? "⬆️ magnet" : "⬇️ magnet";
  const biasTxt = m.bias > 0.15 ? " · net upside pull" : m.bias < -0.15 ? " · net downside pull" : "";
  return `${arrow} ${px(nearest.price)} (${usd(nearest.notionalUsd)})${biasTxt}`;
}
