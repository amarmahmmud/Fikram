// ─────────────────────────────────────────────
// Vertex AI Budget Tracker
// ─────────────────────────────────────────────
// Tracks estimated Vertex AI spend for free-tier users in Redis.
// Prevents runaway costs by enforcing a monthly budget cap.
//
// Key: vertex:spend:free:YYYY-MM (auto-expires after 35 days)
// Value: cumulative estimated spend in dollars (float)
//
// Paid users are never budget-checked — their payments cover costs.

import { redis } from "./redis";

// ── Configuration ────────────────────────────────────────────────────────────

/** Monthly Vertex AI budget for free-tier user fallback (in USD) */
const MONTHLY_BUDGET_USD = parseFloat(process.env.VERTEX_MONTHLY_BUDGET_USD || "10");

/** Estimated per-operation costs for Vertex AI (conservative estimates) */
export const VERTEX_COST_ESTIMATES = {
  /** Cost per embedding call (~1K chars of text) */
  embed_text: 0.000025,
  /** Cost per image description via Gemini Flash */
  describe_image: 0.0003,
  /** Cost per minute of audio transcription */
  transcribe_audio_per_min: 0.0015,
  /** Cost per minute of video description */
  describe_video_per_min: 0.01,
  /** Cost per text generation call (chat response) */
  generate_text: 0.0005,
  /** Cost per PDF page via Document AI OCR */
  document_ocr_per_page: 0.00065,
} as const;

export type VertexOperation = keyof typeof VERTEX_COST_ESTIMATES;

// ── Redis Key Helpers ────────────────────────────────────────────────────────

function getMonthKey(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  return `vertex:spend:free:${yyyy}-${mm}`;
}

// ── Core API ─────────────────────────────────────────────────────────────────

/**
 * Get the current month's estimated Vertex AI spend for free-tier users.
 */
export async function getMonthlyVertexSpend(): Promise<number> {
  try {
    const raw = await redis.get<string>(getMonthKey());
    return raw ? parseFloat(raw) : 0;
  } catch (err) {
    console.warn("[VertexBudget] Redis error on getMonthlyVertexSpend:", err);
    return 0;
  }
}

/**
 * Check if the monthly Vertex AI budget for free users has been exceeded.
 */
export async function isVertexBudgetExceeded(): Promise<boolean> {
  const spend = await getMonthlyVertexSpend();
  const exceeded = spend >= MONTHLY_BUDGET_USD;
  if (exceeded) {
    console.warn(
      `[VertexBudget] Monthly budget exceeded: $${spend.toFixed(4)} >= $${MONTHLY_BUDGET_USD}`,
    );
  }
  return exceeded;
}

/**
 * Track an estimated Vertex AI cost for a free-tier operation.
 * Increments the monthly spend counter in Redis.
 *
 * @param operation - The type of operation performed
 * @param units - Number of units (e.g., minutes for audio, pages for OCR). Default: 1
 */
export async function trackVertexSpend(
  operation: VertexOperation,
  units: number = 1,
): Promise<void> {
  try {
    const costPerUnit = VERTEX_COST_ESTIMATES[operation];
    const totalCost = costPerUnit * units;
    const key = getMonthKey();

    // Atomically increment the spend counter
    const newTotal = await redis.incrbyfloat(key, totalCost);

    // Set TTL to 35 days if this is a new key (ensures auto-cleanup)
    const ttl = await redis.ttl(key);
    if (ttl === -1) {
      await redis.expire(key, 35 * 24 * 60 * 60);
    }

    console.log(
      `[VertexBudget] Tracked ${operation} x${units}: +$${totalCost.toFixed(6)} → monthly total: $${newTotal.toFixed(4)}/$${MONTHLY_BUDGET_USD}`,
    );
  } catch (err) {
    // Non-critical: if tracking fails, don't block the request
    console.warn("[VertexBudget] Redis error on trackVertexSpend:", err);
  }
}

/**
 * Get a budget status summary (useful for admin dashboards / debugging).
 */
export async function getBudgetStatus(): Promise<{
  monthlyBudget: number;
  currentSpend: number;
  remaining: number;
  percentUsed: number;
  isExceeded: boolean;
}> {
  const currentSpend = await getMonthlyVertexSpend();
  const remaining = Math.max(0, MONTHLY_BUDGET_USD - currentSpend);
  return {
    monthlyBudget: MONTHLY_BUDGET_USD,
    currentSpend,
    remaining,
    percentUsed: (currentSpend / MONTHLY_BUDGET_USD) * 100,
    isExceeded: currentSpend >= MONTHLY_BUDGET_USD,
  };
}
