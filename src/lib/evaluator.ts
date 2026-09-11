// ─────────────────────────────────────────────
// ASR Evaluator — PER/CER + Tajweed-Rule Accuracy
// ─────────────────────────────────────────────
// Replaces the LLM-as-a-Judge evaluator with purely computational
// phonetic metrics. No Gemini judge calls needed — this is simpler
// and more deterministic than the old text-based evaluation.
//
// Metrics computed:
//   - PER (Phoneme Error Rate) — primary metric
//   - CER (Character Error Rate) — secondary
//   - WER (Word Error Rate) — for word-level groupings
//   - Per-Tajweed-rule accuracy breakdown
//   - Per-letter confusion matrix
//
// Methodology mirrors obadx's qdat_bench, which is the closest
// published benchmark to this exact task.
// ─────────────────────────────────────────────

import type {
  TajweedRule,
  ASRDatasetPair,
  PhonemeLabel,
} from "@/lib/qps-types";
import { ALL_TAJWEED_RULES, TAJWEED_RULE_LABELS } from "@/lib/qps-types";


// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export interface ASREvalReport {
  /** Phoneme Error Rate (0-1, lower is better) */
  per: number;
  /** Character Error Rate (0-1, lower is better) */
  cer: number;
  /** Word Error Rate — for word-level groupings (0-1) */
  wer: number;
  /** Exact sequence match percentage (0-100) */
  exact_match_pct?: number;
  exactMatchPct?: number;
  /** Count match within +-1 phonemes percentage (0-100) */
  count_match_pct?: number;
  countMatchPct?: number;
  /** Accuracy breakdown per Tajweed rule */
  perTajweedRule: Record<string, TajweedRuleAccuracy>;
  /** Phoneme confusion matrix — which phonemes are most confused */
  confusionMatrix: ConfusionEntry[];
  /** Total number of audio segments evaluated */
  totalSegmentsEvaluated: number;
  /** Total phonemes compared */
  totalPhonemesCompared: number;
  /** ISO timestamp of evaluation */
  evaluatedAt: string;
  /** Whether any errors occurred during evaluation */
  hadErrors: boolean;
  /** Human-readable diagnostic guidance */
  diagnosticGuidance: DiagnosticItem[];
}

export interface TajweedRuleAccuracy {
  /** Total instances of this rule in the eval set */
  total: number;
  /** Number of correctly-handled instances */
  correct: number;
  /** Number of errors */
  errors: number;
  /** Accuracy (0-1) */
  accuracy: number;
}

export interface ConfusionEntry {
  /** Expected phoneme */
  expected: string;
  /** What the model produced instead */
  got: string;
  /** How many times this confusion occurred */
  count: number;
}

export interface DiagnosticItem {
  level: "info" | "warning" | "action";
  message: string;
  actionLabel?: string;
  actionType?: "add_data" | "more_steps" | "different_model" | "review_labels";
}


// ─────────────────────────────────────────────
// Edit Distance Computation
// ─────────────────────────────────────────────
// Used internally for PER/CER/WER computation.
// This is the same algorithm as jiwer uses internally, implemented
// here so evaluation can run in the Next.js API route without
// needing a Python dependency.

