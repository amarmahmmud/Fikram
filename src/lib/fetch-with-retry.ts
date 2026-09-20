// ─────────────────────────────────────────────
// Resilient Fetch with Exponential Backoff Retry
// ─────────────────────────────────────────────

export interface RetryOptions {
  maxRetries?: number;
  initialDelayMs?: number;
  backoffMultiplier?: number;
  retryableStatuses?: number[];
  onRetry?: (attempt: number, error: any) => void;
}

const DEFAULT_RETRY_OPTIONS: Required<Omit<RetryOptions, "onRetry">> = {
  maxRetries: 2,
  initialDelayMs: 1000,
  backoffMultiplier: 2,
  retryableStatuses: [408, 429, 502, 503, 504],
};

/**
 * Check if the browser currently reports as offline.
 */
export function isBrowserOffline(): boolean {
  return typeof navigator !== "undefined" && !navigator.onLine;
}

/**
 * Detect if an error is a network connectivity failure.
 */
export function isNetworkFailure(error: any): boolean {
  if (isBrowserOffline()) return true;
  if (!error) return false;

  const msg = String(error.message || error).toLowerCase();
  return (
    msg.includes("failed to fetch") ||
    msg.includes("network error") ||
    msg.includes("networkrequestfailed") ||
    msg.includes("load failed") ||
    msg.includes("connection reset") ||
    msg.includes("econnrefused") ||
    msg.includes("aborterror") ||
    error.name === "TypeError"
  );
}

/**
 * Perform a fetch request with automatic exponential backoff retry
 * for transient network errors and gateway timeouts.
 */
export async function fetchWithRetry(
  url: string,
  options?: RequestInit,
  retryOpts?: RetryOptions,
): Promise<Response> {
  const config = { ...DEFAULT_RETRY_OPTIONS, ...retryOpts };

  let attempt = 0;
  let delay = config.initialDelayMs;

  while (true) {
    try {
      // Don't retry if known to be offline right at the start
      if (isBrowserOffline() && attempt > 0) {
        throw new TypeError("You appear to be offline.");
      }

      const response = await fetch(url, options);

      // Check if status qualifies for transient retry (e.g. 502/503/504)
      if (!response.ok && config.retryableStatuses.includes(response.status) && attempt < config.maxRetries) {
        attempt++;
        if (config.onRetry) {
          config.onRetry(attempt, new Error(`HTTP ${response.status}`));
        }
        await new Promise((resolve) => setTimeout(resolve, delay));
        delay *= config.backoffMultiplier;
        continue;
      }

      return response;
    } catch (err: any) {
      const isNetErr = isNetworkFailure(err);

      if (isNetErr && attempt < config.maxRetries && !isBrowserOffline()) {
        attempt++;
        if (config.onRetry) {
          config.onRetry(attempt, err);
        }
        await new Promise((resolve) => setTimeout(resolve, delay));
        delay *= config.backoffMultiplier;
        continue;
      }

      throw err;
    }
  }
}
