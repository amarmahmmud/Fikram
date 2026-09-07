// ─────────────────────────────────────────────
// Shared Wizard Types
// ─────────────────────────────────────────────

// ── Question IDs ──
// Each interview question is tagged with a stable ID that maps 1:1 to an
// identity field. This prevents positional/index-based mapping bugs where
// the wrong conversational turn gets written into the wrong field.
// RULE: NEVER access interview answers by array index — always by these IDs.
export const WIZARD_QUESTION_IDS = {
  PERSONA: "persona",
  AUDIENCE: "audience",
  STYLE: "style",
  FORMAT: "format",
  LANGUAGE: "language",
} as const;

export type WizardQuestionId = (typeof WIZARD_QUESTION_IDS)[keyof typeof WIZARD_QUESTION_IDS];

/**
 * Maps question ID → user's answer. Sent from the client alongside the
 * raw chat messages so the server can build the identity by explicit key,
 * never by message position.
 */
export type InterviewAnswerMap = Partial<Record<WizardQuestionId, string>>;

/** The enriched context collected from the wizard interview.
 *  Flows from the wizard UI → generate-dataset API → dataset pipeline.
 *  Every generation prompt uses this to produce higher-quality training pairs. */
export interface WizardContext {
  /** One-line description of what the user wants the model to do */
  goal: string;
  /** Who the model should "be" — e.g. "Friendly Islamic finance scholar" */
  persona: string;
  /** Who will use the model — e.g. "Muslim professionals with basic investing knowledge" */
  audience: string;
  /** Writing style / tone — e.g. "Authoritative but approachable, cite standards" */
  style: string;
  /** How answers should be structured — e.g. "Verdict-first, then 2-3 paragraphs" */
  format: string;
  /** What the model should never do — e.g. "Never issue fatwas" */
  boundaries: string;
  /** User-provided example Q&A pairs that calibrate the generation style */
  goldExamples: GoldExample[];
  /** AI-generated summary of the uploaded documents/URLs (first ~3000 chars) */
  documentSummary: string;
}

export interface GoldExample {
  question: string;
  answer: string;
}

/** Default empty context — used when the wizard is skipped or falls back */
export const EMPTY_WIZARD_CONTEXT: WizardContext = {
  goal: "",
  persona: "",
  audience: "",
  style: "",
  format: "",
  boundaries: "",
  goldExamples: [],
  documentSummary: "",
};

// ── Validation ──
// Phrases that commonly appear as raw chat messages and should NEVER be
// an identity field value. If any field matches one of these, the wizard
// has a mapping bug (e.g. grabbed a chat bubble instead of an answer).
const SUSPICIOUS_PHRASES = new Set([
  "lets go", "let's go", "hi", "hello", "hey", "ok", "okay", "yes",
  "no", "sure", "start", "go", "begin", "next", "continue", "skip",
  "test", "testing", "help", "thanks", "thank you",
]);

export interface WizardValidationWarning {
  field: string;
  value: string;
  reason: string;
}

/**
 * Validate a WizardContext before it flows downstream (Preview / Launch).
 * Returns an array of warnings — empty = all good.
 *
 * Catches:
 * - Empty fields
 * - Suspiciously short/generic values (< 5 chars)
 * - Known chat-UI phrases that should never be identity values
 * - Style === Format (likely a duplication bug)
 */
export function validateWizardContext(ctx: WizardContext): WizardValidationWarning[] {
  const warnings: WizardValidationWarning[] = [];
  const identityFields = ["persona", "audience", "style", "format", "boundaries"] as const;

  for (const field of identityFields) {
    const value = ctx[field]?.trim() || "";

    if (!value) {
      warnings.push({ field, value, reason: `${field} is empty` });
      continue;
    }

    if (value.length < 5) {
      warnings.push({ field, value, reason: `${field} is suspiciously short (${value.length} chars)` });
    }

    if (SUSPICIOUS_PHRASES.has(value.toLowerCase())) {
      warnings.push({
        field,
        value,
        reason: `${field} contains a raw chat phrase ("${value}") — likely a field-mapping bug`,
      });
    }
  }

  // Detect Style === Format duplication
  if (ctx.style && ctx.format && ctx.style.trim() === ctx.format.trim()) {
    warnings.push({
      field: "style/format",
      value: ctx.style,
      reason: "Style and Format have identical values — they should be distinct (tone/voice vs. answer structure)",
    });
  }

  return warnings;
}

/** Build a context block string from wizard context for injection into prompts */
export function buildContextBlock(ctx: WizardContext): string {
  const lines: string[] = [];

  if (ctx.goal) lines.push(`User's Goal: ${ctx.goal}`);
  if (ctx.persona) lines.push(`Model Persona: ${ctx.persona}`);
  if (ctx.audience) lines.push(`Target Audience: ${ctx.audience}`);
  if (ctx.style) lines.push(`Response Style: ${ctx.style}`);
  if (ctx.format) lines.push(`Response Format: ${ctx.format}`);
  if (ctx.boundaries) lines.push(`Boundaries: ${ctx.boundaries}`);

  if (ctx.goldExamples.length > 0) {
    lines.push("");
    lines.push("Here are example Q&A pairs the user approved (match this style closely):");
    for (const ex of ctx.goldExamples) {
      lines.push(`Q: "${ex.question}"`);
      lines.push(`A: "${ex.answer}"`);
      lines.push("");
    }
  }

  return lines.join("\n") || 'User\'s Goal: Extract knowledge into Q&A format.';
}
