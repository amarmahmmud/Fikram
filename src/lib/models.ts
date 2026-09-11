// ─────────────────────────────────────────────
// Centralized ASR Model Registry — Single source of truth
// ─────────────────────────────────────────────
// Replaces the text-LLM catalog with speech/ASR models for
// Noorani Qaida / Tajweed phonetic fine-tuning.
//
// Default recommendation: obadx QPS checkpoint (best published PER
// on Quranic phoneme recognition). wav2vec2-base is the fallback
// ONLY if a hard size/licensing constraint applies — flagged via
// UI tooltip, never a silent default.

export interface ASRModelInfo {
  id: string;
  name: string;
  org: string;
  size: string;
  sizeNum: number;           // Numeric param count in millions for sorting
  category: ASRModelCategory;
  strengths: string[];
  weaknesses: string[];
  bestFor: string[];
  contextWindowMs: number;   // Max audio input length in milliseconds
  credits: { min: number; max: number };
  speed: "fast" | "medium" | "slow";
  quality: number;           // 1-10 quality rating
  popular: boolean;
  recommended: boolean;
  tags: string[];
  // ASR-specific fields
  phonemeVocabType: "QPS" | "IPA" | "configurable";
  sifatLevelSupport: boolean;
  publishedPER: number | null;     // Published Phoneme Error Rate if available
  realtimeCapable: boolean;        // <200ms inference latency feasible
  pretrainedOnQuran: boolean;
}

export type ASRModelCategory =
  | "quran_specialized"     // Pre-trained specifically on Quranic recitation
  | "multilingual_asr"      // General multilingual ASR models
  | "base_model"            // Foundation models requiring full fine-tuning
  | "lightweight";          // Small models for real-time/edge deployment

export const ASR_MODEL_CATEGORIES: { value: ASRModelCategory | "all"; label: string }[] = [
  { value: "all", label: "All Models" },
  { value: "quran_specialized", label: "Quran-Specialized" },
  { value: "multilingual_asr", label: "Multilingual ASR" },
  { value: "base_model", label: "Foundation Models" },
  { value: "lightweight", label: "Lightweight / Real-time" },
];