function editDistance(ref: string[], hyp: string[]): {
  distance: number;
  substitutions: number;
  deletions: number;
  insertions: number;
  alignedPairs: { ref: string | null; hyp: string | null }[];
} {
  const m = ref.length;
  const n = hyp.length;

  // DP table
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (ref[i - 1] === hyp[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
  }

  // Backtrace for substitution/deletion/insertion counts and aligned pairs
  let substitutions = 0, deletions = 0, insertions = 0;
  const alignedPairs: { ref: string | null; hyp: string | null }[] = [];
  let i = m, j = n;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && ref[i - 1] === hyp[j - 1]) {
      alignedPairs.unshift({ ref: ref[i - 1], hyp: hyp[j - 1] });
      i--; j--;
    } else if (i > 0 && j > 0 && dp[i][j] === dp[i - 1][j - 1] + 1) {
      substitutions++;
      alignedPairs.unshift({ ref: ref[i - 1], hyp: hyp[j - 1] });
      i--; j--;
    } else if (j > 0 && dp[i][j] === dp[i][j - 1] + 1) {
      insertions++;
      alignedPairs.unshift({ ref: null, hyp: hyp[j - 1] });
      j--;
    } else {
      deletions++;
      alignedPairs.unshift({ ref: ref[i - 1], hyp: null });
      i--;
    }
  }

  return { distance: dp[m][n], substitutions, deletions, insertions, alignedPairs };
}


// ─────────────────────────────────────────────
// PER / CER / WER Computation
// ─────────────────────────────────────────────

/** Compute Phoneme Error Rate: edit_distance(ref, hyp) / len(ref) */
export function computePER(
  referenceSequences: string[][],
  hypothesisSequences: string[][],
): number {
  if (referenceSequences.length === 0) return 0;

  let totalDistance = 0;
  let totalRefLength = 0;

  for (let i = 0; i < referenceSequences.length; i++) {
    const ref = referenceSequences[i] || [];
    const hyp = hypothesisSequences[i] || [];
    const { distance } = editDistance(ref, hyp);
    totalDistance += distance;
    totalRefLength += ref.length;
  }

  return totalRefLength > 0 ? totalDistance / totalRefLength : 0;
}

/** Compute Character Error Rate: same as PER but on individual characters */
export function computeCER(
  referenceStrings: string[],
  hypothesisStrings: string[],
): number {
  const refChars = referenceStrings.map((s) => s.split(""));
  const hypChars = hypothesisStrings.map((s) => s.split(""));
  return computePER(refChars, hypChars);
}


// ─────────────────────────────────────────────
// Confusion Matrix Builder
// ─────────────────────────────────────────────

function buildConfusionMatrix(
  referenceSequences: string[][],
  hypothesisSequences: string[][],
): ConfusionEntry[] {
  const confusions = new Map<string, number>();

  for (let i = 0; i < referenceSequences.length; i++) {
    const ref = referenceSequences[i] || [];
    const hyp = hypothesisSequences[i] || [];
    const { alignedPairs } = editDistance(ref, hyp);

    for (const pair of alignedPairs) {
      if (pair.ref && pair.hyp && pair.ref !== pair.hyp) {
        const key = `${pair.ref}→${pair.hyp}`;
        confusions.set(key, (confusions.get(key) || 0) + 1);
      }
    }
  }

  return Array.from(confusions.entries())
    .map(([key, count]) => {
      const [expected, got] = key.split("→");
      return { expected, got, count };
    })
    .sort((a, b) => b.count - a.count);
}


// ─────────────────────────────────────────────
// Tajweed Rule Accuracy
// ─────────────────────────────────────────────
// For each Tajweed rule, compute how often the model correctly handles
// instances where that rule applies. This requires knowing which
// phonemes in the reference involve which rules.
//
// For now, uses a simplified heuristic based on phoneme symbol patterns.
// A full implementation would use the canonical reference table to
// annotate which evaluation pairs involve which Tajweed rules.

const TAJWEED_PHONEME_INDICATORS: Partial<Record<TajweedRule, (ref: string[], hyp: string[]) => { total: number; correct: number }>> = {
  ghunnah: (ref, hyp) => {
    const ghunnahPhonemes = ["ŋ"];
    return countMatchRate(ref, hyp, ghunnahPhonemes);
  },
  qalqalah: (ref, hyp) => {
    // Qalqalah letters: ق ط ب ج د → q, tˤ, b, dʒ, d
    const qalqalahPhonemes = ["q", "tˤ", "b", "dʒ", "d"];
    return countMatchRate(ref, hyp, qalqalahPhonemes);
  },
  tafkheem: (ref, hyp) => {
    // Emphatic/heavy letters
    const emphatics = ["sˤ", "dˤ", "tˤ", "ðˤ", "q", "x", "ɣ"];
    return countMatchRate(ref, hyp, emphatics);
  },
  tarqeeq: (ref, hyp) => {
    // Non-emphatic letters that might be incorrectly made heavy
    // This checks that non-emphatic phonemes stay non-emphatic
    const lightPhonemes = ["s", "d", "t", "ð"];
    return countMatchRate(ref, hyp, lightPhonemes);
  },
};

