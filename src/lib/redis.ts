// ─────────────────────────────────────────────
// Upstash Redis Client
// ─────────────────────────────────────────────
// Configured via Vercel Marketplace integration.
// Env vars: UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN
// Lazy-initialized to avoid crashing during Next.js build phase.

import { Redis } from "@upstash/redis";

let _redis: Redis | null = null;

export function getRedis(): Redis {
  if (!_redis) {
    if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
      console.warn(
        "[redis] UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN not set. " +
        "Redis-backed features (rate limiting, webhook idempotency) will fail."
      );
    }
    _redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL || "",
      token: process.env.UPSTASH_REDIS_REST_TOKEN || "",
    });
  }
  return _redis;
}

// Backward-compatible export — lazy proxy that defers to getRedis()
export const redis = new Proxy({} as Redis, {
  get(_target, prop) {
    return (getRedis() as any)[prop];
  },
});