// ─────────────────────────────────────────────
// The ASR Model Catalog
// ─────────────────────────────────────────────
export const MODELS: ASRModelInfo[] = [
  // ── Quran-Specialized ──────────────────────
  {
    id: "obadx/qps-wav2vec2-ctc",
    name: "obadx QPS Multi-Level CTC",
    org: "obadx",
    size: "300M",
    sizeNum: 300,
    category: "quran_specialized",
    strengths: [
      "QPS two-level phoneme+sifat output",
      "Best published PER on Quranic phonemes",
      "Sifat-level articulation detection",
      "Trained on Quranic recitation data",
    ],
    weaknesses: [
      "Larger model size",
      "Requires QPS vocabulary",
    ],
    bestFor: [
      "Tajweed mistake detection",
      "Noorani Qaida training",
      "Phoneme+sifat-level fine-tuning",
    ],
    contextWindowMs: 30000,
    credits: { min: 20, max: 45 },
    speed: "medium",
    quality: 9,
    popular: true,
    recommended: true,
    tags: ["quran", "qps", "tajweed", "sifat"],
    phonemeVocabType: "QPS",
    sifatLevelSupport: true,
    publishedPER: null,  // TODO: Fill from obadx paper once exact number confirmed
    realtimeCapable: false,
    pretrainedOnQuran: true,
  },
  {
    id: "TBOGamer22/wav2vec2-quran-phonetics",
    name: "wav2vec2 Quran Phonetics",
    org: "TBOGamer22",
    size: "300M",
    sizeNum: 300,
    category: "quran_specialized",
    strengths: [
      "Pre-trained on Quranic audio",
      "Community-validated",
      "Standard wav2vec2 architecture",
    ],
    weaknesses: [
      "IPA-based vocabulary (not QPS)",
      "No sifat-level detail",
      "Less Tajweed-specific than obadx",
    ],
    bestFor: [
      "General Quran phoneme recognition",
      "Projects using IPA notation",
      "When QPS vocab is not available",
    ],
    contextWindowMs: 30000,
    credits: { min: 18, max: 40 },
    speed: "medium",
    quality: 7.5,
    popular: true,
    recommended: false,
    tags: ["quran", "ipa", "phonetics"],
    phonemeVocabType: "IPA",
    sifatLevelSupport: false,
    publishedPER: null,
    realtimeCapable: false,
    pretrainedOnQuran: true,
  },

  // ── Foundation Models ──────────────────────
  {
    id: "facebook/wav2vec2-base",
    name: "wav2vec2 Base",
    org: "Meta",
    size: "95M",
    sizeNum: 95,
    category: "base_model",
    strengths: [
      "Smallest model — cheapest to fine-tune",
      "Fast training and inference",
      "Well-documented architecture",
      "Configurable vocabulary",
    ],
    weaknesses: [
      "No Quranic pre-training",
      "Requires full fine-tuning for Arabic phonemes",
      "Lower quality than specialized models",
    ],
    bestFor: [
      "Budget-constrained projects",
      "Quick experiments and prototyping",
      "Real-time inference (with optimization)",
    ],
    contextWindowMs: 20000,
    credits: { min: 8, max: 20 },
    speed: "fast",
    quality: 5,
    popular: false,
    recommended: false,
    tags: ["base", "configurable", "budget"],
    phonemeVocabType: "configurable",
    sifatLevelSupport: false,
    publishedPER: null,
    realtimeCapable: true,
    pretrainedOnQuran: false,
  },
  {
    id: "facebook/wav2vec2-large",
    name: "wav2vec2 Large",
    org: "Meta",
    size: "317M",
    sizeNum: 317,
    category: "base_model",
    strengths: [
      "Larger capacity than base",
      "Better feature extraction",
      "Configurable vocabulary",
    ],
    weaknesses: [
      "No Quranic pre-training",
      "Slower than base model",
      "Higher compute cost",
    ],
    bestFor: [
      "Higher-quality phoneme recognition",
      "When obadx checkpoint unavailable",
    ],
    contextWindowMs: 30000,
    credits: { min: 20, max: 45 },
    speed: "medium",
    quality: 6.5,
    popular: false,
    recommended: false,
    tags: ["base", "configurable", "large"],
    phonemeVocabType: "configurable",
    sifatLevelSupport: false,
    publishedPER: null,
    realtimeCapable: false,
    pretrainedOnQuran: false,
  },

  // ── Multilingual ASR ──────────────────────
  {
    id: "facebook/wav2vec2-xls-r-300m",
    name: "XLS-R 300M",
    org: "Meta",
    size: "300M",
    sizeNum: 300,
    category: "multilingual_asr",
    strengths: [
      "Pre-trained on 128 languages",
      "Good Arabic speech understanding",
      "Strong cross-lingual transfer",
      "Configurable vocabulary",
    ],
    weaknesses: [
      "Not Quran-specific",
      "General-purpose — may miss Tajweed nuances",
    ],
    bestFor: [
      "Multilingual recitation projects",
      "When learners speak multiple languages",
      "Cross-lingual transfer experiments",
    ],
    contextWindowMs: 30000,
    credits: { min: 20, max: 45 },
    speed: "medium",
    quality: 7,
    popular: false,
    recommended: false,
    tags: ["multilingual", "arabic", "configurable"],
    phonemeVocabType: "configurable",
    sifatLevelSupport: false,
    publishedPER: null,
    realtimeCapable: false,
    pretrainedOnQuran: false,
  },
  {
    id: "facebook/w2v-bert-2.0",
    name: "w2v-BERT 2.0",
    org: "Meta",
    size: "600M",
    sizeNum: 600,
    category: "multilingual_asr",
    strengths: [
      "Largest model — highest capacity",
      "State-of-the-art speech representations",
      "143 languages pre-training",
    ],
    weaknesses: [
      "Very large — expensive to fine-tune",
      "Slow inference",
      "Overkill for letter-level Noorani Qaida",
    ],
    bestFor: [
      "Maximum quality when cost is not a concern",
      "Complex Tajweed rule detection",
      "Research / benchmarking",
    ],
    contextWindowMs: 30000,
    credits: { min: 35, max: 70 },
    speed: "slow",
    quality: 8.5,
    popular: false,
    recommended: false,
    tags: ["large", "bert", "multilingual", "research"],
    phonemeVocabType: "configurable",
    sifatLevelSupport: false,
    publishedPER: null,
    realtimeCapable: false,
    pretrainedOnQuran: false,
  },
];


