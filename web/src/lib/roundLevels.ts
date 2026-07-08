import { getRedis } from "./redisClient";

export interface LevelCross {
  symbol: string;
  level: number; // the round level that was crossed, e.g. 63000
  direction: "up" | "down";
  price: number; // current price
}

/**
 * Pure crossing logic: given the previous and current confirmed bucket index
 * (floor(price/step)), return every round level crossed between them.
 * Exported for testing.
 */
export function computeCrosses(
  prevBucket: number,
  curBucket: number,
  step: number,
  symbol: string,
  price: number,
): LevelCross[] {
  if (prevBucket === curBucket) return [];
  const direction: "up" | "down" = curBucket > prevBucket ? "up" : "down";
  const levels: number[] = [];
  if (direction === "up") {
    for (let b = prevBucket + 1; b <= curBucket; b++) levels.push(b * step);
  } else {
    for (let b = prevBucket; b > curBucket; b--) levels.push(b * step);
  }
  return levels.map((level) => ({ symbol, level, direction, price }));
}

/**
 * Decide the new confirmed bucket using hysteresis: only move to a new bucket
 * once price clears the crossed boundary by `hysteresis`. Staying inside the
 * band around a level returns the previous bucket (no cross). Pure/testable.
 */
export function confirmBucket(
  prevBucket: number,
  price: number,
  step: number,
  hysteresis: number,
): number {
  const raw = Math.floor(price / step);
  if (raw > prevBucket && price >= (prevBucket + 1) * step + hysteresis) {
    return raw; // cleared the upper boundary by the buffer
  }
  if (raw < prevBucket && price <= prevBucket * step - hysteresis) {
    return raw; // cleared the lower boundary by the buffer
  }
  return prevBucket; // inside the hysteresis band — no confirmed cross
}

/**
 * Detect round-level crossings for one symbol. Uses Redis to remember the last
 * confirmed bucket across serverless runs. First observation sets the baseline
 * (no alert). Every genuine cross alerts — up or down, repeated — because
 * hysteresis (not a time window) is what suppresses on-the-line jitter.
 *
 * Note: price is sampled once per invocation, so a round-trip that completes
 * entirely between two runs isn't seen. Increase the cron cadence to narrow
 * that gap.
 */
export async function checkLevelCross(
  symbol: string,
  price: number,
  step: number,
  hysteresis: number,
): Promise<LevelCross[]> {
  const r = getRedis();
  if (!r || step <= 0 || !Number.isFinite(price)) return [];

  const key = `rl:last:${symbol}`;
  const prev = await r.get<number>(key);

  if (prev == null) {
    await r.set(key, Math.floor(price / step)); // baseline, don't alert
    return [];
  }

  const confirmed = confirmBucket(prev, price, step, hysteresis);
  if (confirmed === prev) return [];

  await r.set(key, confirmed);
  return computeCrosses(prev, confirmed, step, symbol, price);
}
