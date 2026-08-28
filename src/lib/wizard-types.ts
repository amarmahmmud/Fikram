// ─────────────────────────────────────────────
// Shared Wizard Types
// ─────────────────────────────────────────────

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
  /** Writing style — e.g. "Authoritative but approachable, cite standards" */
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