// ─────────────────────────────────────────────
// Helper Functions
// ─────────────────────────────────────────────

/** Get a model by its ID */
export function getModelById(id: string): ASRModelInfo | undefined {
  return MODELS.find((m) => m.id === id);
}

/** Get all models for a specific category */
export function getModelsByCategory(category: ASRModelCategory | "all"): ASRModelInfo[] {
  if (category === "all") return MODELS;
  return MODELS.filter((m) => m.category === category);
}

/** Get models filtered by real-time capability */
export function getRealtimeModels(): ASRModelInfo[] {
  return MODELS.filter((m) => m.realtimeCapable);
}

/**
 * Get the recommended model based on requirements.
 *
 * Decision logic:
 * 1. If sifat-level support needed → obadx QPS (only option)
 * 2. If real-time required → filter to realtimeCapable, pick highest quality
 * 3. If budget constrained → filter by maxCredits, pick highest quality
 * 4. Default → obadx QPS (recommended)
 *
 * wav2vec2-base is ONLY the fallback if a hard size/licensing constraint
 * applies — flagged via tooltip, never silent default.
 */
export function getRecommendedModel(opts?: {
  needsSifatLevel?: boolean;
  needsRealtime?: boolean;
  budgetConstrained?: boolean;
  maxCredits?: number;
  preferPretrainedQuran?: boolean;
}): ASRModelInfo {
  // Sifat-level support → only obadx QPS
  if (opts?.needsSifatLevel) {
    return MODELS.find((m) => m.sifatLevelSupport) ?? MODELS[0];
  }

  // Real-time → filter to capable models
  if (opts?.needsRealtime) {
    const rtModels = MODELS
      .filter((m) => m.realtimeCapable)
      .sort((a, b) => b.quality - a.quality);
    return rtModels[0] ?? MODELS[0];
  }

  // Hard budget constraint
  if (opts?.budgetConstrained || (opts?.maxCredits !== undefined && opts.maxCredits < 20)) {
    const affordable = MODELS
      .filter((m) => m.credits.max <= (opts?.maxCredits ?? 20))
      .sort((a, b) => b.quality - a.quality);
    return affordable[0] ?? MODELS[0];
  }

  // Prefer Quran-pretrained if specified
  if (opts?.preferPretrainedQuran !== false) {
    const quranModels = MODELS
      .filter((m) => m.pretrainedOnQuran)
      .sort((a, b) => b.quality - a.quality);
    return quranModels[0] ?? MODELS[0];
  }

  // Default: obadx QPS (the recommended model)
  return MODELS.find((m) => m.recommended) ?? MODELS[0];
}

/** Get a recommendation reason string for the UI */
export function getRecommendationReason(model: ASRModelInfo, opts?: {
  needsRealtime?: boolean;
  estimatedCredits?: number;
}): string {
  if (model.recommended) {
    return `Best published PER on Quranic phonemes with sifat-level articulation detail${opts?.estimatedCredits ? ` — estimated ${opts.estimatedCredits} credits` : ""}`;
  }
  if (model.realtimeCapable && opts?.needsRealtime) {
    return `Optimized for real-time (<200ms) inference${opts?.estimatedCredits ? ` — estimated ${opts.estimatedCredits} credits` : ""}`;
  }
  if (model.pretrainedOnQuran) {
    return `Pre-trained on Quranic recitation data${opts?.estimatedCredits ? ` — estimated ${opts.estimatedCredits} credits` : ""}`;
  }
  return `General-purpose ASR model — requires full fine-tuning for Tajweed${opts?.estimatedCredits ? ` — estimated ${opts.estimatedCredits} credits` : ""}`;
}

/** Build a summary string for use in recommendations */
export function getModelCatalogSummary(): string {
  return MODELS.map((m) =>
    `- ${m.name} (${m.id}): ${m.size} params, ${m.category}, ` +
    `Quality ${m.quality}/10, ${m.credits.min}-${m.credits.max} credits, ` +
    `Vocab: ${m.phonemeVocabType}, Sifat: ${m.sifatLevelSupport ? "Yes" : "No"}, ` +
    `Quran pretrained: ${m.pretrainedOnQuran ? "Yes" : "No"}. ` +
    `Best for: ${m.bestFor.join(", ")}.`,
  ).join("\n");
}
