import { Redis } from "@upstash/redis";
import type { Signal } from "./types";

// Mirrors engine.py's _SEEN de-dupe: don't re-fire an identical alert
// (same symbol + kind + zone) within this window.
const SEEN_TTL_SECONDS = 15 * 60;

let _redis: Redis | null = null;
function redis(): Redis | null {
  if (_redis) return _redis;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null; // dedupe disabled if unconfigured
  _redis = new Redis({ url, token });
  return _redis;
}

function keyFor(s: Signal): string {
  return `alert:${s.symbol}:${s.kind}:${s.zonePrice}`;
}

/**
 * Return only the signals not seen within the TTL window, and mark them seen.
 * If Redis is not configured, everything passes through (no dedupe).
 */
export async function filterUnseen(signals: Signal[]): Promise<Signal[]> {
  const r = redis();
  if (!r) return signals;

  const fresh: Signal[] = [];
  for (const s of signals) {
    const key = keyFor(s);
    // SET key with NX (only if absent) + EX ttl → true when newly set.
    const set = await r.set(key, Date.now(), { nx: true, ex: SEEN_TTL_SECONDS });
    if (set === "OK") fresh.push(s);
  }
  return fresh;
}
