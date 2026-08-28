import { NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { getModelCatalogPrompt, MODELS } from "@/lib/models";

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GEMINI_API_KEY!);

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
PHASE 1 — MODEL IDENTITY (questions 1-4)
══════════════════════════════════════════

Ask 3-4 SHORT clarifying questions ONE AT A TIME. Each question MUST be a JSON object:
{"type":"question","text":"Your question here","options":["Option A","Option B","Option C","Option D"],"allowCustom":true,"multiSelect":false}

Your questions MUST cover these topics (adapt them to the user's document/goal):
1. PERSONA — Who should this AI model be? What's its role/expertise?
   Example: "What role should your AI take?" → options: ["Friendly advisor", "Expert analyst", "Patient teacher", "Professional consultant"]
2. AUDIENCE — Who will use this model? What's their knowledge level?
   Example: "Who will use this model?" → options: ["Complete beginners", "Students", "Working professionals", "Domain experts"]
3. STYLE & FORMAT — How should the model communicate?
   Example: "How should responses be structured?" → options: ["Short & direct answers", "Detailed with examples", "Step-by-step guides", "Formal analysis with citations"]
4. LANGUAGE — What language(s)?
   Example: "What language will users interact in?" → options: ["English only", "Arabic only", "English + Arabic", "Multiple languages"]

If you have the document summary, make your questions SPECIFIC to the content. For example:
- If the doc is about cooking: "Should the AI focus on recipe instructions, nutrition advice, or ingredient substitutions?"
- If the doc is about law: "Should the AI answer like a lawyer advising clients or a professor teaching students?"

CRITICAL: After 3-4 questions are answered, output a MODEL IDENTITY JSON (not a question, not a config):
{"type":"identity","persona":"A friendly and knowledgeable [role]","audience":"[who], with [level] knowledge of [topic]","style":"[writing style description]","format":"[answer structure description]","boundaries":"[what the model should never do/claim]","reasoning":"[1-2 sentences explaining your choices]"}

The "boundaries" field is IMPORTANT — infer sensible boundaries from the domain:
- Medical domain → "Never diagnose conditions or replace professional medical advice"
- Legal domain → "Never provide specific legal counsel; always recommend consulting a lawyer"
- Finance domain → "Never guarantee investment returns or provide personalized financial advice"
- Education → "Never fabricate facts; cite sources when possible"

══════════════════════════════════════════
PHASE 2 — TRAINING CONFIG (after identity)
══════════════════════════════════════════

After the user confirms their model identity (or if the conversation has 5+ user messages),
output a final config JSON:
{"type":"config","summary":"One sentence summary","recommendedModel":"meta-llama/Llama-3.1-8B-Instruct","method":"lora","epochs":3,"learningRate":0.00002,"batchSize":4,"estimatedCredits":28,"estimatedTime":"12-18 min","reasoning":"Why you chose this config including why this model is the best fit"}

CRITICAL RULES:
- Output ONLY raw JSON — no markdown fences, no explanation text, nothing else
- Keep question text SHORT (under 15 words)
- Give 3-5 options per question
- You MUST pick the best model from the catalog below based on the user's needs
- Consider: task type, language requirements, budget, quality needs

AVAILABLE MODELS (pick the best one based on user needs):
${getModelCatalogPrompt()}`;
}

// Fallback questions covering persona/audience/style (not the old generic ones)
const FALLBACK_QUESTIONS = [
  {
    type: "question",
    text: "What role should your AI model take?",
    options: ["Friendly advisor", "Expert analyst", "Patient teacher", "Professional consultant", "Creative assistant"],
    allowCustom: true,
    multiSelect: false,
  },
  {
    type: "question",
    text: "Who will use this model?",
    options: ["Complete beginners", "Students learning the topic", "Working professionals", "Domain experts"],
    allowCustom: true,
    multiSelect: false,
  },
  {
    type: "question",
    text: "How should responses be structured?",
    options: ["Short & direct answers", "Detailed with examples", "Step-by-step guides", "Formal analysis with citations"],
    allowCustom: true,
    multiSelect: false,
  },
  {
    type: "question",
    text: "What language will users interact in?",
    options: ["English only", "Arabic only", "English + Arabic", "Multiple languages"],
    allowCustom: true,
    multiSelect: false,
  },
];

// Build a fallback identity from collected answers
function buildFallbackIdentity(answers: string[]): Record<string, unknown> {
  return {
    type: "identity",
    persona: answers[0] ? `A ${answers[0].toLowerCase()}` : "A knowledgeable and helpful AI assistant",
    audience: answers[1] || "General users",
    style: answers[2] || "Clear and detailed responses",
    format: answers[2] || "Well-structured paragraphs with examples",
    boundaries: "Never fabricate facts. Clearly state when uncertain.",
    reasoning: "Based on your answers, this identity best matches your needs.",
  };
}

function getFallbackResponse(userMsgCount: number, answers: string[]) {
  // After 3+ answers, return identity (not config — identity comes first in the new flow)
  if (userMsgCount >= 3) {
    return buildFallbackIdentity(answers);
  }
  // After enough for config
  if (userMsgCount >= 5) {
    return {
      type: "config",
      summary: "Custom AI assistant based on your requirements",
      recommendedModel: MODELS[0].id,
      method: "lora",
      epochs: 3,
      learningRate: 0.00002,
      batchSize: 4,
      estimatedCredits: 28,
      estimatedTime: "12-18 min",
      reasoning: `${MODELS[0].name} is the best general-purpose model for chat and instruction tasks with excellent quality-to-cost ratio.`,
    };
  }
  const questionIndex = Math.min(userMsgCount, FALLBACK_QUESTIONS.length - 1);
  return FALLBACK_QUESTIONS[questionIndex];
}

export async function POST(req: Request) {
  try {
    const body = await req.json() as {
      messages: { role: string; content: string }[];
      documentSummary?: string;
      phase?: "identity" | "config";
    };
    const { messages, documentSummary, phase } = body;

    if (!messages?.length) {
      return NextResponse.json({ ok: false, error: "No messages provided" }, { status: 400 });
    }

    // Count how many user messages we have
    const userMsgCount = messages.filter((m) => m.role === "user").length;
    // Collect user answers for fallback identity building
    const userAnswers = messages.filter((m) => m.role === "user").map((m) => m.content);

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

    // Force identity output after 4 answers if we're still in identity phase
    if (phase !== "config" && userMsgCount >= 4) {
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
      const model = genAI.getGenerativeModel({
        model: "gemini-3.6-flash",
        systemInstruction: buildSystemPrompt(documentSummary),
      });

      const result = await model.generateContent({
        contents: geminiMessages,
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 1000,
        },
      });

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
    } catch (geminiErr) {
      console.error("[Wizard] Gemini API failed:", geminiErr instanceof Error ? geminiErr.message : geminiErr);
      // Fall through to fallback below
    }

    // If AI couldn't produce a valid response, use smart fallback
    if (!parsed) {
      console.log(`[Wizard] Using fallback (userMsgCount=${userMsgCount}, phase=${phase})`);
      if (phase === "config") {
        parsed = {
          type: "config",
          summary: "Custom AI assistant based on your requirements",
          recommendedModel: MODELS[0].id,
          method: "lora",
          epochs: 3,
          learningRate: 0.00002,
          batchSize: 4,
          estimatedCredits: 28,
          estimatedTime: "12-18 min",
          reasoning: `${MODELS[0].name} is the best general-purpose model with excellent quality-to-cost ratio.`,
        };
      } else {
        parsed = getFallbackResponse(userMsgCount, userAnswers);
      }
    }

    // Validate model recommendation exists in our catalog
    if (parsed.type === "config" && parsed.recommendedModel) {
      const exists = MODELS.find((m) => m.id === parsed.recommendedModel);
      if (!exists) {
        parsed.recommendedModel = MODELS[0].id;
      }
    }

    return NextResponse.json({ ok: true, data: parsed });

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Wizard API error:", message);

    // Even in total failure, return config after enough attempts
    return NextResponse.json({
      ok: true,
      data: {
        type: "config",
        summary: "Custom AI assistant",
        recommendedModel: MODELS[0].id,
        method: "lora",
        epochs: 3,
        learningRate: 0.00002,
        batchSize: 4,
        estimatedCredits: 28,
        estimatedTime: "12-18 min",
        reasoning: `${MODELS[0].name} is the best general-purpose model with excellent quality-to-cost ratio.`,
      },
    });
  }
}
