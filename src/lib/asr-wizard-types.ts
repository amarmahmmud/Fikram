// ─────────────────────────────────────────────
// ASR Wizard Types — Replaces wizard-types.ts
// ─────────────────────────────────────────────
// This file replaces the old WizardContext / InterviewAnswerMap / identity
// interview types with ASR-specific types for the Noorani Qaida pipeline.
// The old persona/audience/style/format/boundaries concepts have NO equivalent
// in a CTC acoustic model — confirmed and removed.

import type { TajweedRule } from "@/lib/qps-types";

// ── Wizard Question IDs (ASR version) ──
// Each wizard question is tagged with a stable ID. Much simpler than the
// old 5-question identity interview — ASR needs only scope + level + data type.
export const ASR_WIZARD_QUESTION_IDS = {
  SCOPE: "scope",
  LEVEL: "level",
  DATA_TYPE: "data_type",
} as const;

export type ASRWizardQuestionId = (typeof ASR_WIZARD_QUESTION_IDS)[keyof typeof ASR_WIZARD_QUESTION_IDS];

export type ASRInterviewAnswerMap = Partial<Record<ASRWizardQuestionId, string>>;


// ── Tajweed Scope ──
// Defines which letters, harakat, rules, and Noorani Qaida lessons
// this training job targets.
export interface TajweedScope {
  /** Arabic letters in scope (e.g., ["ب", "ت", "ث"]) */
  letters: string[];
  /** Diacritical marks in scope (e.g., ["فتحة", "ضمة", "كسرة"]) */
  harakat: string[];
  /** Tajweed rules in scope */
  rules: TajweedRule[];
  /** Noorani Qaida lesson numbers (1–17) */
  lessons: number[];
}

export const EMPTY_TAJWEED_SCOPE: TajweedScope = {
  letters: [],
  harakat: [],
  rules: [],
  lessons: [],
};


// ── ASR Wizard Context ──
// The enriched context collected from the ASR wizard.
// Flows: wizard UI → generate-dataset API → dataset pipeline.
export interface ASRWizardContext {
  /** Target scope: which letters/harakat/rules/lessons this job covers */
  targetScope: TajweedScope;
  /** Learner proficiency level — affects expected error patterns */
  learnerLevel: "beginner" | "intermediate" | "advanced";
  /** Whether user has pre-labeled audio or needs bootstrap transcription */
  hasPreLabeledData: boolean;
  /** Which phonetic script to use for labels */
  scriptType: "QPS" | "IPA" | "orthographic";
  /** Whether the uploaded audio contains correct, intentional-error, or mixed recitation */
  recitationStyle: "correct_reference" | "deliberate_error" | "mixed";
  /** Whether to optimize for real-time (<200ms) inference — filters model catalog */
  optimizeForRealtime: boolean;
}

export const EMPTY_ASR_WIZARD_CONTEXT: ASRWizardContext = {
  targetScope: EMPTY_TAJWEED_SCOPE,
  learnerLevel: "beginner",
  hasPreLabeledData: false,
  scriptType: "QPS",
  recitationStyle: "correct_reference",
  optimizeForRealtime: false,
};


// ── Validation ──
// Validates ASR wizard context before it flows downstream.
// Much simpler than the old text-based validation — no "suspicious chat phrases" etc.

export interface ASRWizardValidationWarning {
  field: string;
  value: string;
  reason: string;
}

export function validateASRWizardContext(ctx: ASRWizardContext): ASRWizardValidationWarning[] {
  const warnings: ASRWizardValidationWarning[] = [];

  // Must have at least some scope selected
  const scope = ctx.targetScope;
  const hasScope = scope.letters.length > 0 || scope.harakat.length > 0 ||
                   scope.rules.length > 0 || scope.lessons.length > 0;
  if (!hasScope) {
    warnings.push({
      field: "targetScope",
      value: "empty",
      reason: "No letters, harakat, rules, or lessons selected. Select at least one scope item.",
    });
  }

  // If deliberate_error style, warn that labels need manual review
  if (ctx.recitationStyle === "deliberate_error" && !ctx.hasPreLabeledData) {
    warnings.push({
      field: "recitationStyle",
      value: ctx.recitationStyle,
      reason: "Deliberate-error audio without pre-labeled data requires significant manual correction in the review step.",
    });
  }

  // If IPA selected, warn about reduced sifat-level detail
  if (ctx.scriptType === "IPA") {
    warnings.push({
      field: "scriptType",
      value: "IPA",
      reason: "IPA script does not support sifat-level articulation detail. QPS is recommended for Tajweed-specific training.",
    });
  }

  return warnings;
}


// ── Noorani Qaida Lesson Presets ──
// Quick-select presets for common scope configurations.
// These map to groups of lessons in the standard Noorani Qaida curriculum.

export const SCOPE_PRESETS: { label: string; labelAr: string; scope: Partial<TajweedScope> }[] = [
  {
    label: "Single Letters (Lessons 1-3)",
    labelAr: "الحروف المفردة",
    scope: { lessons: [1, 2, 3] },
  },
  {
    label: "Letters with Harakat (Lessons 4-6)",
    labelAr: "الحروف مع الحركات",
    scope: { lessons: [4, 5, 6] },
  },
  {
    label: "Tanween (Lessons 7-8)",
    labelAr: "التنوين",
    scope: { lessons: [7, 8] },
  },
  {
    label: "Sukoon & Madd (Lessons 9-11)",
    labelAr: "السكون والمد",
    scope: { lessons: [9, 10, 11] },
  },
  {
    label: "Shadda & Advanced (Lessons 12-15)",
    labelAr: "الشدة والمتقدم",
    scope: { lessons: [12, 13, 14, 15] },
  },
  {
    label: "Tajweed Rules (Lessons 16-17)",
    labelAr: "أحكام التجويد",
    scope: { lessons: [16, 17] },
  },
  {
    label: "Full Noorani Qaida (All Lessons)",
    labelAr: "القاعدة النورانية كاملة",
    scope: { lessons: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17] },
  },
];
