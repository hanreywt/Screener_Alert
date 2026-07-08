import { Redis } from "@upstash/redis";

let _redis: Redis | null = null;

/**
 * Shared Upstash Redis client. Returns null if unconfigured so callers can
 * degrade gracefully. Vercel's Upstash integration provisions KV_REST_API_*;
 * classic UPSTASH_REDIS_REST_* names are accepted as a fallback.
 */
export function getRedis(): Redis | null {
  if (_redis) return _redis;
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const token =
    process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  _redis = new Redis({ url, token });
  return _redis;
}
