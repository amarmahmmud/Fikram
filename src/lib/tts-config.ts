// ─────────────────────────────────────────────────────────────
// Google Cloud Gemini-TTS Configuration & Language Registry
// ─────────────────────────────────────────────────────────────

export interface TTSLanguageConfig {
  languageCode: string;       // BCP-47 language tag (e.g. "en-US", "am-ET")
  languageName: string;       // User-friendly display name
  defaultVoice: string;       // Default voice identifier
  isPreview?: boolean;        // Whether this language/voice is in Preview status on Google Cloud
  notes?: string;             // Additional details or known constraints
}

/** Default TTS model (stable) */
export const DEFAULT_TTS_MODEL = "gemini-2.5-flash-tts";

/** Next-generation preview TTS model (optional upgrade path) */
export const PREVIEW_TTS_MODEL = "gemini-3.1-flash-tts-preview";

/**
 * Gemini-TTS prebuilt expressive voices available across Vertex AI & Cloud TTS
 */
export const GEMINI_PREBUILT_VOICES = [
  "Aoede",
  "Charon",
  "Fenrir",
  "Kore",
  "Puck",
  "Leda",
  "Zephyr",
  "Orus",
  "Despina",
  "Callirrhoe",
] as const;

/**
 * Registry of supported language codes and their default voices.
 * Easy to extend without core logic changes.
 */
export const SUPPORTED_TTS_LANGUAGES: Record<string, TTSLanguageConfig> = {
  "en-US": {
    languageCode: "en-US",
    languageName: "English (US)",
    defaultVoice: "en-US-Journey-F",
    isPreview: false,
  },
  "am-ET": {
    languageCode: "am-ET",
    languageName: "Amharic (Ethiopia)",
    defaultVoice: "am-ET-Standard-A",
    isPreview: true,
    notes: "Preview status on Google Cloud. Handled gracefully if unavailable.",
  },
  "ar-XA": {
    languageCode: "ar-XA",
    languageName: "Arabic",
    defaultVoice: "ar-XA-Standard-A",
    isPreview: false,
  },
  "es-ES": {
    languageCode: "es-ES",
    languageName: "Spanish (Spain)",
    defaultVoice: "es-ES-Neural2-A",
    isPreview: false,
  },
  "fr-FR": {
    languageCode: "fr-FR",
    languageName: "French (France)",
    defaultVoice: "fr-FR-Neural2-A",
    isPreview: false,
  },
  "de-DE": {
    languageCode: "de-DE",
    languageName: "German (Germany)",
    defaultVoice: "de-DE-Neural2-B",
    isPreview: false,
  },
  "zh-CN": {
    languageCode: "zh-CN",
    languageName: "Chinese (Mandarin)",
    defaultVoice: "cmn-CN-Wavenet-A",
    isPreview: false,
  },
  "ja-JP": {
    languageCode: "ja-JP",
    languageName: "Japanese",
    defaultVoice: "ja-JP-Neural2-B",
    isPreview: false,
  },
  "pt-BR": {
    languageCode: "pt-BR",
    languageName: "Portuguese (Brazil)",
    defaultVoice: "pt-BR-Neural2-A",
    isPreview: false,
  },
  "hi-IN": {
    languageCode: "hi-IN",
    languageName: "Hindi",
    defaultVoice: "hi-IN-Neural2-A",
    isPreview: false,
  },
  "it-IT": {
    languageCode: "it-IT",
    languageName: "Italian",
    defaultVoice: "it-IT-Neural2-A",
    isPreview: false,
  },
  "sw-KE": {
    languageCode: "sw-KE",
    languageName: "Swahili",
    defaultVoice: "sw-KE-Standard-A",
    isPreview: false,
  },
};

/**
 * Detect language code from text using script analysis and lexical heuristics.
 * Returns the mapped BCP-47 language tag, whether it is preview-stage, and default voice.
 */
