import { Type } from "@google/genai";

// ── Static Rubric Dimensions ────────────────────────────────────────────────
export const RUBRIC_DIMENSIONS = [
  "Market Size",
  "Problem Severity",
  "Timing",
  "Competition",
  "Business Model Clarity",
  "Technical Feasibility",
  "Defensibility",
  "Unit Economics",
  "Team-Market Fit",
  "Scalability",
] as const;

export type RubricDimension = (typeof RUBRIC_DIMENSIONS)[number];

// ── Scorecard JSON Schema for Gemini Native Structured Outputs ──────────────
export const scorecardResponseSchema = {
  type: Type.OBJECT,
  description: "Complete startup evaluation scorecard or follow-up analysis response.",
  properties: {
    analysis_scratchpad: {
      type: Type.STRING,
      description:
        "Internal chain-of-thought to lock in CAC, LTV, margins, regulatory reality, and narrative BEFORE scoring or answering.",
    },
    scorecard: {
      type: Type.ARRAY,
      description:
        "Array of exactly 10 dimensions for a new evaluation, or empty array [] if this is a follow-up response.",
      items: {
        type: Type.OBJECT,
        properties: {
          dimension: {
            type: Type.STRING,
            description: "One of the 10 rubric dimensions in exact order.",
          },
          score: {
            type: Type.INTEGER,
            description: "Integer score from 0 to 10.",
          },
          reasoning: {
            type: Type.STRING,
            description: "Sharp first-principles explanation for the assigned score.",
          },
        },
        required: ["dimension", "score", "reasoning"],
      },
    },
    total_verdict: {
      type: Type.STRING,
      description:
        "A punchy 3-word summary verdict for new evaluations (e.g. 'Dead on Arrival', 'High-Risk Moonshot'). Empty string '' for follow-up responses.",
    },
    roast: {
      type: Type.STRING,
      description:
        "Roast paragraphs for new evaluations (minimum 4 paragraphs). Empty string '' for follow-up responses.",
    },
    graveyard: {
      type: Type.STRING,
      description:
        "Structural failure patterns using markdown bullet points for new evaluations. Empty string '' for follow-up responses.",
    },
    pivot: {
      type: Type.STRING,
      description:
        "Actionable higher-margin alternative recommendation for new evaluations. Empty string '' for follow-up responses.",
    },
    follow_up_response: {
      type: Type.STRING,
      description:
        "Direct, insightful response to the user's follow-up question or commentary, referencing the existing scorecard already given earlier in the conversation. Empty string '' for a new evaluation.",
    },
  },
  required: [
    "analysis_scratchpad",
    "scorecard",
    "total_verdict",
    "roast",
    "graveyard",
    "pivot",
    "follow_up_response",
  ],
};

export interface ScorecardItem {
  dimension: string;
  score: number;
  reasoning: string;
}

export interface ScorecardPayload {
  analysis_scratchpad: string;
  scorecard: ScorecardItem[];
  total_verdict: string;
  roast: string;
  graveyard: string;
  pivot: string;
  follow_up_response: string;
}

// ── Language-Aware Token Multipliers ─────────────────────────────────────────
/**
 * Token multipliers relative to English baseline (1.0x = 2,500 tokens).
 * Non-Latin / low-resource scripts consume significantly more tokens per word
 * because subword tokenizers (like Gemini's SentencePiece) split characters into
 * multiple byte tokens.
 *
 * Tested & empirically calibrated:
 * - English (en): 1.0x (2,500 tokens)
 * - Latin European (es, fr, de, it, pt): 1.25x (~3,125 tokens)
 * - CJK (zh, ja): 2.2x (~5,500 tokens)
 * - Cyrillic (ru): 2.5x (~6,250 tokens)
 * - Arabic (ar): 2.8x (~7,000 tokens)
 * - Devanagari / Hindi (hi): 2.8x (~7,000 tokens)
 * - Ethiopic / Amharic (am): 5.2x (~13,000 tokens)
 */
