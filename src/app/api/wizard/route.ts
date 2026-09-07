import { NextResponse } from "next/server";
import { SchemaType } from "@google/generative-ai";
import { getModelCatalogPrompt, getRecommendedModel, MODELS } from "@/lib/models";
import { WIZARD_QUESTION_IDS, type InterviewAnswerMap } from "@/lib/wizard-types";
import { generateWithModelFallback } from "@/lib/gemini";

// ─────────────────────────────────────────────
// Phase 1: Identity Interview — document-aware Q&A that builds a WizardContext
// Phase 2: Training Config — picks model & hyperparameters
// ─────────────────────────────────────────────

function buildSystemPrompt(documentSummary?: string) {
  const docBlock = documentSummary
    ? `\nThe user uploaded a document. Here is a summary of its content (use this to ask RELEVANT questions):\n---\n${documentSummary}\n---\n`
    : "\nThe user did NOT upload a document — they only described their goal in text.\n";

  return `You are an expert AI fine-tuning assistant for the Fikram platform.
Your job is to help users define their model's identity and then configure a fine-tuning job.
${docBlock}
You work in TWO PHASES:

══════════════════════════════════════════
PHASE 1 — MODEL IDENTITY (questions 1-5)
══════════════════════════════════════════

Ask 4-5 SHORT clarifying questions ONE AT A TIME. Each question MUST be a JSON object with an "id" field that tags which identity field this question is collecting:
{"type":"question","id":"persona","text":"Your question here","options":["Option A","Option B","Option C","Option D"],"allowCustom":true,"multiSelect":false}

Your questions MUST cover these topics (adapt them to the user's document/goal).
Use EXACTLY these IDs — they map 1:1 to the model identity fields:

1. id:"persona" — PERSONA: Who should this AI model be? What's its role, expertise, and professional identity?
   The persona defines the AI's ROLE — not a personality sketch, but an operational job description.
   Example: "What role should your AI take?" → options: ["Friendly advisor", "Expert analyst", "Patient teacher", "Professional consultant"]

2. id:"audience" — AUDIENCE: Who will ASK this model questions? What's their knowledge level?
   IMPORTANT: Audience describes the END USERS who interact with the model, NOT the role the AI plays.
   Example: "Who will use this model?" → options: ["Complete beginners", "Students", "Working professionals", "Domain experts"]

3. id:"style" — STYLE: What tone and voice should the model use?
   Style = HOW the model communicates — its linguistic register, formality, and personality in responses.
   Example: "What tone should your AI use?" → options: ["Friendly & conversational", "Professional & formal", "Academic & precise", "Casual & approachable"]

4. id:"format" — FORMAT: How should answers be structured?
   Format = the LAYOUT and STRUCTURE of responses — paragraphs, lists, verdict-first, etc.
   IMPORTANT: Format is DISTINCT from Style. Style = voice/tone, Format = structure/layout.
   Example: "How should answers be structured?" → options: ["Short & direct answers", "Detailed with examples", "Step-by-step guides", "Verdict-first, then analysis with citations"]

5. id:"language" — LANGUAGE: What language(s) will users interact in?
   Example: "What language will users interact in?" → options: ["English only", "Arabic only", "English + Arabic", "Multiple languages"]

If you have the document summary, make your questions SPECIFIC to the content. For example:
- If the doc is about cooking: "Should the AI focus on recipe instructions, nutrition advice, or ingredient substitutions?"
- If the doc is about law: "Should the AI answer like a lawyer advising clients or a professor teaching students?"

CRITICAL: After 4-5 questions are answered, output a MODEL IDENTITY JSON (not a question, not a config):
{"type":"identity","persona":"A friendly and knowledgeable [role]","audience":"[who], with [level] knowledge of [topic]","style":"[tone/voice description]","format":"[answer structure description]","boundaries":"[what the model should never do/claim]","reasoning":"[1-2 sentences explaining your choices]"}

The "boundaries" field is IMPORTANT — infer sensible boundaries from the domain. Use POSITIVE phrasing
paired with explicit stop conditions (research shows positive instructions are more reliably learned):
- Medical domain → "Always recommend consulting a healthcare professional. Never diagnose conditions or prescribe treatments."
- Legal domain → "Always recommend consulting a qualified lawyer. Never provide specific legal counsel or case-specific advice."
- Finance domain → "Always cite the specific source for financial claims. Never guarantee investment returns or provide personalized financial advice."
- Education → "Always base answers on provided source material. If the answer is not in the source, state: 'I don't have enough information to answer this.' Never fabricate facts."

══════════════════════════════════════════
PHASE 2 — TRAINING CONFIG (after identity)
══════════════════════════════════════════

After the user confirms their model identity (or if the conversation has 6+ user messages),
output a final config JSON:
{"type":"config","summary":"One sentence summary","recommendedModel":"meta-llama/Llama-3.1-8B-Instruct","method":"lora","epochs":3,"learningRate":0.0001,"batchSize":4,"estimatedCredits":28,"estimatedTime":"12-18 min","reasoning":"Why you chose this config including why this model is the best fit"}

CRITICAL RULES:
- Output ONLY raw JSON — no markdown fences, no explanation text, nothing else
- Keep question text SHORT (under 15 words)
- Give 3-5 options per question
- ALWAYS include the "id" field on question objects — it must be one of: "persona", "audience", "style", "format", "language"
- You MUST pick the best model from the catalog below based on the user's needs
- Consider: task type, language requirements, budget, quality needs

AVAILABLE MODELS (pick the best one based on user needs):
${getModelCatalogPrompt()}`;
}

