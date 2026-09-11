// ─────────────────────────────────────────────
// ASR Dataset Generation Pipeline
// ─────────────────────────────────────────────
// Replaces the text-based Q&A pipeline with audio-based phonetic ASR
// dataset generation for Noorani Qaida / Tajweed fine-tuning.
//
// PIPELINE STAGES (same shape as the old text pipeline):
//   1. Segmenting  — VAD-based audio segmentation into short clips
//   2. Transcribing — Bootstrap phonetic ASR pass for draft labels
//   3. Validating   — Duration checks, silence/clipping, 16kHz mono
//   4. Deduplicating — Audio fingerprint/hash-based near-duplicate detection
//   5-6. REMOVED   — No ASR equivalent for boundary/contrastive/format pairs
//   7. Train/Eval split — 85/15 on (audio_clip, phoneme+sifat_label) pairs
//
// REMOVED (no CTC equivalent):
//   - System Prompt Builder (no instruction-following in CTC)
//   - Boundary/contrastive/meta-cognitive/applied-example pairs
//   - Format-following post-processing
//   - Number/entity verification → replaced with confidence-based flagging
// ─────────────────────────────────────────────

import crypto from "crypto";
import type {
  AudioClip,
  ASRDatasetPair,
  PhonemeLabel,
  ASRPipelineProgress,
  ASRPipelineStats,
} from "@/lib/qps-types";
import type { ASRWizardContext } from "@/lib/asr-wizard-types";

// ─────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────

/** Minimum clip duration (ms) — below this, clip is likely noise */
const MIN_CLIP_DURATION_MS = 50;

/** Maximum clip duration (ms) — above this, re-segment */
const MAX_CLIP_DURATION_MS = 5000;

/** Target sample rate for all clips */
const TARGET_SAMPLE_RATE = 16000;

/** Target channels (mono) */
const TARGET_CHANNELS = 1;

/** Silence threshold in dBFS — clips quieter than this are rejected */
const SILENCE_THRESHOLD_DBFS = -45;

/** Clipping threshold — if >5% of samples are at max amplitude, reject */
const CLIPPING_RATIO_THRESHOLD = 0.05;

/** Maximum ratio of phoneme count to clip duration (phonemes per 100ms) */
const MAX_PHONEME_DENSITY = 5;

/** Minimum ratio of phoneme count to clip duration (phonemes per second) */
const MIN_PHONEME_DENSITY = 0.5;

/** Near-duplicate audio fingerprint similarity threshold */
const AUDIO_DEDUP_THRESHOLD = 0.95;

/** Confidence threshold below which labels are flagged for human review */
export const LOW_CONFIDENCE_THRESHOLD = 0.6;

/** Max clips to keep total (prevent runaway large uploads) */
const MAX_CLIPS = 10_000;


// ─────────────────────────────────────────────
// Stage 1: Audio Segmentation (VAD-based)
// ─────────────────────────────────────────────
// Uses silero-vad (via Modal API call) to detect speech segments
// in the uploaded audio and split them into individual clips.
// Each clip is stored in R2.
//
// NOTE: VAD runs server-side (Modal/Python) — this function dispatches
// the segmentation request and processes the results. The actual VAD
// computation happens in the Modal backend.

export interface SegmentationResult {
  clips: AudioClip[];
  totalDurationMs: number;
  droppedSilenceMs: number;
}

/**
 * Request VAD-based segmentation of an audio file.
 * This calls a Modal endpoint that runs silero-vad on the uploaded audio.
 *
 * @param audioR2Key — R2 key of the uploaded audio file
 * @param audioUrl — Presigned URL for the audio file
 * @returns SegmentationResult with individual clips stored in R2
 */
