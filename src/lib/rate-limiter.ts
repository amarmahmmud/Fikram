// ─────────────────────────────────────────────
// Redis-Backed Rate Limiter for API Routes
// ─────────────────────────────────────────────
// Fixed-window rate limiter using Upstash Redis.
// Provides a global limit across all Vercel instances.
// Previously in-memory — migrated to Redis for multi-instance support.

import { redis } from "./redis";

export interface RateLimitConfig {
  /** Maximum number of requests allowed in the window */
  maxRequests: number;
  /** Time window in milliseconds */
  windowMs: number;
}

/**
 * Check if a request should be rate-limited.
 * Uses a fixed-window counter in Redis (INCR + EXPIRE).
 *
 * @param key   - Unique identifier (e.g., IP address or user ID)
 * @param config - Rate limit configuration
 * @returns Object with `allowed` boolean and `remaining` count
 */
export async function checkRateLimit(
  key: string,
  config: RateLimitConfig,
): Promise<{ allowed: boolean; remaining: number; resetMs: number }> {
  const windowSec = Math.ceil(config.windowMs / 1000);
  const bucket = Math.floor(Date.now() / config.windowMs);
  const redisKey = `rl:${key}:${bucket}`;

  // Atomically increment and get TTL in a pipeline
  const pipeline = redis.pipeline();
  pipeline.incr(redisKey);
  pipeline.ttl(redisKey);
  const results = await pipeline.exec<[number, number]>();

  const count = results[0];
  const ttl = results[1];

  // Set expiry on first request in this window
  if (ttl === -1) {
    await redis.expire(redisKey, windowSec);
  }

  if (count > config.maxRequests) {
    const resetMs = ttl > 0 ? ttl * 1000 : config.windowMs;
    return {
      allowed: false,
      remaining: 0,
      resetMs,
    };
  }

  return {
    allowed: true,
    remaining: Math.max(0, config.maxRequests - count),
    resetMs: ttl > 0 ? ttl * 1000 : config.windowMs,
  };
}

/**
 * Extract the client IP from a request.
 * Checks common proxy headers, falls back to "unknown".
 */
export function getClientIP(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }
  const realIp = req.headers.get("x-real-ip");
  if (realIp) {
    return realIp.trim();
  }
  return "unknown";
}

// ── Pre-configured rate limit tiers ──────────────────────────────────────────

/** For anonymous users hitting public chat endpoints */
export const ANON_CHAT_LIMIT: RateLimitConfig = {
  maxRequests: 20,
  windowMs: 60 * 60 * 1000, // 20 requests per hour
};

/** For authenticated users hitting chat endpoints */
export const AUTH_CHAT_LIMIT: RateLimitConfig = {
  maxRequests: 60,
  windowMs: 60 * 60 * 1000, // 60 requests per hour
};

/** For fine-tuned model inference (more expensive) */
export const INFERENCE_LIMIT: RateLimitConfig = {
  maxRequests: 30,
  windowMs: 60 * 60 * 1000, // 30 requests per hour
};

/** For creating new Modal jobs (very expensive) */
export const JOB_CREATION_LIMIT: RateLimitConfig = {
  maxRequests: 5,
  windowMs: 60 * 60 * 1000, // 5 requests per hour
};

/** For generating RAG embeddings */
export const EMBEDDING_LIMIT: RateLimitConfig = {
  maxRequests: 50,
  windowMs: 60 * 60 * 1000, // 50 requests per hour
};