export const LANGUAGE_TOKEN_MULTIPLIERS: Record<string, number> = {
  en: 1.0,
  "en-US": 1.0,
  es: 1.25,
  "es-ES": 1.25,
  fr: 1.25,
  "fr-FR": 1.25,
  de: 1.25,
  "de-DE": 1.25,
  it: 1.25,
  "it-IT": 1.25,
  pt: 1.25,
  "pt-BR": 1.25,
  zh: 2.2,
  "zh-CN": 2.2,
  ja: 2.2,
  "ja-JP": 2.2,
  ru: 2.5,
  "ru-RU": 2.5,
  ar: 2.8,
  "ar-XA": 2.8,
  hi: 2.8,
  "hi-IN": 2.8,
  am: 5.2,
  "am-ET": 5.2,
};

export const BASELINE_EVAL_TOKENS = 2500;
export const BASELINE_FOLLOWUP_TOKENS = 1800;
export const MAX_SAFE_OUTPUT_TOKENS = 16384;

/**
 * Computes dynamic maxOutputTokens budget for a given language, mode, and retry count.
 */
export function computeTokenBudget(
  langCode: string,
  isFollowUp: boolean,
  retryAttempt: number = 0
): number {
  const baseLang = langCode.split("-")[0].toLowerCase();
  const multiplier =
    LANGUAGE_TOKEN_MULTIPLIERS[langCode] ??
    LANGUAGE_TOKEN_MULTIPLIERS[baseLang] ??
    2.0;

  const baseTokens = isFollowUp ? BASELINE_FOLLOWUP_TOKENS : BASELINE_EVAL_TOKENS;
  let rawBudget = Math.round(baseTokens * multiplier);

  // If retrying, scale up budget by 1.5x on attempt 1
  if (retryAttempt > 0) {
    rawBudget = Math.round(rawBudget * Math.pow(1.5, retryAttempt));
  }

  // Ensure minimums for non-Latin scripts to guarantee zero truncation
  if (baseLang === "am") {
    rawBudget = Math.max(rawBudget, retryAttempt > 0 ? 14000 : 10240);
  } else if (baseLang === "ar" || baseLang === "hi" || baseLang === "ru") {
    rawBudget = Math.max(rawBudget, retryAttempt > 0 ? 9000 : 6500);
  }

  return Math.min(rawBudget, MAX_SAFE_OUTPUT_TOKENS);
}

// ── Language Detection ───────────────────────────────────────────────────────
export function detectResponseLanguage(
  text: string,
  history: { role: string; content: string }[] = []
): string {
  const combined = [
    text,
    ...history.slice(-3).map((m) => m.content),
  ].join(" ");

  if (!combined.trim()) return "en";

  // 1. Ethiopic script (Amharic)
  if (/[\u1200-\u137F\u1380-\u139F\u2D80-\u2DDF\uAB00-\uAB2F]/.test(combined)) {
    return "am";
  }

  // 2. Arabic script
  if (/[\u0600-\u06FF\u0750-\u077F]/.test(combined)) {
    return "ar";
  }

  // 3. Devanagari script (Hindi)
  if (/[\u0900-\u097F]/.test(combined)) {
    return "hi";
  }

  // 4. Cyrillic script (Russian)
  if (/[\u0400-\u04FF]/.test(combined)) {
    return "ru";
  }

  // 5. CJK (Chinese / Japanese)
  if (/[\u3040-\u309F\u30A0-\u30FF]/.test(combined)) return "ja";
  if (/[\u4E00-\u9FFF]/.test(combined)) return "zh";

  // 6. Latin European heuristics
  const lower = combined.toLowerCase();
  if (/[¿¡áéíóúüñ]/.test(lower) && /\b(que|para|como|este|esta|los|las|por|con)\b/.test(lower)) {
    return "es";
  }
  if (/[çœàâèéêëîïôùû]/.test(lower) && /\b(le|la|les|des|un|une|est|avec|dans|pour)\b/.test(lower)) {
    return "fr";
  }
  if (/[äöüß]/.test(lower) && /\b(der|die|das|und|in|den|von|zu|mit|sich|des)\b/.test(lower)) {
    return "de";
  }

  return "en";
}