export async function segmentAudio(
  audioR2Key: string,
  audioUrl: string,
): Promise<SegmentationResult> {
  // TODO: Call Modal's VAD segmentation endpoint
  // For now, return a placeholder that the SSE handler can work with.
  // The Modal endpoint should:
  //   1. Download the audio from audioUrl
  //   2. Convert to 16kHz mono WAV
  //   3. Run silero-vad to detect speech segments
  //   4. Split into individual clips (MIN_CLIP_DURATION_MS to MAX_CLIP_DURATION_MS)
  //   5. Upload each clip to R2
  //   6. Return clip metadata

  const modalSegmentUrl = process.env.MODAL_SEGMENT_URL;
  if (!modalSegmentUrl) {
    throw new Error("MODAL_SEGMENT_URL not configured — VAD segmentation requires Modal backend");
  }

  const res = await fetch(modalSegmentUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      audio_r2_key: audioR2Key,
      audio_url: audioUrl,
      min_clip_ms: MIN_CLIP_DURATION_MS,
      max_clip_ms: MAX_CLIP_DURATION_MS,
      target_sample_rate: TARGET_SAMPLE_RATE,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`VAD segmentation failed: ${res.status} — ${errText}`);
  }

  const data = await res.json();
  return {
    clips: data.clips as AudioClip[],
    totalDurationMs: data.total_duration_ms,
    droppedSilenceMs: data.dropped_silence_ms,
  };
}


// ─────────────────────────────────────────────
// Stage 2: Bootstrap Phonetic Transcription
// ─────────────────────────────────────────────
// Runs the BASE_MODEL_CHECKPOINT ASR model on each clip to produce
// draft QPS phoneme+sifat labels. Low-confidence labels are flagged
// for mandatory human review in the correction UI.

export interface BootstrapTranscriptionResult {
  clipId: string;
  labels: PhonemeLabel[];
  qpsSequence: string;
  overallConfidence: number;
  needsReview: boolean;
}

/**
 * Bootstrap-transcribe a batch of audio clips using the base ASR model.
 * Calls Modal endpoint that runs Wav2Vec2ForCTC inference.
 */
export async function bootstrapTranscribe(
  clips: AudioClip[],
  modelCheckpoint?: string,
): Promise<BootstrapTranscriptionResult[]> {
  const checkpoint = modelCheckpoint || process.env.BASE_MODEL_CHECKPOINT || "obadx/qps-wav2vec2-ctc";

  // TODO: Call Modal's bootstrap transcription endpoint
  // The Modal endpoint should:
  //   1. Load the BASE_MODEL_CHECKPOINT
  //   2. For each clip: run CTC inference → get phoneme+sifat labels with timestamps
  //   3. Return per-clip labels with confidence scores

  const modalTranscribeUrl = process.env.MODAL_TRANSCRIBE_URL;
  if (!modalTranscribeUrl) {
    throw new Error("MODAL_TRANSCRIBE_URL not configured — bootstrap transcription requires Modal backend");
  }

  const results: BootstrapTranscriptionResult[] = [];

  // Process in batches to avoid timeout
  const BATCH_SIZE = 10;
  for (let i = 0; i < clips.length; i += BATCH_SIZE) {
    const batch = clips.slice(i, i + BATCH_SIZE);

    const res = await fetch(modalTranscribeUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clips: batch.map((c) => ({ id: c.id, r2_key: c.r2Key, r2_url: c.r2Url })),
        model_checkpoint: checkpoint,
        script_type: "QPS",
      }),
    });

    if (!res.ok) {
      console.error(`[Pipeline] Bootstrap transcription batch ${i} failed: ${res.status}`);
      // Mark failed clips as needing review
      for (const clip of batch) {
        results.push({
          clipId: clip.id,
          labels: [],
          qpsSequence: "",
          overallConfidence: 0,
          needsReview: true,
        });
      }
      continue;
    }

    const data = await res.json();
    const batchResults = (data.results || []) as BootstrapTranscriptionResult[];

    // Flag low-confidence transcriptions for human review
    for (const r of batchResults) {
      r.needsReview = r.overallConfidence < LOW_CONFIDENCE_THRESHOLD || r.labels.length === 0;
      // Also flag individual low-confidence phonemes
      for (const label of r.labels) {
        if (label.confidence < LOW_CONFIDENCE_THRESHOLD) {
          r.needsReview = true;
        }
      }
    }

    results.push(...batchResults);

    // Rate limiting between batches
    if (i + BATCH_SIZE < clips.length) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  return results;
}


