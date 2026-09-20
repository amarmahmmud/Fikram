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
  initialDelayMs: 600,
  backoffMultiplier: 1.5,
  retryableStatuses: [408, 429, 502, 503, 504],
};

/**
 * Detect if an error is a true network connectivity failure.
 * Does not misclassify JavaScript runtime TypeErrors as network drops.
 */
export function isNetworkFailure(error: any): boolean {
  if (!error) return false;

  const msg = String(error.message || error).toLowerCase();
  const isFetchTypeError =
    error.name === "TypeError" &&
    (msg.includes("fetch") || msg.includes("network") || msg.includes("load failed") || msg.includes("aborted"));

  return (
    isFetchTypeError ||
    msg.includes("failed to fetch") ||
    msg.includes("network error") ||
    msg.includes("networkrequestfailed") ||
    msg.includes("connection reset") ||
    msg.includes("econnrefused")
  );
}

/**
 * Perform a fetch request with automatic exponential backoff retry
 * for transient network dropouts and gateway timeouts.
 * Always attempts the actual request first — never falsely blocks on localhost.
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

      if (isNetErr && attempt < config.maxRetries) {
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