// ─────────────────────────────────────────────
// Fallback questions — each tagged with the identity field it populates.
// RULE: The "id" field maps 1:1 to the identity field. NEVER use array
// position to determine which field an answer belongs to.
// ─────────────────────────────────────────────
const FALLBACK_QUESTIONS: {
  type: "question";
  id: string;
  text: string;
  options: string[];
  allowCustom: boolean;
  multiSelect: boolean;
}[] = [
  {
    type: "question",
    id: WIZARD_QUESTION_IDS.PERSONA,
    text: "What role should your AI model take?",
    options: ["Friendly advisor", "Expert analyst", "Patient teacher", "Professional consultant", "Creative assistant"],
    allowCustom: true,
    multiSelect: false,
  },
  {
    type: "question",
    id: WIZARD_QUESTION_IDS.AUDIENCE,
    text: "Who will ask this model questions?",
    options: ["Complete beginners", "Students learning the topic", "Working professionals", "Domain experts"],
    allowCustom: true,
    multiSelect: false,
  },
  {
    type: "question",
    id: WIZARD_QUESTION_IDS.STYLE,
    text: "What tone should your AI use?",
    options: ["Friendly & conversational", "Professional & formal", "Academic & precise", "Casual & approachable"],
    allowCustom: true,
    multiSelect: false,
  },
  {
    type: "question",
    id: WIZARD_QUESTION_IDS.FORMAT,
    text: "How should answers be structured?",
    options: ["Short & direct answers", "Detailed with examples", "Step-by-step guides", "Verdict-first, then analysis with citations"],
    allowCustom: true,
    multiSelect: false,
  },
  {
    type: "question",
    id: WIZARD_QUESTION_IDS.LANGUAGE,
    text: "What language will users interact in?",
    options: ["English only", "Arabic only", "English + Arabic", "Multiple languages"],
    allowCustom: true,
    multiSelect: false,
  },
];

// ─────────────────────────────────────────────
// Build a fallback identity from KEYED answers (never positional).
// The answeredQuestions map uses question IDs as keys, so each field
// gets the correct value regardless of question order or message count.
// ─────────────────────────────────────────────
function buildFallbackIdentity(answeredQuestions: InterviewAnswerMap): Record<string, unknown> {
  const persona = answeredQuestions[WIZARD_QUESTION_IDS.PERSONA];
  const audience = answeredQuestions[WIZARD_QUESTION_IDS.AUDIENCE];
  const style = answeredQuestions[WIZARD_QUESTION_IDS.STYLE];
  const format = answeredQuestions[WIZARD_QUESTION_IDS.FORMAT];

  return {
    type: "identity",
    persona: persona ? `A ${persona.toLowerCase()}` : "A knowledgeable and helpful AI assistant",
    audience: audience || "General users",
    style: style || "Clear and professional responses",
    format: format || "Well-structured paragraphs with examples",
    boundaries: "Always base answers on provided source material. If the answer is not in the source, state: 'I don't have enough information to answer this.' Never fabricate facts or cite sources that don't exist.",
    reasoning: "Based on your answers, this identity best matches your needs.",
  };
}

