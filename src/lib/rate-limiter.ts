// ─────────────────────────────────────────────
// In-Memory Rate Limiter for API Routes
// ─────────────────────────────────────────────
// Simple sliding-window rate limiter using an in-memory Map.
// Suitable for single-instance deployments. For multi-instance,
// replace with Redis-based limiter.

export interface RateLimitConfig {
  /** Maximum number of requests allowed in the window */
  maxRequests: number;
  /** Time window in milliseconds */
  windowMs: number;
}

interface RateLimitEntry {
  timestamps: number[];
}

const store = new Map<string, RateLimitEntry>();

// Clean up expired entries every 5 minutes to prevent memory leaks
const CLEANUP_INTERVAL = 5 * 60 * 1000;
let lastCleanup = Date.now();

function cleanup(windowMs: number) {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL) return;
  lastCleanup = now;

  for (const [key, entry] of store.entries()) {
    entry.timestamps = entry.timestamps.filter((ts) => now - ts < windowMs);
    if (entry.timestamps.length === 0) {
      store.delete(key);
    }
  }
}

/**
 * Check if a request should be rate-limited.
 *
 * @param key   - Unique identifier (e.g., IP address or user ID)
 * @param config - Rate limit configuration
 * @returns Object with `allowed` boolean and `remaining` count
 */
export function checkRateLimit(
  key: string,
  config: RateLimitConfig,
): { allowed: boolean; remaining: number; resetMs: number } {
  const now = Date.now();
  cleanup(config.windowMs);

  let entry = store.get(key);
  if (!entry) {
    entry = { timestamps: [] };
    store.set(key, entry);
  }

  // Remove timestamps outside the current window
  entry.timestamps = entry.timestamps.filter(
    (ts) => now - ts < config.windowMs,
  );

  if (entry.timestamps.length >= config.maxRequests) {
    // Calculate when the oldest request in the window will expire
    const oldestInWindow = entry.timestamps[0];
    const resetMs = config.windowMs - (now - oldestInWindow);
    return {
      allowed: false,
      remaining: 0,
      resetMs: Math.max(resetMs, 0),
    };
  }

  entry.timestamps.push(now);
  return {
    allowed: true,
    remaining: config.maxRequests - entry.timestamps.length,
    resetMs: config.windowMs,
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
  maxRequests: 15,
  windowMs: 60 * 60 * 1000, // 15 requests per hour
};
