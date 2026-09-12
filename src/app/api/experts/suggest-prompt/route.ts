import { NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";

const googleApiKey = process.env.GOOGLE_CLOUD_API_KEY || process.env.GOOGLE_GEMINI_API_KEY;
const ai = new GoogleGenAI({ apiKey: googleApiKey || "" });

/**
 * POST /api/experts/suggest-prompt
 * Body: { name: string, description?: string, tone?: string, boundaries?: string }
 * Returns: { ok: true, systemPrompt: string }
 */
export async function POST(req: Request) {
  try {
    const { name, description, tone, boundaries } = await req.json();

    if (!name || typeof name !== "string") {
      return NextResponse.json({ ok: false, error: "Name is required" }, { status: 400 });
    }

    const systemInstruction = `You are an expert prompt engineer creating system prompts for RAG-based AI assistants.
Generate a concise, highly effective system prompt (3-5 sentences) tailored for an AI assistant.
The system prompt should define:
1. Role and Identity (who the assistant is)
2. Tone and Style (how it communicates)
3. Retrieval & Boundary Grounding (rely strictly on provided context and state when information isn't available)

Output ONLY the plain text of the system prompt. No markdown quotes, no explanations.`;

    const userPrompt = `Create a system prompt for an AI assistant:
- Name: "${name}"
- Description / Expertise: "${description || "General knowledge assistant"}"
- Preferred Tone: "${tone || "Professional, helpful, and clear"}"
- Boundaries / Rules: "${boundaries || "Always base answers on the provided context. If uncertain, state that the knowledge base does not specify."}"`;

    const result = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: userPrompt,
      config: {
        systemInstruction,
        temperature: 0.7,
        maxOutputTokens: 300,
      },
    });

    const systemPrompt = result.text?.trim() || "";

    return NextResponse.json({ ok: true, systemPrompt });
  } catch (err: any) {
    console.error("[SuggestPrompt] Error:", err);
    return NextResponse.json(
      { ok: false, error: err?.message || "Failed to generate prompt" },
      { status: 500 }
    );
  }
}
