// ─────────────────────────────────────────────
// Redis-Backed Circuit Breaker
// ─────────────────────────────────────────────
// Tracks provider health across all Vercel serverless instances using
// a sliding-window failure count in Upstash Redis.
//
// Three states:
//   CLOSED    — provider is healthy, all requests go through
//   OPEN      — provider is down, skip it entirely (fail-fast)
//   HALF_OPEN — cooldown expired, send 1 test request to check recovery
//
// Design: fail-open — if Redis is unavailable, default to CLOSED so
// the system never blocks requests due to infra issues.

import { redis } from "./redis";

// ── Types ────────────────────────────────────────────────────────────────────

export type CircuitState = "closed" | "open" | "half-open";

export interface CircuitBreakerConfig {
  /** Number of failures within the window to trip the circuit */
  failureThreshold: number;
  /** Sliding window in seconds to count failures */
  failureWindowSec: number;
  /** How long to stay OPEN before testing recovery (seconds) */
  cooldownSec: number;
  /** Consecutive successes in HALF_OPEN needed to fully close */
  halfOpenSuccessThreshold: number;
}

export interface CircuitStatus {
  state: CircuitState;
  failureCount: number;
  lastFailureAt: number | null;
  openedAt: number | null;
}

// ── Default Config ───────────────────────────────────────────────────────────

const DEFAULT_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  failureWindowSec: 60,
  cooldownSec: 120,
  halfOpenSuccessThreshold: 2,
};

// ── Redis Key Helpers ────────────────────────────────────────────────────────

function keys(provider: string) {
  return {
    failures: `cb:${provider}:failures`,       // sorted set: score = timestamp
    state: `cb:${provider}:state`,             // string: closed | open | half-open
    openedAt: `cb:${provider}:opened_at`,      // string: unix timestamp
    halfOpenSuccesses: `cb:${provider}:ho_ok`,  // counter for half-open successes
  };
}

// ── Core API ─────────────────────────────────────────────────────────────────

/**
 * Get the current circuit breaker state for a provider.
 * Handles the OPEN → HALF_OPEN transition when the cooldown has elapsed.
 */
export async function getCircuitState(
  provider: string,
  config: CircuitBreakerConfig = DEFAULT_CONFIG,
): Promise<CircuitStatus> {
  try {
    const k = keys(provider);
    const now = Date.now();

    const [stateRaw, openedAtRaw, failureCount] = await Promise.all([
      redis.get<string>(k.state),
      redis.get<string>(k.openedAt),
      redis.zcount(k.failures, now - config.failureWindowSec * 1000, now),
    ]);

    const state = (stateRaw as CircuitState) || "closed";
    const openedAt = openedAtRaw ? parseInt(openedAtRaw, 10) : null;

    // Auto-transition: OPEN → HALF_OPEN after cooldown
    if (state === "open" && openedAt) {
      const elapsed = (now - openedAt) / 1000;
      if (elapsed >= config.cooldownSec) {
        await redis.set(k.state, "half-open");
        await redis.set(k.halfOpenSuccesses, 0);
        console.log(
          `[CircuitBreaker] ${provider}: OPEN → HALF_OPEN (cooldown of ${config.cooldownSec}s elapsed)`,
        );
        return { state: "half-open", failureCount, lastFailureAt: null, openedAt };
      }
    }

    return { state, failureCount, lastFailureAt: null, openedAt };
  } catch (err) {
    // Fail-open: if Redis is down, assume circuit is closed
    console.warn("[CircuitBreaker] Redis error, defaulting to CLOSED:", err);
    return { state: "closed", failureCount: 0, lastFailureAt: null, openedAt: null };
  }
}

/**
 * Record a successful request to a provider.
 * In HALF_OPEN state, accumulates successes until the threshold is met,
 * then closes the circuit.
 */
export async function recordSuccess(
  provider: string,
  config: CircuitBreakerConfig = DEFAULT_CONFIG,
): Promise<void> {
  try {
    const k = keys(provider);
    const currentState = await redis.get<string>(k.state);

    if (currentState === "half-open") {
      const successes = await redis.incr(k.halfOpenSuccesses);
      if (successes >= config.halfOpenSuccessThreshold) {
        // Enough successes — circuit is healthy again
        await Promise.all([
          redis.set(k.state, "closed"),
          redis.del(k.openedAt),
          redis.del(k.halfOpenSuccesses),
          redis.del(k.failures),
        ]);
        console.log(
          `[CircuitBreaker] ${provider}: HALF_OPEN → CLOSED (${successes} consecutive successes)`,
        );
      } else {
        console.log(
          `[CircuitBreaker] ${provider}: HALF_OPEN success ${successes}/${config.halfOpenSuccessThreshold}`,
        );
      }
    }
    // In CLOSED state, success is the normal path — no action needed
  } catch (err) {
    console.warn("[CircuitBreaker] Redis error on recordSuccess:", err);
  }
}

/**
 * Record a failed request to a provider.
 * If failures in the sliding window exceed the threshold, trip the circuit to OPEN.
 */
export async function recordFailure(
  provider: string,
  config: CircuitBreakerConfig = DEFAULT_CONFIG,
): Promise<void> {
  try {
    const k = keys(provider);
    const now = Date.now();

    // Add failure timestamp to sorted set
    await redis.zadd(k.failures, { score: now, member: `${now}-${Math.random()}` });

    // Trim old entries outside the sliding window
    await redis.zremrangebyscore(k.failures, 0, now - config.failureWindowSec * 1000);

    // Set TTL on the failures set so it auto-cleans (window + buffer)
    await redis.expire(k.failures, config.failureWindowSec + 60);

    // Count recent failures
    const recentFailures = await redis.zcount(
      k.failures,
      now - config.failureWindowSec * 1000,
      now,
    );

    const currentState = await redis.get<string>(k.state);

    if (currentState === "half-open") {
      // Any failure in HALF_OPEN → re-open the circuit
      await Promise.all([
        redis.set(k.state, "open"),
        redis.set(k.openedAt, String(now)),
        redis.del(k.halfOpenSuccesses),
      ]);
      console.warn(
        `[CircuitBreaker] ${provider}: HALF_OPEN → OPEN (test request failed, re-opening for ${config.cooldownSec}s)`,
      );
      return;
    }

    if (recentFailures >= config.failureThreshold && currentState !== "open") {
      // Trip the circuit
      await Promise.all([
        redis.set(k.state, "open"),
        redis.set(k.openedAt, String(now)),
      ]);
      console.warn(
        `[CircuitBreaker] ${provider}: CLOSED → OPEN (${recentFailures} failures in ${config.failureWindowSec}s window)`,
      );
    } else {
      console.warn(
        `[CircuitBreaker] ${provider}: failure recorded (${recentFailures}/${config.failureThreshold} in window)`,
      );
    }
  } catch (err) {
    console.warn("[CircuitBreaker] Redis error on recordFailure:", err);
  }
}

/**
 * Manually reset a circuit breaker (e.g., from an admin endpoint).
 */
export async function resetCircuit(provider: string): Promise<void> {
  try {
    const k = keys(provider);
    await Promise.all([
      redis.del(k.state),
      redis.del(k.openedAt),
      redis.del(k.failures),
      redis.del(k.halfOpenSuccesses),
    ]);
    console.log(`[CircuitBreaker] ${provider}: manually reset to CLOSED`);
  } catch (err) {
    console.warn("[CircuitBreaker] Redis error on reset:", err);
  }
}
