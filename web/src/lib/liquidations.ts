import { getRedis } from "./redisClient";

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
