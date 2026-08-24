import { NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { getModelCatalogPrompt, MODELS } from "@/lib/models";

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GEMINI_API_KEY!);

const SYSTEM_PROMPT = `You are an expert AI fine-tuning assistant for the Fikra platform.
Your job is to help users configure a fine-tuning job for a large language model.

When a user describes their goal, you must:
1. Understand exactly what they want their model to do
2. Ask 2-3 short clarifying questions, ONE AT A TIME
3. Each question must be a JSON object with this EXACT format (no extra text, no markdown):
{"type":"question","text":"What is the primary language your users speak?","options":["English only","Arabic only","English + Arabic","Multiple languages"],"allowCustom":true,"multiSelect":false}

After all questions are answered (usually after 2-3 exchanges), output a final config JSON:
{"type":"config","summary":"One sentence summary","recommendedModel":"meta-llama/Llama-3.1-8B-Instruct","method":"lora","epochs":3,"learningRate":0.00002,"batchSize":4,"estimatedCredits":28,"estimatedTime":"12-18 min","reasoning":"Why you chose this config including why this model is the best fit"}

CRITICAL RULES:
- Output ONLY raw JSON — no markdown fences, no explanation text, nothing else
- Keep question text SHORT (under 15 words)
- Give 3-5 options per question
- After 2-3 questions, always output the config
- You MUST pick the best model from the catalog below based on the user's needs
- Consider: task type, language requirements, budget, quality needs

AVAILABLE MODELS (pick the best one based on user needs):
${getModelCatalogPrompt()}`;

// Fallback questions for when AI is unavailable
const FALLBACK_QUESTIONS = [
  {
    type: "question",
    text: "What tone should your model use?",
    options: ["Professional & formal", "Friendly & conversational", "Technical & precise", "Creative & expressive"],
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
  {
    type: "question",
    text: "How complex are the expected responses?",
    options: ["Short & simple (1-2 sentences)", "Medium detail (paragraph)", "Long & detailed (multiple paragraphs)", "Technical with examples"],
    allowCustom: true,
    multiSelect: false,
  },
];

function getFallbackResponse(userMsgCount: number) {
  // After 2+ answers, return config instead of looping questions
  if (userMsgCount >= 2) {
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
  // Return a different question each time (not the same one)
  const questionIndex = Math.min(userMsgCount, FALLBACK_QUESTIONS.length - 1);
  return FALLBACK_QUESTIONS[questionIndex];
}

export async function POST(req: Request) {
  try {
    const { messages } = await req.json() as { messages: { role: string; content: string }[] };

    if (!messages?.length) {
      return NextResponse.json({ ok: false, error: "No messages provided" }, { status: 400 });
    }

    // Count how many user messages we have
    const userMsgCount = messages.filter((m) => m.role === "user").length;

    // Build message history for Gemini
    // Gemini requires alternating user/model messages, starting with user
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

    // After 3 answers, force the AI to output the config
    if (userMsgCount >= 3) {
      geminiMessages.push({
        role: "user" as const,
        parts: [{ text: "That is enough information. Output the final config JSON now." }],
      });
    }

    let parsed = null;

    try {
      const model = genAI.getGenerativeModel({
        model: "gemini-3.6-flash",
        systemInstruction: SYSTEM_PROMPT,
      });

      const result = await model.generateContent({
        contents: geminiMessages,
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 800,
        },
      });

      const text = result.response.text()?.trim() ?? "";
      console.log("[Wizard] Gemini raw response:", text.substring(0, 200));

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
      console.log(`[Wizard] Using fallback (userMsgCount=${userMsgCount})`);
      parsed = getFallbackResponse(userMsgCount);
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
      data: getFallbackResponse(99), // Force config on total failure
    });
  }
}
