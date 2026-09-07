// ─────────────────────────────────────────────
// Training Configuration Constants (Frontend)
// Shared between the wizard, job launcher, and credits UI.
// Keep these in sync with modal_backend/train.py's constants.
// ─────────────────────────────────────────────

/** Maximum training examples allowed per job. Block submission if exceeded.
 *  Configurable here — never silently truncate the user's data. */
export const MAX_TRAINING_EXAMPLES = 5_000;

/** Credits charged as a flat fee on outright job failure (after OOM retry).
 *  Must match train.py's FAILED_JOB_FLAT_FEE_CREDITS. */
export const FAILED_JOB_FLAT_FEE_CREDITS = 25;

/** Frontend proxy endpoint for Modal's estimate_cost function. */
export const ESTIMATE_COST_ENDPOINT = "/api/estimate-cost";

/** Batch estimate endpoint (for downgrade suggestions). */
export const ESTIMATE_COST_BATCH_ENDPOINT = "/api/estimate-cost/batch";

/** Response shape from the estimate_cost endpoint */
export interface CostEstimate {
  status: "ok" | "unsupported" | "failed";
  // Present when status === "ok"
  resolved_model?: string;
  param_count_billion?: number;
  use_qlora?: boolean;
  method?: string;
  batch_size?: number;
  grad_accum?: number;
  effective_batch_size?: number;
  learning_rate?: number;
  warmup_steps?: number;
  gpu_tier?: string;
  modal_gpu?: string;
  estimated_vram_gb?: number;
  vram_breakdown?: Record<string, number>;
  num_train_epochs?: number;
  max_steps?: number;
  estimated_training_seconds?: number;
  estimated_credits?: number;
  // Present when status === "unsupported"
  reason?: string;
  max_supported_vram_gb?: number;
  message?: string;
  // Present when status === "failed"
  error?: string;
}