// ─────────────────────────────────────────────
// Determine the next fallback action based on how many questions
// have been answered (by ID), not by message count.
// ─────────────────────────────────────────────
function getFallbackResponse(answeredQuestions: InterviewAnswerMap) {
  const answeredCount = Object.keys(answeredQuestions).length;

  // After 3+ keyed answers, we have enough to build identity
  if (answeredCount >= 3) {
    return buildFallbackIdentity(answeredQuestions);
  }

  // Find the next unanswered question
  const answeredIds = new Set(Object.keys(answeredQuestions));
  const nextQuestion = FALLBACK_QUESTIONS.find((q) => !answeredIds.has(q.id));

  return nextQuestion || buildFallbackIdentity(answeredQuestions);
}

// ─────────────────────────────────────────────
// Gemini structured output schemas — ensures the model returns
// exactly the fields we expect, eliminating JSON parse failures
// and field-name hallucinations.
// ─────────────────────────────────────────────
const IDENTITY_SCHEMA = {
  type: SchemaType.OBJECT,
  properties: {
    type: { type: SchemaType.STRING, description: "Always 'identity'" },
    persona: { type: SchemaType.STRING, description: "Who the AI model should be — its role, expertise" },
    audience: { type: SchemaType.STRING, description: "Who will ASK this model questions — the end users" },
    style: { type: SchemaType.STRING, description: "The tone and voice the model uses" },
    format: { type: SchemaType.STRING, description: "How answers are structured (layout, length)" },
    boundaries: { type: SchemaType.STRING, description: "What the model should never do or claim" },
    reasoning: { type: SchemaType.STRING, description: "1-2 sentences explaining the choices" },
  },
  required: ["type", "persona", "audience", "style", "format", "boundaries", "reasoning"],
};