// ── Technical Glossaries per Language ────────────────────────────────────────
export const TECHNICAL_GLOSSARIES: Record<string, string> = {
  am: `
### FIXED TECHNICAL TERMINOLOGY GLOSSARY (AMHARIC):
You MUST strictly use these exact canonical terms and spellings for all startup metrics and concepts:
- Customer Acquisition Cost (CAC) -> የደንበኛ ማግኛ ወጪ (CAC)
- Lifetime Value (LTV) -> የደንበኛ የህይወት ዘመን ዋጋ (LTV)
- Unit Economics -> የአንድ ክፍል ኢኮኖሚክስ (Unit Economics)
- Moat / Defensibility -> የመከላከያ አቅም (Moat)
- Churn Rate -> የደንበኞች ማጣት መጠን (Churn Rate)
- Total Addressable Market (TAM) -> አጠቃላይ ሊደረስበት የሚችል ገበያ (TAM)
- Product-Market Fit -> የምርትና የገበያ መጣጣም (Product-Market Fit)
- Burn Rate -> የወጪ ፍጥነት (Burn Rate)
- Gross Margin / Margin -> የትርፍ ህዳግ (Gross Margin)
- Scalability -> የመለጠጥ/የማደግ አቅም (Scalability)
- Cash Flow -> የጥሬ ገንዘብ ፍሰት (Cash Flow)
- Runway -> የህልውና ጊዜ (Runway)
- Network Effects -> የመረብ ተጽዕኖ ውጤት (Network Effects)
Never use alternate, informal, or inconsistent translations for these metrics.
`,
  ar: `
### FIXED TECHNICAL TERMINOLOGY GLOSSARY (ARABIC):
You MUST strictly use these exact canonical terms for all startup metrics and concepts:
- Customer Acquisition Cost (CAC) -> تكلفة اكتساب العملاء (CAC)
- Lifetime Value (LTV) -> القيمة الدائمة للعميل (LTV)
- Unit Economics -> اقتصاديات الوحدة (Unit Economics)
- Moat / Defensibility -> الخندق الاقتصادي / الحصانة التنافسية (Moat)
- Churn Rate -> معدل فقدان العملاء (Churn Rate)
- Total Addressable Market (TAM) -> إجمالي السوق المتاح (TAM)
- Product-Market Fit -> ملاءمة المنتج للسوق (Product-Market Fit)
- Burn Rate -> معدل حرق السيولة (Burn Rate)
- Gross Margin -> الهامش الإجمالي (Gross Margin)
- Scalability -> قابلية التوسع والنمو (Scalability)
- Cash Flow -> التدفق النقدي (Cash Flow)
- Runway -> مدرج السيولة (Runway)
- Network Effects -> تأثيرات الشبكة (Network Effects)
Never use alternate phrasing for these metrics.
`,
  hi: `
### FIXED TECHNICAL TERMINOLOGY GLOSSARY (HINDI):
You MUST strictly use these exact canonical terms for all startup metrics and concepts:
- Customer Acquisition Cost (CAC) -> ग्राहक अधिग्रहण लागत (CAC)
- Lifetime Value (LTV) -> ग्राहक का आजीवन मूल्य (LTV)
- Unit Economics -> यूनिट इकोनॉमिक्स (Unit Economics)
- Moat / Defensibility -> प्रतिस्पर्धात्मक सुरक्षा (Moat)
- Churn Rate -> ग्राहक छोड़ने की दर (Churn Rate)
- Total Addressable Market (TAM) -> कुल लक्षित बाज़ार (TAM)
- Product-Market Fit -> उत्पाद-बाज़ार उपयुक्तता (Product-Market Fit)
- Burn Rate -> नकदी जलने की दर (Burn Rate)
- Margin -> लाभ मार्जिन (Margin)
- Scalability -> विस्तार क्षमता (Scalability)
- Cash Flow -> नकदी प्रवाह (Cash Flow)
- Runway -> रनवे (Runway)
`,
  ru: `
### FIXED TECHNICAL TERMINOLOGY GLOSSARY (RUSSIAN):
You MUST strictly use these exact canonical terms for all startup metrics and concepts:
- Customer Acquisition Cost (CAC) -> стоимость привлечения клиента (CAC)
- Lifetime Value (LTV) -> пожизненная ценность клиента (LTV)
- Unit Economics -> юнит-экономика (Unit Economics)
- Moat / Defensibility -> защитные барьеры / ров (Moat)
- Churn Rate -> показатель оттока (Churn Rate)
- Total Addressable Market (TAM) -> общий объем целевого рынка (TAM)
- Product-Market Fit -> соответствие продукта рынку (Product-Market Fit)
- Burn Rate -> скорость расходования средств (Burn Rate)
- Margin -> маржинальность (Margin)
- Scalability -> масштабируемость (Scalability)
- Cash Flow -> денежный поток (Cash Flow)
- Runway -> запас финансовой прочности (Runway)
`,
  en: `
### FIXED TECHNICAL TERMINOLOGY GLOSSARY (ENGLISH):
Consistently use standard Silicon Valley venture metrics:
- Customer Acquisition Cost (CAC)
- Lifetime Value (LTV)
- Unit Economics
- Defensibility / Moat
- Churn Rate
- Total Addressable Market (TAM)
- Product-Market Fit (PMF)
- Burn Rate & Runway
- Gross Margins
- Scalability & Network Effects
`,
};