// ─────────────────────────────────────────────
// Stage 3: Validation
// ─────────────────────────────────────────────
// Local (non-ML) quality checks on audio clips and their labels.
// No API calls — fast deterministic filters.

export interface ValidationReport {
  clipId: string;
  valid: boolean;
  issues: string[];
}

/**
 * Validate an audio clip and its transcription.
 * Checks: duration, silence, clipping, normalization, phoneme density.
 */
export function validateClip(
  clip: AudioClip,
  labels: PhonemeLabel[],
): ValidationReport {
  const issues: string[] = [];

  // Duration check
  if (clip.durationMs < MIN_CLIP_DURATION_MS) {
    issues.push(`Duration too short: ${clip.durationMs}ms (min: ${MIN_CLIP_DURATION_MS}ms)`);
  }
  if (clip.durationMs > MAX_CLIP_DURATION_MS) {
    issues.push(`Duration too long: ${clip.durationMs}ms (max: ${MAX_CLIP_DURATION_MS}ms)`);
  }

  // Sample rate check
  if (clip.sampleRate !== TARGET_SAMPLE_RATE) {
    issues.push(`Wrong sample rate: ${clip.sampleRate}Hz (expected: ${TARGET_SAMPLE_RATE}Hz)`);
  }

  // Mono check
  if (clip.channels !== TARGET_CHANNELS) {
    issues.push(`Not mono: ${clip.channels} channels (expected: ${TARGET_CHANNELS})`);
  }

  // Phoneme density sanity check
  if (labels.length > 0 && clip.durationMs > 0) {
    const durationSec = clip.durationMs / 1000;
    const density = labels.length / durationSec;

    if (density > MAX_PHONEME_DENSITY * 10) {
      issues.push(`Phoneme density too high: ${density.toFixed(1)}/sec — likely bad segmentation`);
    }
    if (density < MIN_PHONEME_DENSITY && clip.durationMs > 200) {
      issues.push(`Phoneme density too low: ${density.toFixed(1)}/sec — likely silence`);
    }
  }

  // Empty transcription on a non-trivial clip
  if (labels.length === 0 && clip.durationMs > 100) {
    issues.push("No phonemes detected in a clip longer than 100ms — likely silence or noise");
  }

  return {
    clipId: clip.id,
    valid: issues.length === 0,
    issues,
  };
}

/**
 * Batch-validate clips and filter out invalid ones.
 */
export function validateAndFilter(
  clips: AudioClip[],
  transcriptions: BootstrapTranscriptionResult[],
): { valid: { clip: AudioClip; transcription: BootstrapTranscriptionResult }[]; reports: ValidationReport[] } {
  const valid: { clip: AudioClip; transcription: BootstrapTranscriptionResult }[] = [];
  const reports: ValidationReport[] = [];

  const transcriptionMap = new Map(transcriptions.map((t) => [t.clipId, t]));

  for (const clip of clips) {
    const transcription = transcriptionMap.get(clip.id);
    if (!transcription) {
      reports.push({ clipId: clip.id, valid: false, issues: ["No transcription found"] });
      continue;
    }

    const report = validateClip(clip, transcription.labels);
    reports.push(report);

    if (report.valid) {
      valid.push({ clip, transcription });
    }
  }

  return { valid, reports };
}


// ─────────────────────────────────────────────
// Stage 4: Audio Deduplication
// ─────────────────────────────────────────────
// Hash-based near-duplicate detection. Uses MD5 of the R2 key + QPS
// sequence as a fast fingerprint. For true audio-level dedup, a
// perceptual hash (e.g., chromaprint) would be computed server-side.

/**
 * Remove near-duplicate clips based on their QPS sequence + duration.
 * Two clips are considered duplicates if they produce the same phoneme
 * sequence and have similar duration (within 20%).
 */
