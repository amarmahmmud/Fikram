// ─────────────────────────────────────────────
// Two-Tier Alignment Engine
// ─────────────────────────────────────────────
// Implements Tarteel's proven two-tier approach for phoneme-level
// Tajweed mistake detection:
//
//   Outer tier: text/phoneme-level fuzzy matching (edit-distance)
//     → word/unit-level alignment, tolerant of ASR noise, cheap to compute
//
//   Inner tier: CTC forced-alignment (not naive greedy decode)
//     → phoneme-level timing precision within a matched unit
//
// CONFIDENCE GATING is the #1 design priority. False-positive error
// flags are the primary real-world complaint against Tarteel-style tools.
// Every mistake must exceed the confidence threshold before being surfaced.
// ─────────────────────────────────────────────

import type {
  QPSPhoneme,
  TajweedRule,
  TajweedMistake,
  TajweedMistakeType,
  PhonemeAlignment,
  AlignmentResult,
  PhonemeLabel,
} from "@/lib/qps-types";
import { getExpectedPhonemes, lookupUnit } from "@/lib/canonical-reference";

// ─────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────

/** Default confidence threshold — only surface mistakes above this value.
 *  Tunable per-deployment. Start conservative (0.7) and lower once you have
 *  real false-positive rate data. */
export const DEFAULT_CONFIDENCE_THRESHOLD = 0.7;

/** Maximum edit distance ratio for outer-tier matching to consider
 *  two sequences as "aligned" (0.0 = exact match, 1.0 = completely different) */
const MAX_EDIT_DISTANCE_RATIO = 0.5;

/** Minimum phoneme duration (ms) below which we suspect a deletion/skip */
const MIN_PHONEME_DURATION_MS = 20;

/** Madd duration thresholds (ms) — based on standard Tajweed timing rules */
const MADD_DURATION_THRESHOLDS = {
  short_max: 120,       // Below this = too short for madd tabii
  tabii_min: 100,       // Madd tabii: ~2 counts
  tabii_max: 300,
  munfasil_min: 200,    // 4-5 counts
  munfasil_max: 500,
  lazim_min: 400,       // 6 counts
  lazim_max: 800,
};


// ─────────────────────────────────────────────
// Outer Tier: Edit-Distance Phoneme Matching
// ─────────────────────────────────────────────
// Uses Levenshtein distance on phoneme symbol sequences to align
// the ASR output against the canonical reference. This tier is
// deliberately tolerant of noise — its job is unit-level matching,
// not phoneme-level precision.

/**
 * Compute Levenshtein edit distance between two string arrays.
 * Returns the distance and the alignment operations.
 */
interface EditOp {
  type: "match" | "substitute" | "insert" | "delete";
  expectedIdx: number;   // Index in expected sequence (-1 for insert)
  gotIdx: number;        // Index in got sequence (-1 for delete)
}

function computeEditDistance(expected: string[], got: string[]): { distance: number; ops: EditOp[] } {
  const m = expected.length;
  const n = got.length;

  // DP table
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (expected[i - 1] === got[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(
          dp[i - 1][j],     // delete
          dp[i][j - 1],     // insert
          dp[i - 1][j - 1], // substitute
        );
      }
    }
  }

  // Backtrace to get operations
  const ops: EditOp[] = [];
  let i = m, j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && expected[i - 1] === got[j - 1]) {
      ops.unshift({ type: "match", expectedIdx: i - 1, gotIdx: j - 1 });
      i--; j--;
    } else if (i > 0 && j > 0 && dp[i][j] === dp[i - 1][j - 1] + 1) {
      ops.unshift({ type: "substitute", expectedIdx: i - 1, gotIdx: j - 1 });
      i--; j--;
    } else if (j > 0 && dp[i][j] === dp[i][j - 1] + 1) {
      ops.unshift({ type: "insert", expectedIdx: -1, gotIdx: j - 1 });
      j--;
    } else {
      ops.unshift({ type: "delete", expectedIdx: i - 1, gotIdx: -1 });
      i--;
    }
  }

  return { distance: dp[m][n], ops };
}


