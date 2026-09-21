// ─────────────────────────────────────────────
// AI Gateway — Intelligent Multi-Provider Router
// ─────────────────────────────────────────────
// Central routing layer that decides which provider to use for each request
// based on task type, user tier, circuit breaker state, and budget.
//
// Routing philosophy:
//   1. Use the cheapest provider that can handle the task
//   2. Detect failures and escalate intelligently
//   3. Never spend real money on free users unless it's within budget
//   4. Paid users always get the fast, reliable path
//
// Provider hierarchy (for free users):
//   Text chat       → Groq (always free)
//   PDF extraction  → Document AI → Gemini free → Vertex AI
//   Media (img/aud/vid) → Gemini free → Vertex AI
//   Embeddings      → Gemini free → Vertex AI (always allowed, pennies)

import { type UserTier } from "./credits";
import {
  getCircuitState,
  recordSuccess,
  recordFailure,
  type CircuitState,
} from "./circuit-breaker";
import { isVertexBudgetExceeded, trackVertexSpend, type VertexOperation } from "./vertex-budget";

// ── Types ────────────────────────────────────────────────────────────────────

export type TaskType =
  | "ingest_text"
  | "ingest_office"
  | "ingest_pdf"
  | "ingest_image"
  | "ingest_audio"
  | "ingest_video"
  | "chat_text"
  | "chat_evaluative"
  | "chat_with_image"
  | "chat_with_audio"
  | "chat_with_video"
  | "embed_text";

export type Provider = "gemini-free" | "vertex-ai" | "document-ai" | "groq";

export interface ProviderDecision {
  /** The primary provider to use for this request */
  provider: Provider;
  /** Human-readable reason for this routing decision (for logging) */
  reason: string;
  /** What to try if the primary provider fails */
  fallback: Provider | null;
  /** What to try if the fallback also fails */
  secondFallback: Provider | null;
  /** Current circuit breaker state for Gemini free tier */
  circuitState: CircuitState;
  /** Whether this request should use the enterprise (Vertex AI) client */
  useEnterprise: boolean;
  /** Whether Vertex AI budget check should be applied */
  budgetChecked: boolean;
}

// ── Provider name for circuit breaker tracking ───────────────────────────────

const GEMINI_FREE_PROVIDER = "gemini-free";

// ── Core Routing Logic ───────────────────────────────────────────────────────

/**
 * The smart router. Determines which AI provider to use for a given task
 * based on user tier, provider health (circuit breaker), and budget.
 *
 * @param task     - What the user is trying to do
 * @param userTier - "free" or "paid"
 * @param mimeType - The file's MIME type (used for media classification)
 * @returns A ProviderDecision with primary, fallback, and metadata
 */