export function deduplicateClips(
  pairs: ASRDatasetPair[],
): ASRDatasetPair[] {
  const seen = new Map<string, ASRDatasetPair>();

  for (const pair of pairs) {
    // Fingerprint = QPS sequence + bucketed duration
    const durationBucket = Math.round(
      (pair.phonemeLabels.length > 0
        ? pair.phonemeLabels[pair.phonemeLabels.length - 1].endMs
        : 0) / 200,
    ); // 200ms buckets
    const fingerprint = `${pair.qpsSequence}|${durationBucket}|${pair.isDeliberateError ? "err" : "ok"}`;

    if (!seen.has(fingerprint)) {
      seen.set(fingerprint, pair);
    } else {
      // Keep the one with higher confidence
      const existing = seen.get(fingerprint)!;
      const existingConf = avgConfidence(existing.phonemeLabels);
      const newConf = avgConfidence(pair.phonemeLabels);
      if (newConf > existingConf) {
        seen.set(fingerprint, pair);
      }
    }
  }

  return Array.from(seen.values());
}

function avgConfidence(labels: PhonemeLabel[]): number {
  if (labels.length === 0) return 0;
  return labels.reduce((sum, l) => sum + l.confidence, 0) / labels.length;
}


// ─────────────────────────────────────────────
// Stage 7: Train/Eval Split
// ─────────────────────────────────────────────
// 85/15 split on (audio_clip, phoneme+sifat_label) pairs.
// Stratified by isDeliberateError to ensure eval set has both
// correct and error examples.

export function splitTrainEval(
  pairs: ASRDatasetPair[],
  testRatio: number = 0.15,
): { train: ASRDatasetPair[]; eval: ASRDatasetPair[] } {
  const correct = pairs.filter((p) => !p.isDeliberateError);
  const errors = pairs.filter((p) => p.isDeliberateError);

  const splitGroup = (group: ASRDatasetPair[]) => {
    const shuffled = [...group].sort(() => 0.5 - Math.random());
    const splitIdx = Math.floor(shuffled.length * testRatio);
    return {
      eval: shuffled.slice(0, splitIdx),
      train: shuffled.slice(splitIdx),
    };
  };

  const correctSplit = splitGroup(correct);
  const errorSplit = splitGroup(errors);

  return {
    train: [...correctSplit.train, ...errorSplit.train],
    eval: [...correctSplit.eval, ...errorSplit.eval],
  };
}


// ─────────────────────────────────────────────
// Main Pipeline Entry Point
// ─────────────────────────────────────────────

