// ─────────────────────────────────────────────
// QPS Types — Quranic Phonetic Script Core Types
// ─────────────────────────────────────────────
// Shared domain types for the Noorani Qaida / Tajweed ASR pipeline.
// Based on the obadx QPS multi-level CTC paper's phoneme+sifat notation.

// ── Tajweed Rules ──
// Enumeration of Tajweed rules the system can detect and evaluate.
// Mirrors the rule categories in qdat_bench (obadx's published benchmark).
export type TajweedRule =
  | "ghunnah"          // Nasalization
  | "qalqalah"         // Echo/bounce on sukoon letters (ق ط ب ج د)
  | "madd_tabii"       // Natural prolongation (2 counts)
  | "madd_lazim"       // Obligatory prolongation (6 counts)
  | "madd_munfasil"    // Separated prolongation (4-5 counts)
  | "madd_muttasil"    // Connected prolongation (4-5 counts)
  | "madd_arid"        // Presented prolongation (2-4-6 counts)
  | "idgham"           // Merging (with/without ghunnah)
  | "ikhfa"            // Hiding/concealment
  | "iqlab"            // Conversion (noon sakinah → meem)
  | "izhar"            // Clear pronunciation
  | "tafkheem"         // Heavy/emphatic articulation
  | "tarqeeq"          // Light/thin articulation
  | "noon_sakinah"     // Noon sakinah rules (parent category)
  | "meem_sakinah";    // Meem sakinah rules

export const ALL_TAJWEED_RULES: TajweedRule[] = [
  "ghunnah", "qalqalah", "madd_tabii", "madd_lazim", "madd_munfasil",
  "madd_muttasil", "madd_arid", "idgham", "ikhfa", "iqlab", "izhar",
  "tafkheem", "tarqeeq", "noon_sakinah", "meem_sakinah",
];

// Human-readable labels for display in the UI
export const TAJWEED_RULE_LABELS: Record<TajweedRule, string> = {
  ghunnah: "Ghunnah (غنة)",
  qalqalah: "Qalqalah (قلقلة)",
  madd_tabii: "Madd Tabii (مد طبيعي)",
  madd_lazim: "Madd Lazim (مد لازم)",
  madd_munfasil: "Madd Munfasil (مد منفصل)",
  madd_muttasil: "Madd Muttasil (مد متصل)",
  madd_arid: "Madd Arid (مد عارض)",
  idgham: "Idgham (إدغام)",
  ikhfa: "Ikhfa (إخفاء)",
  iqlab: "Iqlab (إقلاب)",
  izhar: "Izhar (إظهار)",
  tafkheem: "Tafkheem (تفخيم)",
  tarqeeq: "Tarqeeq (ترقيق)",
  noon_sakinah: "Noon Sakinah (نون ساكنة)",
  meem_sakinah: "Meem Sakinah (ميم ساكنة)",
};


// ── QPS Phoneme ──
// Represents a single phoneme in the Quranic Phonetic Script notation.
// The two-level design (phoneme + sifat) is the key differentiator from
// plain IPA — it allows the diff engine to say "wrong sifa" not just
// "wrong sound."

export interface QPSPhoneme {
  /** QPS phoneme symbol/code */
  symbol: string;
  /** Articulation properties (e.g., "hams", "jahr", "shidda", "rakhawa") */
  sifat: string[];
  /** Point of articulation (makhraj) */
  makhraj: string;
  /** Expected duration class for Tajweed timing rules */
  durationClass: "short" | "medium" | "long" | "extended";
}

// ── Sifat (Articulation Properties) ──
export type Sifa =
  | "hams"        // Whisper (voiceless)
  | "jahr"        // Loudness (voiced)
  | "shidda"      // Strength (plosive)
  | "rakhawa"     // Softness (fricative)
  | "tawassut"    // Moderate (between shidda and rakhawa)
  | "isti_ala"    // Elevation (velarization/pharyngealization)
  | "istifal"     // Lowering (non-emphatic)
  | "itbaq"       // Adhesion (emphatic closure)
  | "infitah"     // Opening (non-emphatic opening)
  | "idhlaq"      // Fluency (tip-of-tongue/lip letters)
  | "ismat"       // Restraint (non-fluent letters)
  | "safeer"      // Whistling (ص ز س)
  | "qalqalah"    // Echo/bounce (ق ط ب ج د)
  | "leen"        // Softness (و ي preceded by fatha)
  | "inhiraf"     // Deflection (ل ر)
  | "takarur"     // Repetition (ر)
  | "tafashi"     // Spreading (ش)
  | "istitala";   // Elongation (ض)

// ── Makhraj (Points of Articulation) ──
export type Makhraj =
  | "jawf"             // Empty space (madd letters)
  | "halq_aqsa"        // Deepest throat (ء ه)
  | "halq_wasat"       // Middle throat (ع ح)
  | "halq_adna"        // Nearest throat (غ خ)
  | "lisan_aqsa"       // Back of tongue (ق)
  | "lisan_aqsa_adna"  // Back tongue slightly forward (ك)
  | "lisan_wasat"      // Middle tongue (ج ش ي)
  | "lisan_haffa"      // Edge of tongue (ض)
  | "lisan_taraf_lam"  // Tip of tongue for lam (ل)
  | "lisan_taraf_nun"  // Tip of tongue for nun (ن)
  | "lisan_taraf_ra"   // Tip of tongue for ra (ر)
  | "lisan_taraf_dal"  // Tip for (ت ط د)
  | "lisan_taraf_sin"  // Tip for (ص ز س)
  | "lisan_taraf_tha"  // Tip for (ث ذ ظ)
  | "shafatan"         // Two lips (ب م و)
  | "shafa_ulya"       // Lower lip + upper teeth (ف)
  | "khayshum";        // Nasal cavity (ghunnah)