function countMatchRate(
  ref: string[],
  hyp: string[],
  targetPhonemes: string[],
): { total: number; correct: number } {
  const { alignedPairs } = editDistance(ref, hyp);
  let total = 0;
  let correct = 0;

  for (const pair of alignedPairs) {
    if (pair.ref && targetPhonemes.includes(pair.ref)) {
      total++;
      if (pair.hyp === pair.ref) {
        correct++;
      }
    }
  }

  return { total, correct };
}


// ─────────────────────────────────────────────
// Diagnostic Guidance
// ─────────────────────────────────────────────

function generateDiagnostics(
  per: number,
  ruleAccuracy: Record<string, TajweedRuleAccuracy>,
  confusionMatrix: ConfusionEntry[],
  totalSegments: number,
  correctionRatio: number,
): DiagnosticItem[] {
  const items: DiagnosticItem[] = [];

  // Overall PER assessment
  if (per < 0.05) {
    items.push({ level: "info", message: "Excellent PER (<5%) — model performs at near-human accuracy for in-scope phonemes." });
  } else if (per < 0.15) {
    items.push({ level: "info", message: `Good PER (${(per * 100).toFixed(1)}%) — model handles most phonemes correctly.` });
  } else if (per < 0.30) {
    items.push({ level: "warning", message: `Moderate PER (${(per * 100).toFixed(1)}%) — consider adding more training data or more training steps.` });
  } else {
    items.push({
      level: "action",
      message: `High PER (${(per * 100).toFixed(1)}%) — model needs significant improvement.`,
      actionLabel: "More Training Steps",
      actionType: "more_steps",
    });
  }

  // Low data warning
  if (totalSegments < 100) {
    items.push({
      level: "action",
      message: `Only ${totalSegments} evaluation segments — results may not be statistically reliable. Add more audio data.`,
      actionLabel: "Add More Data",
      actionType: "add_data",
    });
  }

  // Low correction ratio warning
  if (correctionRatio < 0.3 && totalSegments > 50) {
    items.push({
      level: "warning",
      message: `Only ${(correctionRatio * 100).toFixed(0)}% of labels were human-corrected. Higher correction rates improve training quality.`,
      actionLabel: "Review Labels",
      actionType: "review_labels",
    });
  }

  // Per-rule weaknesses
  for (const [rule, accuracy] of Object.entries(ruleAccuracy)) {
    if (accuracy.total >= 5 && accuracy.accuracy < 0.6) {
      const label = TAJWEED_RULE_LABELS[rule as TajweedRule] || rule;
      items.push({
        level: "warning",
        message: `Weak on ${label}: ${(accuracy.accuracy * 100).toFixed(0)}% accuracy (${accuracy.errors} errors in ${accuracy.total} instances). Consider adding more training examples with this rule.`,
        actionLabel: "Add More Data",
        actionType: "add_data",
      });
    }
  }

  // Top confusions
  if (confusionMatrix.length > 0) {
    const top3 = confusionMatrix.slice(0, 3);
    const confList = top3.map((c) => `${c.expected}→${c.got} (${c.count}x)`).join(", ");
    items.push({
      level: "info",
      message: `Most common confusions: ${confList}. These phoneme pairs may need targeted training data.`,
    });
  }

  return items;
}


