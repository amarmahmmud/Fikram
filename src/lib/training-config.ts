// ─────────────────────────────────────────────
// Training Config — Shared constants for ASR fine-tuning
// ─────────────────────────────────────────────

/** Maximum number of audio clips in a training dataset */
export const MAX_TRAINING_CLIPS = 10_000;

/** Maximum audio clip duration in milliseconds */
export const MAX_CLIP_DURATION_MS = 5000;

/** Minimum audio clip duration in milliseconds */
export const MIN_CLIP_DURATION_MS = 50;

/** Maximum upload duration in milliseconds (15 minutes) */
export const MAX_UPLOAD_DURATION_MS = 15 * 60 * 1000;

/** Maximum upload file size in bytes (~15MB for 15min 16kHz mono WAV) */
export const MAX_UPLOAD_SIZE_BYTES = 15 * 1024 * 1024;

/** Target sample rate for all audio */
export const TARGET_SAMPLE_RATE = 16000;

/** Flat fee charged for failed jobs (in credits) */
export const FAILED_JOB_FLAT_FEE_CREDITS = 25;

/**
 * Cost estimate returned by Modal's estimate_cost endpoint.
 * Adapted for ASR training (audio duration instead of text examples).
 */
export interface CostEstimate {
  status: "ok" | "unsupported" | "failed";
  resolved_model: string;
  param_count_million: number;
  use_qlora: boolean;
  method: string;
  batch_size: number;
  grad_accum: number;
  effective_batch_size: number;
  learning_rate: number;
  warmup_steps: number;
  gpu_tier: string;
  modal_gpu: string;
  estimated_vram_gb: number;
  num_train_epochs: number;
  max_steps: number;
  estimated_training_seconds: number;
  estimated_credits: number;
  // ASR-specific
  total_audio_duration_ms?: number;
  total_clips?: number;
}

/** Supported audio file extensions for upload */
export const SUPPORTED_AUDIO_EXTENSIONS = [".wav", ".mp3", ".flac", ".m4a", ".ogg", ".webm"];

/** Check if a filename is a supported audio format */
export function isSupportedAudioFormat(filename: string): boolean {
  const ext = filename.toLowerCase().slice(filename.lastIndexOf("."));
  return SUPPORTED_AUDIO_EXTENSIONS.includes(ext);
}
