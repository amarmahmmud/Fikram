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
  // Gracefully skip rate limiting if Redis is not configured
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    console.warn("[rate-limiter] Redis not configured — skipping rate limit check");
    return { allowed: true, remaining: config.maxRequests, resetMs: config.windowMs };
  }

  try {
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
  } catch (err) {
    // If Redis fails, allow the request but log the error
    console.error("[rate-limiter] Redis error, allowing request:", err);
    return { allowed: true, remaining: config.maxRequests, resetMs: config.windowMs };
  }
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

// ── Text-to-Speech (TTS) Limits & Quotas ─────────────────────────────────────

/** Rate limit for anonymous users calling TTS */
export const ANON_TTS_LIMIT: RateLimitConfig = {
  maxRequests: 30,
  windowMs: 60 * 60 * 1000, // 30 requests per hour
};

/** Rate limit for authenticated users calling TTS */
export const AUTH_TTS_LIMIT: RateLimitConfig = {
  maxRequests: 120,
  windowMs: 60 * 60 * 1000, // 120 requests per hour
};

/** Maximum allowed characters in a single TTS request */
export const MAX_TTS_CHARS_PER_REQUEST = 5000;

/** Hourly character quota for anonymous users (cost control) */
export const ANON_TTS_CHAR_QUOTA = 50000;

/** Hourly character quota for authenticated users (cost control) */
export const AUTH_TTS_CHAR_QUOTA = 200000;

/**
 * Check and increment character usage in Redis for TTS cost control.
 *
 * @param key - Unique identifier (user ID or client IP)
 * @param charsToAdd - Number of characters in the current request
 * @param maxHourlyChars - Max characters allowed per hour
 * @param windowMs - Time window in milliseconds (default 1 hour)
 * @returns Object with allowed, remaining, and resetMs
 */
export async function checkCharacterQuota(
  key: string,
  charsToAdd: number,
  maxHourlyChars: number,
  windowMs: number = 60 * 60 * 1000
): Promise<{ allowed: boolean; remaining: number; resetMs: number }> {
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    return { allowed: true, remaining: maxHourlyChars, resetMs: windowMs };
  }

  try {
    const windowSec = Math.ceil(windowMs / 1000);
    const bucket = Math.floor(Date.now() / windowMs);
    const redisKey = `tts:quota:${key}:${bucket}`;

    const pipeline = redis.pipeline();
    pipeline.incrby(redisKey, charsToAdd);
    pipeline.ttl(redisKey);
    const results = await pipeline.exec<[number, number]>();

    const totalChars = results[0];
    const ttl = results[1];

    if (ttl === -1) {
      await redis.expire(redisKey, windowSec);
    }

    if (totalChars > maxHourlyChars) {
      const resetMs = ttl > 0 ? ttl * 1000 : windowMs;
      return {
        allowed: false,
        remaining: 0,
        resetMs,
      };
    }

    return {
      allowed: true,
      remaining: Math.max(0, maxHourlyChars - totalChars),
      resetMs: ttl > 0 ? ttl * 1000 : windowMs,
    };
  } catch (err) {
    console.error("[rate-limiter] Redis error in checkCharacterQuota:", err);
    return { allowed: true, remaining: maxHourlyChars, resetMs: windowMs };
  }
}
