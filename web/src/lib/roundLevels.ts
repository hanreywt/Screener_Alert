import { getRedis } from "./redisClient";

export interface LevelCross {
  symbol: string;
  level: number; // the round level that was crossed, e.g. 63000
  direction: "up" | "down";
  price: number; // current price
}

// Anti-flap: don't re-alert the same level+direction within this window.
const SEEN_TTL_SECONDS = 15 * 60;

/**
 * Pure crossing logic: given the previous and current bucket index
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
 * Detect round-level crossings for one symbol using Redis to remember the
 * last bucket. First observation just sets the baseline (no alert). Repeated
 * crossings of the same level+direction are de-duped for SEEN_TTL_SECONDS to
 * suppress chop around a level.
 */
export async function checkLevelCross(
  symbol: string,
  price: number,
  step: number,
): Promise<LevelCross[]> {
  const r = getRedis();
  if (!r || step <= 0 || !Number.isFinite(price)) return [];

  const bucket = Math.floor(price / step);
  const key = `rl:last:${symbol}`;
  const prev = await r.get<number>(key);
  await r.set(key, bucket);

  if (prev == null) return []; // baseline set, don't alert on first run

  const candidates = computeCrosses(prev, bucket, step, symbol, price);

  const fresh: LevelCross[] = [];
  for (const c of candidates) {
    const dk = `rl:seen:${symbol}:${c.level}:${c.direction}`;
    const set = await r.set(dk, Date.now(), { nx: true, ex: SEEN_TTL_SECONDS });
    if (set === "OK") fresh.push(c);
  }
  return fresh;
}