// ─────────────────────────────────────────────
// Inner Tier: Phoneme-Level Alignment & Timing
// ─────────────────────────────────────────────
// Takes the outer-tier alignment operations and combines them with
// CTC timing data (from the PhonemeLabel timestamps) to produce
// precise per-phoneme alignments.
//
// NOTE: True CTC forced-alignment requires running the CTC model
// in forced-align mode (constraining the output path through the
// CTC lattice to the reference sequence). This implementation uses
// the bootstrap model's frame-level timestamps as a proxy. For
// production-quality forced alignment, this should call back to
// Modal or use a local torchaudio forced_align implementation.

function buildPhonemeAlignments(
  expectedPhonemes: QPSPhoneme[],
  gotLabels: PhonemeLabel[],
  editOps: EditOp[],
): PhonemeAlignment[] {
  const alignments: PhonemeAlignment[] = [];

  for (const op of editOps) {
    const expectedPhoneme = op.expectedIdx >= 0 ? expectedPhonemes[op.expectedIdx] : null;
    const gotLabel = op.gotIdx >= 0 ? gotLabels[op.gotIdx] : null;

    if (!expectedPhoneme) continue; // Skip pure insertions for alignment output

    alignments.push({
      expected: expectedPhoneme,
      got: gotLabel?.phoneme ?? null,
      timingMs: gotLabel
        ? { start: gotLabel.startMs, end: gotLabel.endMs }
        : { start: 0, end: 0 },
      confidence: gotLabel?.confidence ?? 0,
    });
  }

  return alignments;
}


// ─────────────────────────────────────────────
// Mistake Detection
// ─────────────────────────────────────────────
// Analyzes the alignment to detect specific Tajweed mistakes.
// Each mistake is assigned a confidence score and severity.

function detectMistakes(
  expectedPhonemes: QPSPhoneme[],
  gotLabels: PhonemeLabel[],
  editOps: EditOp[],
  applicableRules: TajweedRule[],
): TajweedMistake[] {
  const mistakes: TajweedMistake[] = [];

  for (const op of editOps) {
    const expected = op.expectedIdx >= 0 ? expectedPhonemes[op.expectedIdx] : null;
    const got = op.gotIdx >= 0 ? gotLabels[op.gotIdx] : null;

    // ── Deletion: expected phoneme not found in output ──
    if (op.type === "delete" && expected) {
      mistakes.push({
        type: "skipped_letter",
        position: op.expectedIdx,
        expected: expected.symbol,
        got: "",
        confidence: 0.8, // High confidence — phoneme is simply missing
        severity: "major",
        rule: undefined,
      });
    }

    // ── Insertion: extra phoneme in output ──
    if (op.type === "insert" && got) {
      mistakes.push({
        type: "added_letter",
        position: op.gotIdx,
        expected: "",
        got: got.phoneme,
        confidence: got.confidence,
        severity: "minor",
        rule: undefined,
      });
    }

    // ── Substitution: wrong phoneme ──
    if (op.type === "substitute" && expected && got) {
      // Determine if this is a haraka error or a makhraj error
      const isVowelExpected = ["a", "i", "u", "an", "in", "un", "aː", "iː", "uː"].includes(expected.symbol);
      const isVowelGot = ["a", "i", "u", "an", "in", "un", "aː", "iː", "uː"].includes(got.phoneme);

      let mistakeType: TajweedMistakeType;
      let severity: TajweedMistake["severity"];

      if (isVowelExpected && isVowelGot) {
        // Wrong vowel/haraka
        mistakeType = "wrong_haraka";
        severity = "major"; // Haraka errors change meaning
      } else if (!isVowelExpected && !isVowelGot) {
        // Wrong consonant — check if it's a makhraj confusion
        mistakeType = "wrong_makhraj";
        severity = "critical"; // Wrong letter is a critical error
      } else {
        // Vowel/consonant type mismatch
        mistakeType = "wrong_haraka";
        severity = "major";
      }

      // Check for tafkheem/tarqeeq confusion
      if (expected.sifat.includes("isti_ala") && !isSifatMatch(expected.sifat, got.sifat)) {
        mistakeType = "wrong_tafkheem";
      } else if (!expected.sifat.includes("isti_ala") && got.sifat === "isti_ala") {
        mistakeType = "wrong_tarqeeq";
      }

      mistakes.push({
        type: mistakeType,
        position: op.expectedIdx,
        expected: expected.symbol,
        got: got.phoneme,
        confidence: got.confidence,
        severity,
        rule: inferViolatedRule(mistakeType, expected, applicableRules),
      });
    }

    // ── Match: check timing-based Tajweed errors ──
    if (op.type === "match" && expected && got) {
      const duration = got.endMs - got.startMs;

      // Check madd duration
      if (expected.durationClass === "long" || expected.durationClass === "extended") {
        if (duration < MADD_DURATION_THRESHOLDS.short_max) {
          mistakes.push({
            type: "madd_too_short",
            position: op.expectedIdx,
            expected: `${expected.symbol} (${expected.durationClass})`,
            got: `${got.phoneme} (${duration}ms)`,
            confidence: Math.min(got.confidence, 0.7),
            severity: "minor",
            rule: inferMaddRule(expected.durationClass),
          });
        }
      }

      // Check qalqalah presence on qalqalah letters
      if (expected.sifat.includes("qalqalah") && applicableRules.includes("qalqalah")) {
        // Qalqalah detection is hard without a dedicated qalqalah classifier;
        // flag as low-confidence for now
        if (duration < MIN_PHONEME_DURATION_MS) {
          mistakes.push({
            type: "missing_qalqalah",
            position: op.expectedIdx,
            expected: `${expected.symbol} with qalqalah`,
            got: `${got.phoneme} (${duration}ms — too brief)`,
            confidence: 0.5,  // Low confidence — this needs specialized detection
            severity: "minor",
            rule: "qalqalah",
          });
        }
      }

      // Check ghunnah on noon/meem
      if (expected.makhraj === "khayshum" && applicableRules.includes("ghunnah")) {
        if (duration < MADD_DURATION_THRESHOLDS.short_max) {
          mistakes.push({
            type: "missing_ghunnah",
            position: op.expectedIdx,
            expected: `${expected.symbol} with ghunnah (~2 counts)`,
            got: `${got.phoneme} (${duration}ms — too brief)`,
            confidence: 0.6,
            severity: "minor",
            rule: "ghunnah",
          });
        }
      }
    }
  }

  return mistakes;
}