// ── Noorani Qaida Unit ──
// A single teaching unit from the Noorani Qaida curriculum.
export interface NooraniQaidaUnit {
  /** Unique identifier, e.g. "ba_fatha" */
  id: string;
  /** Arabic text display, e.g. "بَ" */
  arabicText: string;
  /** Expected QPS phoneme sequence for correct recitation */
  expectedPhonemes: QPSPhoneme[];
  /** Tajweed rules that apply to this unit */
  tajweedRules: TajweedRule[];
  /** Noorani Qaida lesson number (1–17 approximately) */
  lesson: number;
  /** Category of this unit */
  category: "letter" | "haraka" | "tanween" | "madd" | "sukoon" | "shadda" | "compound";
}


// ── Tajweed Mistake ──
// Structured diff output from the alignment engine.
// Confidence gating is CRITICAL — false-positive error flags are the
// #1 real-world complaint against Tarteel-style tools.

export type TajweedMistakeType =
  | "wrong_haraka"         // Wrong diacritical mark
  | "skipped_letter"       // Letter not pronounced
  | "added_letter"         // Extra letter inserted
  | "wrong_makhraj"        // Wrong articulation point
  | "madd_too_short"       // Prolongation too brief
  | "madd_too_long"        // Prolongation too extended
  | "missing_ghunnah"      // Missing nasalization
  | "missing_qalqalah"    // Missing echo/bounce
  | "wrong_idgham"         // Incorrect merging
  | "wrong_ikhfa"          // Incorrect hiding
  | "wrong_iqlab"          // Incorrect conversion
  | "wrong_izhar"          // Should be clear but was hidden
  | "wrong_tafkheem"       // Should be heavy but was light
  | "wrong_tarqeeq";       // Should be light but was heavy

export interface TajweedMistake {
  type: TajweedMistakeType;
  /** Index in the phoneme sequence */
  position: number;
  /** Expected phoneme/sifa */
  expected: string;
  /** What was actually detected */
  got: string;
  /** Confidence score [0-1]. Only surface to user above threshold. */
  confidence: number;
  /** Severity classification */
  severity: "minor" | "major" | "critical";
  /** Which Tajweed rule was violated (if applicable) */
  rule?: TajweedRule;
}


// ── Alignment Result ──
// Output of the two-tier alignment engine for a single unit.

export interface PhonemeAlignment {
  /** Expected phoneme from canonical reference */
  expected: QPSPhoneme;
  /** What the ASR model actually detected (null = skipped/deleted) */
  got: string | null;
  /** Timing in the audio clip */
  timingMs: { start: number; end: number };
  /** Confidence of this alignment */
  confidence: number;
}

export interface AlignmentResult {
  /** Reference unit this alignment corresponds to */
  unitId: string;
  /** Whether the unit was successfully aligned */
  aligned: boolean;
  /** Per-phoneme alignment details */
  phonemeAlignments: PhonemeAlignment[];
  /** Detected mistakes */
  mistakes: TajweedMistake[];
  /** Overall confidence for this alignment */
  overallConfidence: number;
}


// ── Audio Clip ──
// A single audio segment produced by VAD-based segmentation.

export interface AudioClip {
  /** Unique identifier */
  id: string;
  /** R2 storage key */
  r2Key: string;
  /** Presigned download URL */
  r2Url: string;
  /** Duration in milliseconds */
  durationMs: number;
  /** Sample rate (always 16000 after normalization) */
  sampleRate: number;
  /** Channel count (always 1 mono after normalization) */
  channels: number;
}


// ── Dataset Pair (Audio + Labels) ──
// Replaces the old text-based DatasetPair.

export interface ASRDatasetPair {
  /** Reference to the audio clip */
  audioClipId: string;
  /** R2 storage key for the audio file */
  audioR2Key: string;
  /** QPS phoneme+sifat labels with timing */
  phonemeLabels: PhonemeLabel[];
  /** Flat QPS phoneme string — the CTC training target */
  qpsSequence: string;
  /** Whether this is a deliberately-wrong mispronunciation example */
  isDeliberateError: boolean;
  /** Provenance metadata */
  _meta?: {
    sourceFileHash: string;
    segmentIndex: number;
    bootstrapModelId: string;
    /** Fraction of labels that were human-corrected (0.0–1.0) */
    correctionRatio: number;
  };
}

export interface PhonemeLabel {
  /** QPS phoneme symbol */
  phoneme: string;
  /** Sifat/articulation label */
  sifat?: string;
  /** Start time in milliseconds within the clip */
  startMs: number;
  /** End time in milliseconds within the clip */
  endMs: number;
  /** Bootstrap model confidence [0-1] */
  confidence: number;
  /** Whether a human has verified/corrected this label */
  humanVerified: boolean;
}


// ── Pipeline Progress ──
// Replaces the old text-pipeline PipelineProgress.

export interface ASRPipelineProgress {
  stage: "segmenting" | "transcribing" | "validating" | "deduplicating" | "complete";
  message: string;
  segmentsTotal: number;
  segmentsProcessed: number;
  clipsGenerated: number;
}


// ── Pipeline Stats ──

export interface ASRPipelineStats {
  segmentsProcessed: number;
  rawClipsGenerated: number;
  afterValidation: number;
  afterDedup: number;
  deliberateErrorClips: number;
  finalTotal: number;
  trainClipsCount: number;
  evalClipsCount: number;
  totalAudioDurationMs: number;
  averageClipDurationMs: number;
  sourceHash: string;
}