export function detectLanguage(text: string): {
  languageCode: string;
  isPreview: boolean;
  defaultVoice: string;
} {
  if (!text || typeof text !== "string") {
    const fallback = SUPPORTED_TTS_LANGUAGES["en-US"];
    return {
      languageCode: fallback.languageCode,
      isPreview: false,
      defaultVoice: fallback.defaultVoice,
    };
  }

  // 1. Amharic (Ethiopic Script: \u1200-\u137F, \u1380-\u139F, \u2D80-\u2DDF, \uAB00-\uAB2F)
  const ethiopicRegex = /[\u1200-\u137F\u1380-\u139F\u2D80-\u2DDF\uAB00-\uAB2F]/;
  if (ethiopicRegex.test(text)) {
    const am = SUPPORTED_TTS_LANGUAGES["am-ET"];
    return {
      languageCode: am.languageCode,
      isPreview: true,
      defaultVoice: am.defaultVoice,
    };
  }

  // 2. Arabic script (\u0600-\u06FF, \u0750-\u077F)
  const arabicRegex = /[\u0600-\u06FF\u0750-\u077F]/;
  if (arabicRegex.test(text)) {
    const ar = SUPPORTED_TTS_LANGUAGES["ar-XA"];
    return {
      languageCode: ar.languageCode,
      isPreview: false,
      defaultVoice: ar.defaultVoice,
    };
  }

  // 3. Japanese (Hiragana & Katakana: \u3040-\u309F, \u30A0-\u30FF)
  const japaneseRegex = /[\u3040-\u309F\u30A0-\u30FF]/;
  if (japaneseRegex.test(text)) {
    const ja = SUPPORTED_TTS_LANGUAGES["ja-JP"];
    return {
      languageCode: ja.languageCode,
      isPreview: false,
      defaultVoice: ja.defaultVoice,
    };
  }

  // 4. Chinese (CJK Unified Ideographs: \u4E00-\u9FFF)
  const chineseRegex = /[\u4E00-\u9FFF]/;
  if (chineseRegex.test(text)) {
    const zh = SUPPORTED_TTS_LANGUAGES["zh-CN"];
    return {
      languageCode: zh.languageCode,
      isPreview: false,
      defaultVoice: zh.defaultVoice,
    };
  }

  // 5. Hindi (Devanagari: \u0900-\u097F)
  const hindiRegex = /[\u0900-\u097F]/;
  if (hindiRegex.test(text)) {
    const hi = SUPPORTED_TTS_LANGUAGES["hi-IN"];
    return {
      languageCode: hi.languageCode,
      isPreview: false,
      defaultVoice: hi.defaultVoice,
    };
  }

  // 6. Latin-based script heuristics for German, Spanish, French
  const lower = text.toLowerCase();

  // Spanish clues
  if (/[¿¡áéíóúüñ]/.test(lower) && /\b(que|para|como|este|esta|los|las|por|con)\b/.test(lower)) {
    const es = SUPPORTED_TTS_LANGUAGES["es-ES"];
    return { languageCode: es.languageCode, isPreview: false, defaultVoice: es.defaultVoice };
  }

  // French clues
  if (/[çœàâèéêëîïôùû]/.test(lower) && /\b(le|la|les|des|un|une|est|avec|dans|pour)\b/.test(lower)) {
    const fr = SUPPORTED_TTS_LANGUAGES["fr-FR"];
    return { languageCode: fr.languageCode, isPreview: false, defaultVoice: fr.defaultVoice };
  }

  // German clues
  if (/[äöüß]/.test(lower) && /\b(der|die|das|und|in|den|von|zu|mit|sich|des)\b/.test(lower)) {
    const de = SUPPORTED_TTS_LANGUAGES["de-DE"];
    return { languageCode: de.languageCode, isPreview: false, defaultVoice: de.defaultVoice };
  }

  // Default to en-US
  const defaultEn = SUPPORTED_TTS_LANGUAGES["en-US"];
  return {
    languageCode: defaultEn.languageCode,
    isPreview: false,
    defaultVoice: defaultEn.defaultVoice,
  };
}

/**
 * Get language configuration by language code or fallback to en-US.
 */
export function getLanguageConfig(languageCode?: string): TTSLanguageConfig {
  if (languageCode && SUPPORTED_TTS_LANGUAGES[languageCode]) {
    return SUPPORTED_TTS_LANGUAGES[languageCode];
  }
  // Try matching prefix (e.g. "am" -> "am-ET", "en" -> "en-US")
  if (languageCode) {
    const prefix = languageCode.split("-")[0].toLowerCase();
    const match = Object.values(SUPPORTED_TTS_LANGUAGES).find(
      (c) => c.languageCode.toLowerCase().startsWith(prefix)
    );
    if (match) return match;
  }
  return SUPPORTED_TTS_LANGUAGES["en-US"];
}

/**
 * Cleans raw markdown/assistant text so that TTS speaks natural speech
 * rather than reading aloud markdown symbols, links, code blocks, or citation tags.
 */
export function cleanTextForTTS(raw: string): string {
  if (!raw) return "";

  let cleaned = raw;

  // Replace code blocks with a brief natural pause or omission
  cleaned = cleaned.replace(/```[\s\S]*?```/g, " [code snippet] ");

  // Strip inline code backticks `code` -> code
  cleaned = cleaned.replace(/`([^`]+)`/g, "$1");

  // Strip images ![alt](url) -> ""
  cleaned = cleaned.replace(/!\[([^\]]*)\]\([^)]*\)/g, "");

  // Convert markdown links [text](url) -> text
  cleaned = cleaned.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");

  // Remove markdown headings (#, ##, ###)
  cleaned = cleaned.replace(/^#{1,6}\s+/gm, "");

  // Remove bold / italics (*, **, _, __)
  cleaned = cleaned.replace(/(\*\*|__)(.*?)\1/g, "$2");
  cleaned = cleaned.replace(/(\*|_)(.*?)\1/g, "$2");

  // Remove blockquotes (> )
  cleaned = cleaned.replace(/^>\s+/gm, "");

  // Remove bullet points (*, -, +)
  cleaned = cleaned.replace(/^[\*\-\+]\s+/gm, "");

  // Remove numbered lists (1. 2. etc.)
  cleaned = cleaned.replace(/^\d+\.\s+/gm, "");

  // Remove horizontal rules
  cleaned = cleaned.replace(/^---+$/gm, "");

  // Remove XML / HTML tags
  cleaned = cleaned.replace(/<\/?[^>]+(>|$)/g, "");

  // Normalize excessive whitespace & empty lines
  cleaned = cleaned.replace(/\s+/g, " ").trim();

  return cleaned;
}