/** Check if the sifat of a detected phoneme matches the expected sifat */
function isSifatMatch(expectedSifat: string[], gotSifat?: string): boolean {
  if (!gotSifat) return false;
  return expectedSifat.includes(gotSifat);
}

/** Infer which Tajweed rule was violated based on mistake type and expected phoneme */
function inferViolatedRule(
  mistakeType: TajweedMistakeType,
  expected: QPSPhoneme,
  applicableRules: TajweedRule[],
): TajweedRule | undefined {
  if (mistakeType === "wrong_tafkheem") return "tafkheem";
  if (mistakeType === "wrong_tarqeeq") return "tarqeeq";
  if (mistakeType === "missing_ghunnah") return "ghunnah";
  if (mistakeType === "missing_qalqalah") return "qalqalah";

  // For generic substitutions, check if any applicable rule is relevant
  if (expected.sifat.includes("qalqalah") && applicableRules.includes("qalqalah")) {
    return "qalqalah";
  }

  return undefined;
}

/** Map duration class to the most likely madd rule */
function inferMaddRule(durationClass: QPSPhoneme["durationClass"]): TajweedRule {
  switch (durationClass) {
    case "long": return "madd_tabii";
    case "extended": return "madd_lazim";
    default: return "madd_tabii";
  }
}


// ─────────────────────────────────────────────
// Main Alignment Entry Point
// ─────────────────────────────────────────────

/**
 * Align a detected phoneme sequence against a canonical reference unit.
 *
 * Two-tier approach:
 *   1. Outer tier — edit-distance alignment of phoneme symbol sequences
 *   2. Inner tier — phoneme-level timing from bootstrap CTC timestamps
 *
 * @param unitId — The Noorani Qaida unit ID to align against
 * @param detectedLabels — PhonemeLabels from the bootstrap ASR model
 * @param confidenceThreshold — Minimum confidence to surface a mistake (default 0.7)
 */