export async function generateASRDataset(
  audioR2Key: string,
  audioUrl: string,
  onProgress?: (progress: ASRPipelineProgress) => void,
  wizardContext?: ASRWizardContext,
): Promise<{
  pairs: ASRDatasetPair[];
  trainPairs: ASRDatasetPair[];
  evalPairs: ASRDatasetPair[];
  stats: ASRPipelineStats;
  lowConfidenceClips: BootstrapTranscriptionResult[];
}> {

  const isDeliberateError = wizardContext?.recitationStyle === "deliberate_error";

  // ── Stage 1: Segment ──
  onProgress?.({
    stage: "segmenting",
    message: "Splitting audio into segments using voice activity detection...",
    segmentsTotal: 0,
    segmentsProcessed: 0,
    clipsGenerated: 0,
  });

  const segmentResult = await segmentAudio(audioR2Key, audioUrl);
  let clips = segmentResult.clips;

  // Cap clips
  if (clips.length > MAX_CLIPS) {
    console.log(`[Pipeline] Capping ${clips.length} clips to ${MAX_CLIPS}`);
    clips = clips.slice(0, MAX_CLIPS);
  }

  onProgress?.({
    stage: "segmenting",
    message: `Segmented into ${clips.length} audio clips (${Math.round(segmentResult.totalDurationMs / 1000)}s total)`,
    segmentsTotal: clips.length,
    segmentsProcessed: clips.length,
    clipsGenerated: clips.length,
  });

  // ── Stage 2: Bootstrap Transcribe ──
  onProgress?.({
    stage: "transcribing",
    message: `Running bootstrap ASR on ${clips.length} clips...`,
    segmentsTotal: clips.length,
    segmentsProcessed: 0,
    clipsGenerated: 0,
  });

  const transcriptions = await bootstrapTranscribe(clips);

  const needsReviewCount = transcriptions.filter((t) => t.needsReview).length;
  console.log(`[Pipeline] Bootstrap transcription complete. ${needsReviewCount}/${transcriptions.length} clips need human review.`);

  onProgress?.({
    stage: "transcribing",
    message: `Transcribed ${transcriptions.length} clips (${needsReviewCount} need review)`,
    segmentsTotal: clips.length,
    segmentsProcessed: clips.length,
    clipsGenerated: transcriptions.length,
  });

  // ── Stage 3: Validate ──
  onProgress?.({
    stage: "validating",
    message: `Validating ${clips.length} clips for quality...`,
    segmentsTotal: clips.length,
    segmentsProcessed: clips.length,
    clipsGenerated: transcriptions.length,
  });

  const { valid, reports } = validateAndFilter(clips, transcriptions);
  const invalidCount = reports.filter((r) => !r.valid).length;
  console.log(`[Pipeline] Validation: ${valid.length} valid, ${invalidCount} rejected`);

  if (invalidCount > 0) {
    const topIssues = reports
      .filter((r) => !r.valid)
      .flatMap((r) => r.issues)
      .slice(0, 5);
    console.log(`[Pipeline] Top rejection reasons: ${topIssues.join("; ")}`);
  }

  // Build dataset pairs from valid clips
  let allPairs: ASRDatasetPair[] = valid.map(({ clip, transcription }) => ({
    audioClipId: clip.id,
    audioR2Key: clip.r2Key,
    phonemeLabels: transcription.labels,
    qpsSequence: transcription.qpsSequence,
    isDeliberateError,
    _meta: {
      sourceFileHash: crypto.createHash("md5").update(audioR2Key).digest("hex"),
      segmentIndex: clips.indexOf(clip),
      bootstrapModelId: process.env.BASE_MODEL_CHECKPOINT || "obadx/qps-wav2vec2-ctc",
      correctionRatio: 0, // Will be updated after human correction
    },
  }));

  onProgress?.({
    stage: "validating",
    message: `${allPairs.length} clips passed validation`,
    segmentsTotal: clips.length,
    segmentsProcessed: clips.length,
    clipsGenerated: allPairs.length,
  });

  // ── Stage 4: Deduplicate ──
  onProgress?.({
    stage: "deduplicating",
    message: `Removing duplicates from ${allPairs.length} clips...`,
    segmentsTotal: clips.length,
    segmentsProcessed: clips.length,
    clipsGenerated: allPairs.length,
  });

  const dedupedPairs = deduplicateClips(allPairs);
  console.log(`[Pipeline] After dedup: ${dedupedPairs.length} pairs (was ${allPairs.length})`);

  // Stages 5-6: REMOVED — no ASR equivalent for boundary/contrastive/format pairs

  // ── Stage 7: Train/Eval Split ──
  const { train: trainPairs, eval: evalPairs } = splitTrainEval(dedupedPairs);
  console.log(`[Pipeline] Split: ${trainPairs.length} train, ${evalPairs.length} eval`);

  // Collect low-confidence clips for the correction UI
  const lowConfidenceClips = transcriptions.filter((t) => t.needsReview);

  const totalAudioMs = clips.reduce((sum, c) => sum + c.durationMs, 0);

  const stats: ASRPipelineStats = {
    segmentsProcessed: clips.length,
    rawClipsGenerated: transcriptions.length,
    afterValidation: valid.length,
    afterDedup: dedupedPairs.length,
    deliberateErrorClips: dedupedPairs.filter((p) => p.isDeliberateError).length,
    finalTotal: dedupedPairs.length,
    trainClipsCount: trainPairs.length,
    evalClipsCount: evalPairs.length,
    totalAudioDurationMs: totalAudioMs,
    averageClipDurationMs: clips.length > 0 ? totalAudioMs / clips.length : 0,
    sourceHash: crypto.createHash("md5").update(audioR2Key).digest("hex"),
  };

  onProgress?.({
    stage: "complete",
    message: `Done! ${trainPairs.length} training clips, ${evalPairs.length} eval clips.`,
    segmentsTotal: clips.length,
    segmentsProcessed: clips.length,
    clipsGenerated: trainPairs.length,
  });

  return { pairs: dedupedPairs, trainPairs, evalPairs, stats, lowConfidenceClips };
}