export async function routeRequest(
  task: TaskType,
  userTier: UserTier,
): Promise<ProviderDecision> {
  // ── Paid users always get the fast path ────────────────────────────────
  if (userTier === "paid") {
    const isGroqText = task === "chat_text";
    return {
      provider: isGroqText ? "groq" : task === "ingest_pdf" ? "document-ai" : "vertex-ai",
      reason: task === "chat_evaluative"
        ? "Paid user evaluative scorecard → direct Vertex AI (Gemini structured outputs)"
        : "Paid user → direct Vertex AI (SLA-backed, reliable)",
      fallback: task === "ingest_pdf" ? "vertex-ai" : null,
      secondFallback: null,
      circuitState: "closed",
      useEnterprise: !isGroqText,
      budgetChecked: false,
    };
  }

  // ── Free user routing (cost-optimized) ─────────────────────────────────

  // Evaluative mode scorecard chat requires Gemini for native responseSchema
  if (task === "chat_evaluative") {
    const circuit = await getCircuitState(GEMINI_FREE_PROVIDER);
    if (circuit.state === "open") {
      const budgetExceeded = await isVertexBudgetExceeded();
      if (!budgetExceeded) {
        return {
          provider: "vertex-ai",
          reason: "Circuit OPEN → escalating evaluative scorecard to Vertex AI",
          fallback: null,
          secondFallback: null,
          circuitState: "open",
          useEnterprise: true,
          budgetChecked: true,
        };
      }
    }
    return {
      provider: "gemini-free",
      reason: "Evaluative scorecard → Gemini API (native structured outputs)",
      fallback: "vertex-ai",
      secondFallback: null,
      circuitState: circuit.state,
      useEnterprise: false,
      budgetChecked: true,
    };
  }

  // Text-only chat always goes through Groq (free, no fallback needed)
  if (task === "chat_text") {
    return {
      provider: "groq",
      reason: "Text chat → Groq (free, fast)",
      fallback: null,
      secondFallback: null,
      circuitState: "closed",
      useEnterprise: false,
      budgetChecked: false,
    };
  }

  // PDF ingestion: Document AI first (fast, cheap, specialized)
  if (task === "ingest_pdf") {
    const circuit = await getCircuitState(GEMINI_FREE_PROVIDER);
    return {
      provider: "document-ai",
      reason: "PDF → Document AI (fast OCR, $0.65/1K pages)",
      fallback: circuit.state === "open" ? "vertex-ai" : "gemini-free",
      secondFallback: circuit.state === "open" ? null : "vertex-ai",
      circuitState: circuit.state,
      useEnterprise: false,
      budgetChecked: true,
    };
  }

  // Plain text ingestion: just embed (Gemini free → Vertex AI)
  if (task === "ingest_text" || task === "ingest_office") {
    return {
      provider: "gemini-free",
      reason: "Text embed → Gemini free (embedding only)",
      fallback: "vertex-ai",
      secondFallback: null,
      circuitState: "closed",
      useEnterprise: false,
      budgetChecked: false, // Embeddings are pennies, always allowed
    };
  }

  // Embedding task: always start with free, Vertex fallback is so cheap it's always allowed
  if (task === "embed_text") {
    return {
      provider: "gemini-free",
      reason: "Embedding → Gemini free keys",
      fallback: "vertex-ai",
      secondFallback: null,
      circuitState: "closed",
      useEnterprise: false,
      budgetChecked: false, // ~$0.000025 per call, always allowed
    };
  }

  // ── Media tasks (image/audio/video ingest + chat with media) ───────────
  // These require Gemini's multimodal capabilities
  const circuit = await getCircuitState(GEMINI_FREE_PROVIDER);

  if (circuit.state === "open") {
    // Circuit is open → Gemini free is known-broken, skip directly to Vertex
    const budgetExceeded = await isVertexBudgetExceeded();
    if (budgetExceeded) {
      return {
        provider: "gemini-free",
        reason: "Circuit OPEN + Vertex budget exceeded → must try Gemini free anyway (best effort)",
        fallback: null,
        secondFallback: null,
        circuitState: "open",
        useEnterprise: false,
        budgetChecked: true,
      };
    }
    return {
      provider: "vertex-ai",
      reason: `Circuit OPEN for Gemini free → skipping directly to Vertex AI`,
      fallback: null,
      secondFallback: null,
      circuitState: "open",
      useEnterprise: true,
      budgetChecked: true,
    };
  }

  // Circuit is CLOSED or HALF_OPEN → try Gemini free first
  return {
    provider: "gemini-free",
    reason: `Circuit ${circuit.state.toUpperCase()} → trying Gemini free keys first`,
    fallback: "vertex-ai",
    secondFallback: null,
    circuitState: circuit.state,
    useEnterprise: false,
    budgetChecked: true,
  };
}

// ── Execution Helpers ────────────────────────────────────────────────────────

/**
 * Execute a task with automatic fallback. Wraps the primary provider call,
 * and if it fails, attempts the fallback provider with circuit breaker tracking.
 *
 * @param decision    - The routing decision from routeRequest()
 * @param primaryFn   - The function to call with the primary provider
 * @param fallbackFn  - The function to call with the fallback provider (optional)
 * @param secondFallbackFn - The function to call with the second fallback (optional)
 * @param vertexOp    - The Vertex operation type for budget tracking (if applicable)
 * @param vertexUnits - Number of units for budget tracking (default: 1)
 */