export async function POST(req: Request) {
  try {
    const body = await req.json() as {
      messages: { role: string; content: string }[];
      documentSummary?: string;
      phase?: "identity" | "config";
      answeredQuestions?: InterviewAnswerMap;
    };
    const { messages, documentSummary, phase, answeredQuestions: clientAnswers } = body;

    if (!messages?.length) {
      return NextResponse.json({ ok: false, error: "No messages provided" }, { status: 400 });
    }

    // Count how many user messages we have (for Gemini force-finish logic)
    const userMsgCount = messages.filter((m) => m.role === "user").length;

    // Use the keyed answer map from the client — this is the primary source
    // for fallback identity building (never positional array access)
    const answeredQuestions: InterviewAnswerMap = clientAnswers || {};

    // Build message history for Gemini
    const geminiMessages: { role: "user" | "model"; parts: { text: string }[] }[] = [];

    for (const m of messages) {
      const role = (m.role === "user" ? "user" : "model") as "user" | "model";
      const lastMsg = geminiMessages[geminiMessages.length - 1];

      // Gemini doesn't allow consecutive messages of the same role — merge them
      if (lastMsg && lastMsg.role === role) {
        lastMsg.parts[0].text += "\n" + m.content;
      } else {
        geminiMessages.push({ role, parts: [{ text: m.content }] });
      }
    }

    // Ensure first message is from user (Gemini requires this)
    if (geminiMessages.length > 0 && geminiMessages[0].role !== "user") {
      geminiMessages.shift();
    }

    // Force identity output after 5 answers if we're still in identity phase
    if (phase !== "config" && userMsgCount >= 5) {
      geminiMessages.push({
        role: "user" as const,
        parts: [{ text: "That is enough information. Output the model identity JSON now." }],
      });
    }

    // Force config output if we're in config phase
    if (phase === "config") {
      geminiMessages.push({
        role: "user" as const,
        parts: [{ text: "The user has confirmed the model identity. Output the final training config JSON now." }],
      });
    }

    let parsed = null;

    try {
      // Determine which schema to use based on conversation state
      const shouldOutputIdentity = phase !== "config" && userMsgCount >= 4;
      const shouldOutputConfig = phase === "config";

      // Use structured output when we know what type to expect,
      // fall back to free-form JSON for the question/identity ambiguity phase
      const generationConfig: Record<string, unknown> = {
        temperature: 0.3,
        maxOutputTokens: 1000,
      };

      // When we're forcing identity output, use the identity schema
      if (shouldOutputIdentity && !shouldOutputConfig) {
        generationConfig.responseMimeType = "application/json";
        generationConfig.responseSchema = IDENTITY_SCHEMA;
      }

      const result = await generateWithModelFallback(
        {
          contents: geminiMessages,
          generationConfig,
        },
        {
          systemInstruction: buildSystemPrompt(documentSummary),
        }
      );

      const text = result.response.text()?.trim() ?? "";
      console.log("[Wizard] Gemini raw response:", text.substring(0, 300));

      // Try parsing the response
      try {
        const clean = text
          .replace(/^```json\s*/i, "")
          .replace(/^```\s*/i, "")
          .replace(/```\s*$/i, "")
          .trim();
        parsed = JSON.parse(clean);
      } catch {
        // Try to find JSON anywhere in the response
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          try { parsed = JSON.parse(jsonMatch[0]); } catch { /* ignore */ }
        }
      }

      // Post-parse validation: ensure question IDs are valid
      if (parsed?.type === "question") {
        const validIds = new Set(Object.values(WIZARD_QUESTION_IDS));
        if (!parsed.id || !validIds.has(parsed.id)) {
          // AI returned a question without a valid ID — assign one based on
          // which fields haven't been answered yet
          const answeredIds = new Set(Object.keys(answeredQuestions));
          const missingId = Object.values(WIZARD_QUESTION_IDS).find((id) => !answeredIds.has(id));
          parsed.id = missingId || "persona";
          console.log(`[Wizard] Question missing ID, assigned: ${parsed.id}`);
        }
      }

      // Post-parse validation: ensure identity has distinct style vs format
      if (parsed?.type === "identity") {
        if (parsed.style && parsed.format && parsed.style === parsed.format) {
          console.warn("[Wizard] AI returned identical style and format — differentiating");
          parsed.format = `Structured: ${parsed.format}`;
        }
      }
    } catch (geminiErr) {
      console.error("[Wizard] Gemini API failed:", geminiErr instanceof Error ? geminiErr.message : geminiErr);
      // Fall through to fallback below
    }

    // If AI couldn't produce a valid response, use smart fallback
    if (!parsed) {
      console.log(`[Wizard] Using fallback (userMsgCount=${userMsgCount}, phase=${phase}, answeredKeys=${Object.keys(answeredQuestions).join(",")})`);

      // Use document-size-aware recommendation instead of always MODELS[0]
      const recommended = getRecommendedModel({
        documentSizeChars: documentSummary?.length ?? 0,
      });

      if (phase === "config") {
        parsed = {
          type: "config",
          summary: "Custom AI assistant based on your requirements",
          recommendedModel: recommended.id,
          method: "lora",
          epochs: 3,
          learningRate: 0.0001,
          batchSize: 4,
          estimatedCredits: recommended.credits.min,
          estimatedTime: `${recommended.speed === "fast" ? "5-15" : "10-25"} min`,
          reasoning: `${recommended.name} is recommended based on your document size — best quality-to-cost ratio for your data.`,
        };
      } else {
        // Use the keyed answer map — NEVER positional array access
        parsed = getFallbackResponse(answeredQuestions);
      }
    }

    // Validate model recommendation exists in our catalog
    if (parsed.type === "config" && parsed.recommendedModel) {
      const exists = MODELS.find((m) => m.id === parsed.recommendedModel);
      if (!exists) {
        const recommended = getRecommendedModel({
          documentSizeChars: documentSummary?.length ?? 0,
        });
        parsed.recommendedModel = recommended.id;
      }
    }

    return NextResponse.json({ ok: true, data: parsed });

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Wizard API error:", message);

    // Even in total failure, return config after enough attempts
    const recommended = getRecommendedModel();
    return NextResponse.json({
      ok: true,
      data: {
        type: "config",
        summary: "Custom AI assistant",
        recommendedModel: recommended.id,
        method: "lora",
        epochs: 3,
        learningRate: 0.0001,
        batchSize: 4,
        estimatedCredits: recommended.credits.min,
        estimatedTime: `${recommended.speed === "fast" ? "5-15" : "10-25"} min`,
        reasoning: `${recommended.name} is recommended as a reliable general-purpose model.`,
      },
    });
  }
}