export function alignAndDetectMistakes(
  unitId: string,
  detectedLabels: PhonemeLabel[],
  confidenceThreshold: number = DEFAULT_CONFIDENCE_THRESHOLD,
): AlignmentResult {
  const unit = lookupUnit(unitId);
  if (!unit) {
    return {
      unitId,
      aligned: false,
      phonemeAlignments: [],
      mistakes: [],
      overallConfidence: 0,
    };
  }

  const expectedPhonemes = unit.expectedPhonemes;
  const expectedSymbols = expectedPhonemes.map((p) => p.symbol);
  const gotSymbols = detectedLabels.map((l) => l.phoneme);

  // ── Outer tier: edit-distance alignment ──
  const { distance, ops } = computeEditDistance(expectedSymbols, gotSymbols);
  const maxLen = Math.max(expectedSymbols.length, gotSymbols.length, 1);
  const distanceRatio = distance / maxLen;

  // If edit distance ratio is too high, the sequences are too different
  // to align meaningfully — likely the wrong unit was selected
  if (distanceRatio > MAX_EDIT_DISTANCE_RATIO) {
    return {
      unitId,
      aligned: false,
      phonemeAlignments: [],
      mistakes: [],
      overallConfidence: 1 - distanceRatio,
    };
  }

  // ── Inner tier: phoneme-level alignment with timing ──
  const phonemeAlignments = buildPhonemeAlignments(expectedPhonemes, detectedLabels, ops);

  // ── Mistake detection ──
  const allMistakes = detectMistakes(expectedPhonemes, detectedLabels, ops, unit.tajweedRules);

  // ── Confidence gating ──
  // CRITICAL: Only surface mistakes above the threshold.
  // False-positive error flags are the #1 complaint against Tarteel-style tools.
  const filteredMistakes = allMistakes.filter((m) => m.confidence >= confidenceThreshold);

  // Overall confidence: average of all alignment confidences
  const avgConfidence = phonemeAlignments.length > 0
    ? phonemeAlignments.reduce((sum, a) => sum + a.confidence, 0) / phonemeAlignments.length
    : 0;

  return {
    unitId,
    aligned: true,
    phonemeAlignments,
    mistakes: filteredMistakes,
    overallConfidence: avgConfidence,
  };
}


/**
 * Batch-align multiple units — used for evaluating a full recitation
 * against a lesson's worth of expected units.
 */
export function batchAlign(
  unitIds: string[],
  detectedLabelsPerUnit: PhonemeLabel[][],
  confidenceThreshold: number = DEFAULT_CONFIDENCE_THRESHOLD,
): AlignmentResult[] {
  if (unitIds.length !== detectedLabelsPerUnit.length) {
    throw new Error(
      `Mismatched unit/label counts: ${unitIds.length} units vs ${detectedLabelsPerUnit.length} label sets`,
    );
  }

  return unitIds.map((unitId, i) =>
    alignAndDetectMistakes(unitId, detectedLabelsPerUnit[i], confidenceThreshold),
  );
}


/**
 * Compute aggregate mistake statistics for an evaluation report.
 * Groups mistakes by Tajweed rule and by mistake type.
 */
export function aggregateMistakeStats(results: AlignmentResult[]): {
  totalMistakes: number;
  byType: Record<string, number>;
  byRule: Record<string, { total: number; count: number }>;
  avgConfidence: number;
} {
  const byType: Record<string, number> = {};
  const byRule: Record<string, { total: number; count: number }> = {};
  let totalMistakes = 0;
  let confidenceSum = 0;
  let alignedCount = 0;

  for (const result of results) {
    if (result.aligned) {
      alignedCount++;
      confidenceSum += result.overallConfidence;
    }

    for (const mistake of result.mistakes) {
      totalMistakes++;
      byType[mistake.type] = (byType[mistake.type] || 0) + 1;

      if (mistake.rule) {
        if (!byRule[mistake.rule]) {
          byRule[mistake.rule] = { total: 0, count: 0 };
        }
        byRule[mistake.rule].count++;
      }
    }
  }

  // Also track total units evaluated per rule for accuracy calculation
  for (const result of results) {
    const unit = lookupUnit(result.unitId);
    if (unit) {
      for (const rule of unit.tajweedRules) {
        if (!byRule[rule]) {
          byRule[rule] = { total: 0, count: 0 };
        }
        byRule[rule].total++;
      }
    }
  }

  return {
    totalMistakes,
    byType,
    byRule,
    avgConfidence: alignedCount > 0 ? confidenceSum / alignedCount : 0,
  };
}