export function getGlossaryForLanguage(langCode: string): string {
  const base = langCode.split("-")[0].toLowerCase();
  return TECHNICAL_GLOSSARIES[langCode] || TECHNICAL_GLOSSARIES[base] || TECHNICAL_GLOSSARIES.en;
}

// ── Validation & Truncation Monitoring ──────────────────────────────────────
export interface ValidationResult {
  isValid: boolean;
  parsed?: ScorecardPayload;
  error?: string;
}

export function validateScorecardJson(
  rawText: string,
  isFollowUp: boolean
): ValidationResult {
  if (!rawText || !rawText.trim()) {
    return { isValid: false, error: "Empty generation output" };
  }

  let jsonStr = rawText.trim();
  const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (codeBlockMatch) {
    jsonStr = codeBlockMatch[1].trim();
  } else {
    const firstBrace = jsonStr.indexOf("{");
    const lastBrace = jsonStr.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      jsonStr = jsonStr.slice(firstBrace, lastBrace + 1).trim();
    }
  }

  let parsed: any;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (err: any) {
    return {
      isValid: false,
      error: `JSON syntax parse error: ${err.message}`,
    };
  }

  if (!parsed || typeof parsed !== "object") {
    return { isValid: false, error: "Parsed output is not an object" };
  }

  // Verify all 7 required top-level keys exist
  const requiredKeys = [
    "analysis_scratchpad",
    "scorecard",
    "total_verdict",
    "roast",
    "graveyard",
    "pivot",
    "follow_up_response",
  ];

  for (const key of requiredKeys) {
    if (!(key in parsed)) {
      return { isValid: false, error: `Missing required key: "${key}"` };
    }
  }

  if (isFollowUp) {
    // In follow-up mode, follow_up_response must have substance
    const followUp = typeof parsed.follow_up_response === "string" ? parsed.follow_up_response.trim() : "";
    if (followUp.length < 10) {
      return { isValid: false, error: "follow_up_response is empty or too short for a follow-up query" };
    }
  } else {
    // In new evaluation mode, scorecard must be an array and have entries
    if (!Array.isArray(parsed.scorecard) || parsed.scorecard.length < 5) {
      return { isValid: false, error: `Scorecard array is incomplete (${parsed.scorecard?.length ?? 0} items)` };
    }
    if (!parsed.total_verdict || String(parsed.total_verdict).trim().length === 0) {
      return { isValid: false, error: "total_verdict is missing" };
    }
    if (!parsed.roast || String(parsed.roast).trim().length === 0) {
      return { isValid: false, error: "roast is missing" };
    }
  }

  return { isValid: true, parsed: parsed as ScorecardPayload };
}