// ─────────────────────────────────────────────
// Main Evaluation Entry Point
// ─────────────────────────────────────────────

/**
 * Run full evaluation on a fine-tuned ASR model's predictions.
 *
 * @param evalPairs — The held-out evaluation pairs (ground truth)
 * @param modelPredictions — The model's predicted phoneme sequences for each eval pair
 * @param correctionRatio — Fraction of training labels that were human-corrected
 */
export function evaluateASRModel(
  evalPairs: ASRDatasetPair[],
  modelPredictions: string[][],
  correctionRatio: number = 0,
): ASREvalReport {
  if (evalPairs.length !== modelPredictions.length) {
    throw new Error(
      `Eval pair count (${evalPairs.length}) doesn't match prediction count (${modelPredictions.length})`,
    );
  }

  // Extract reference sequences
  const referenceSequences = evalPairs.map((pair) =>
    pair.phonemeLabels.map((l) => l.phoneme),
  );
  const referenceStrings = referenceSequences.map((seq) => seq.join(" "));
  const hypothesisStrings = modelPredictions.map((seq) => seq.join(" "));

  // Compute core metrics
  const per = computePER(referenceSequences, modelPredictions);
  const cer = computeCER(referenceStrings, hypothesisStrings);

  // WER — treat each QPS sequence as a "word"
  const refWords = referenceStrings.map((s) => s.split(/\s+/).filter(Boolean));
  const hypWords = hypothesisStrings.map((s) => s.split(/\s+/).filter(Boolean));
  const wer = computePER(refWords, hypWords);

  // Confusion matrix
  const confusionMatrix = buildConfusionMatrix(referenceSequences, modelPredictions);

  // Per-Tajweed-rule accuracy
  const perTajweedRule: Record<string, TajweedRuleAccuracy> = {};

  for (const rule of ALL_TAJWEED_RULES) {
    const indicator = TAJWEED_PHONEME_INDICATORS[rule];
    if (indicator) {
      let totalForRule = 0;
      let correctForRule = 0;

      for (let i = 0; i < referenceSequences.length; i++) {
        const { total, correct } = indicator(referenceSequences[i], modelPredictions[i]);
        totalForRule += total;
        correctForRule += correct;
      }

      if (totalForRule > 0) {
        perTajweedRule[rule] = {
          total: totalForRule,
          correct: correctForRule,
          errors: totalForRule - correctForRule,
          accuracy: correctForRule / totalForRule,
        };
      }
    }
  }

  // Total phonemes compared
  const totalPhonemesCompared = referenceSequences.reduce((sum, seq) => sum + seq.length, 0);

  // Diagnostic guidance
  const diagnosticGuidance = generateDiagnostics(
    per,
    perTajweedRule,
    confusionMatrix,
    evalPairs.length,
    correctionRatio,
  );

  return {
    per,
    cer,
    wer,
    perTajweedRule,
    confusionMatrix,
    totalSegmentsEvaluated: evalPairs.length,
    totalPhonemesCompared,
    evaluatedAt: new Date().toISOString(),
    hadErrors: false,
    diagnosticGuidance,
  };
}


/**
 * Format PER as a percentage string for display.
 */
export function formatPER(per: number): string {
  return `${(per * 100).toFixed(1)}%`;
}

/**
 * Get a letter grade based on PER.
 */
export function perToGrade(per: number): { grade: string; label: string; color: string } {
  if (per < 0.05) return { grade: "A+", label: "Excellent", color: "#10b981" };
  if (per < 0.10) return { grade: "A",  label: "Very Good", color: "#22c55e" };
  if (per < 0.15) return { grade: "B+", label: "Good",      color: "#84cc16" };
  if (per < 0.20) return { grade: "B",  label: "Fair",      color: "#eab308" };
  if (per < 0.30) return { grade: "C",  label: "Needs Work", color: "#f97316" };
  return { grade: "D", label: "Poor", color: "#ef4444" };
}