export async function executeWithFallback<T>({
  decision,
  primaryFn,
  fallbackFn,
  secondFallbackFn,
  vertexOp,
  vertexUnits = 1,
}: {
  decision: ProviderDecision;
  primaryFn: () => Promise<T>;
  fallbackFn?: () => Promise<T>;
  secondFallbackFn?: () => Promise<T>;
  vertexOp?: VertexOperation;
  vertexUnits?: number;
}): Promise<{ result: T; usedProvider: Provider }> {
  const logPrefix = `[AIGateway]`;

  // ── Try primary provider ───────────────────────────────────────────────
  try {
    console.log(`${logPrefix} Attempting ${decision.provider}: ${decision.reason}`);
    const result = await primaryFn();

    // Record success for circuit breaker (only track Gemini free)
    if (decision.provider === "gemini-free") {
      await recordSuccess(GEMINI_FREE_PROVIDER);
    }

    return { result, usedProvider: decision.provider };
  } catch (primaryErr: any) {
    console.warn(
      `${logPrefix} ${decision.provider} failed: ${primaryErr.message || primaryErr}`,
    );

    // Record failure for circuit breaker (only track Gemini free)
    if (decision.provider === "gemini-free") {
      await recordFailure(GEMINI_FREE_PROVIDER);
    }

    // ── Try fallback provider ──────────────────────────────────────────
    if (decision.fallback && fallbackFn) {
      // Budget check for Vertex AI fallback
      if (decision.fallback === "vertex-ai" && decision.budgetChecked) {
        const exceeded = await isVertexBudgetExceeded();
        if (exceeded) {
          console.warn(`${logPrefix} Vertex AI budget exceeded, cannot escalate`);
          throw new Error(
            `Primary provider (${decision.provider}) failed and Vertex AI monthly budget is exceeded. Please try again later.`,
          );
        }
      }

      try {
        console.log(
          `${logPrefix} Falling back to ${decision.fallback}`,
        );
        const result = await fallbackFn();

        // Track Vertex AI spend if applicable
        if (decision.fallback === "vertex-ai" && vertexOp) {
          await trackVertexSpend(vertexOp, vertexUnits);
        }

        // Record success if this was a Gemini free fallback
        if (decision.fallback === "gemini-free") {
          await recordSuccess(GEMINI_FREE_PROVIDER);
        }

        return { result, usedProvider: decision.fallback };
      } catch (fallbackErr: any) {
        console.warn(
          `${logPrefix} Fallback ${decision.fallback} also failed: ${fallbackErr.message || fallbackErr}`,
        );

        // Record failure if Gemini free was the fallback
        if (decision.fallback === "gemini-free") {
          await recordFailure(GEMINI_FREE_PROVIDER);
        }

        // ── Try second fallback ──────────────────────────────────────
        if (decision.secondFallback && secondFallbackFn) {
          if (decision.secondFallback === "vertex-ai" && decision.budgetChecked) {
            const exceeded = await isVertexBudgetExceeded();
            if (exceeded) {
              console.warn(`${logPrefix} Vertex AI budget exceeded on second fallback`);
              throw new Error(
                `All free providers failed and Vertex AI monthly budget is exceeded. Please try again later.`,
              );
            }
          }

          try {
            console.log(`${logPrefix} Second fallback to ${decision.secondFallback}`);
            const result = await secondFallbackFn();

            if (decision.secondFallback === "vertex-ai" && vertexOp) {
              await trackVertexSpend(vertexOp, vertexUnits);
            }

            return { result, usedProvider: decision.secondFallback };
          } catch (secondErr: any) {
            console.error(
              `${logPrefix} All providers exhausted. Last error: ${secondErr.message || secondErr}`,
            );
            throw secondErr;
          }
        }

        throw fallbackErr;
      }
    }

    // No fallback configured
    throw primaryErr;
  }
}

// ── Task Classification Helpers ──────────────────────────────────────────────

/**
 * Determine the TaskType for a document ingestion based on MIME type and filename.
 */
export function classifyIngestTask(mimeType: string, filename: string): TaskType {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".pdf") || mimeType === "application/pdf") return "ingest_pdf";
  if (/\.(doc|docx|ppt|pptx|xls|xlsx)$/i.test(lower)) return "ingest_office";
  if (mimeType.startsWith("image/") || /\.(png|jpe?g|webp|gif|heic|heif)$/i.test(lower)) return "ingest_image";
  if (mimeType.startsWith("audio/") || /\.(mp3|wav|ogg|webm|m4a|aac|flac)$/i.test(lower)) return "ingest_audio";
  if (mimeType.startsWith("video/") || /\.(mp4|webm|ogg|mov|quicktime)$/i.test(lower)) return "ingest_video";
  return "ingest_text";
}

/**
 * Determine the TaskType for a chat message based on media attachments and reasoning mode.
 */
export function classifyChatTask(
  hasMedia: boolean,
  mimeType?: string,
  isEvaluative: boolean = false
): TaskType {
  if (isEvaluative) return "chat_evaluative";
  if (!hasMedia || !mimeType) return "chat_text";
  if (mimeType.startsWith("video/")) return "chat_with_video";
  if (mimeType.startsWith("audio/")) return "chat_with_audio";
  return "chat_with_image";
}

/**
 * Map a TaskType to the corresponding VertexOperation for budget tracking.
 */
export function taskToVertexOp(task: TaskType): VertexOperation | undefined {
  switch (task) {
    case "ingest_image":
    case "chat_with_image":
    case "chat_evaluative":
      return "describe_image";
    case "ingest_audio":
    case "chat_with_audio":
      return "transcribe_audio_per_min";
    case "ingest_video":
    case "chat_with_video":
      return "describe_video_per_min";
    case "ingest_pdf":
      return "document_ocr_per_page";
    case "embed_text":
    case "ingest_text":
    case "ingest_office":
      return "embed_text";
    case "chat_text":
      return undefined; // Groq, no Vertex cost
  }
}