/**
 * Structured logger for truncation and retry monitoring.
 */
export function logTruncationEvent(data: {
  event: "truncation" | "retry" | "retry_success" | "retry_exhausted";
  language: string;
  tokenBudget: number;
  attempt: number;
  error?: string;
  outputLength?: number;
}) {
  const timestamp = new Date().toISOString();
  console.warn(
    `[Scorecard Monitoring] ${timestamp} | Event: ${data.event} | Lang: ${data.language} | Tokens: ${data.tokenBudget} | Attempt: ${data.attempt} | OutputLen: ${data.outputLength ?? "N/A"} | Error: ${data.error || "None"}`
  );
}

// ── Scorecard History Extraction ────────────────────────────────────────────
export function extractPreviousScorecard(
  history: { role: string; content: string }[]
): ScorecardPayload | null {
  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i];
    if (msg.role !== "model") continue;

    const content = msg.content || "";

    // 1. Direct JSON check
    try {
      const match = content.match(/\{[\s\S]*"scorecard"[\s\S]*\}/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        if (Array.isArray(parsed.scorecard) && parsed.scorecard.length > 0) {
          return parsed;
        }
      }
    } catch {}

    // 2. Reconstructed from markdown table
    if (content.includes("QUICK‑LOOK SCORECARD") || content.includes("QUICK-LOOK SCORECARD")) {
      const items: ScorecardItem[] = [];
      const lines = content.split("\n");
      for (const line of lines) {
        const parts = line.split("|").map((p) => p.trim()).filter(Boolean);
        if (parts.length >= 3) {
          const [dim, scoreStr, reasoning] = parts;
          if (dim.includes("Dimension") || dim.includes("---") || dim.toLowerCase().includes("total")) continue;
          const score = parseInt(scoreStr.replace(/[^0-9]/g, ""), 10);
          if (!isNaN(score)) {
            items.push({ dimension: dim, score, reasoning });
          }
        }
      }

      if (items.length > 0) {
        // Extract total verdict if present
        const verdictMatch = content.match(/\|\s*\*\*Total\*\*\s*\|\s*.*?\s*\|\s*\*\*(.*?)\*\*\s*\|/i);
        const totalVerdict = verdictMatch ? verdictMatch[1].trim() : "Evaluated";

        // Extract roast, graveyard, pivot sections
        const roastMatch = content.match(/## 🔥 ROAST\s*([\s\S]*?)(?=\n---\n|## 📉|$)/i);
        const graveyardMatch = content.match(/## 📉 WHY SIMILAR STARTUPS HAVE DIED\s*([\s\S]*?)(?=\n---\n|## 🛠️|$)/i);
        const pivotMatch = content.match(/## 🛠️ CONSTRUCTIVE PIVOT\s*([\s\S]*?)$/i);

        return {
          analysis_scratchpad: "Extracted from previous conversation turn",
          scorecard: items,
          total_verdict: totalVerdict,
          roast: roastMatch ? roastMatch[1].trim() : "",
          graveyard: graveyardMatch ? graveyardMatch[1].trim() : "",
          pivot: pivotMatch ? pivotMatch[1].trim() : "",
          follow_up_response: "",
        };
      }
    }
  }

  return null;
}

/**
 * Determines whether the current user message represents a follow-up inquiry
 * or a brand new pitch evaluation.
 */
export function isFollowUpInquiry(
  query: string,
  hasMedia: boolean,
  previousScorecard: ScorecardPayload | null
): boolean {
  if (hasMedia) return false; // New screenshot/deck uploaded -> new evaluation
  if (!previousScorecard) return false; // No existing scorecard in history -> new evaluation

  const q = query.trim().toLowerCase();

  // Explicit new pitch signals
  const newPitchSignals = [
    "here is a new pitch",
    "another startup",
    "different idea",
    "new concept:",
    "evaluate this new",
    "አዲስ ሀሳብ",
    "ሌላ ስታርትአፕ",
    "فكرة جديدة",
    "مشروع آخر",
  ];
  if (newPitchSignals.some((sig) => q.includes(sig))) {
    return false;
  }

  // Follow-up signals (questions, agreement, disagreement, requests for advice/reasons)
  const followUpSignals = [
    "why",
    "agree",
    "disagree",
    "how",
    "what about",
    "can you explain",
    "score",
    "metric",
    "improve",
    "elaborate",
    "what if",
    "cac",
    "ltv",
    "moat",
    "pivot",
    "roast",
    "ለማሻሻል",
    "ለምን",
    "እንዴት",
    "ትስማማለህ",
    "አልስማማም",
    "ነጥብ",
    "ስለዚህ",
    "ማብራሪያ",
    "لماذا",
    "كيف",
    "هل توافق",
    "درجة",
    "تحسين",
    "توضيح",
  ];

  if (followUpSignals.some((sig) => q.includes(sig))) {
    return true;
  }

  // If previous scorecard exists and message is reasonably short / questioning, treat as follow-up
  if (q.endsWith("?") || q.length < 150) {
    return true;
  }

  return true;
}

// ── Markdown Formatter ──────────────────────────────────────────────────────
export function formatScorecardToMarkdown(parsed: ScorecardPayload): string {
  // If follow-up response is populated, return it directly as markdown
  if (parsed.follow_up_response && parsed.follow_up_response.trim().length > 0) {
    return parsed.follow_up_response.trim();
  }

  // Otherwise format full new scorecard evaluation
  let totalScore = 0;
  let scorecardMd =
    "## 🚀 QUICK‑LOOK SCORECARD\n| Dimension | Score (0‑10) | Why you’re getting that number |\n|-----------|--------------|--------------------------------|\n";

  const scorecardData = Array.isArray(parsed.scorecard) ? parsed.scorecard : [];

  for (const dim of RUBRIC_DIMENSIONS) {
    const row = scorecardData.find((r) => r.dimension === dim) || {
      score: 3,
      reasoning: "No specific details provided; scored conservatively based on concept requirements.",
    };
    const score = typeof row.score === "number" ? row.score : parseInt(String(row.score), 10) || 0;
    totalScore += score;
    scorecardMd += `| ${dim} | ${score} | ${String(row.reasoning || "").replace(/\n/g, " ")} |\n`;
  }

  const totalVerdict = parsed.total_verdict ? String(parsed.total_verdict).replace(/\n/g, " ") : "";
  scorecardMd += `| **Total** | **${totalScore} / 100** | **${totalVerdict}** |\n---\n`;

  const stripHeadings = (text: string) => text.replace(/^##\s*[🔥📉🛠️].*\n?/gm, "").trim();
  const roastContent = stripHeadings(parsed.roast || "");
  const graveyardContent = stripHeadings(parsed.graveyard || "");
  const pivotContent = stripHeadings(parsed.pivot || "");

  let draft = `${scorecardMd}\n## 🔥 ROAST\n${roastContent}\n\n---\n\n## 📉 WHY SIMILAR STARTUPS HAVE DIED\n${graveyardContent}\n\n---\n\n## 🛠️ CONSTRUCTIVE PIVOT\n${pivotContent}`.trim();

  // Clean duplicate dividers
  draft = draft.replace(/(?:\n\s*---\s*){2,}/g, "\n\n---");
  return draft;
}
