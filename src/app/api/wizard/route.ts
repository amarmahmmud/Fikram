import { NextResponse } from "next/server";
import Groq from "groq-sdk";

// Groq is our primary AI — fast, reliable, free tier
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY! });

const SYSTEM_PROMPT = `You are an expert AI fine-tuning assistant for Model Factory platform.
Your job is to help users configure a fine-tuning job for a large language model.

When a user describes their goal, you must:
1. Understand exactly what they want their model to do
2. Ask 2-3 short clarifying questions, ONE AT A TIME
3. Each question must be a JSON object with this EXACT format (no extra text, no markdown):
{"type":"question","text":"What is the primary language your users speak?","options":["English only","Arabic only","English + Arabic","Multiple languages"],"allowCustom":true,"multiSelect":false}

After all questions are answered (usually after 2-3 exchanges), output a final config JSON:
{"type":"config","summary":"One sentence summary","recommendedModel":"meta-llama/Llama-3.1-8B-Instruct","method":"lora","epochs":3,"learningRate":0.0002,"batchSize":4,"estimatedCredits":28,"estimatedTime":"12-18 min","reasoning":"Why you chose this config"}

CRITICAL RULES:
- Output ONLY raw JSON — no markdown fences, no explanation text, nothing else
- Keep question text SHORT (under 15 words)
- Give 3-5 options per question
- After 2-3 questions, always output the config
- Pick the best model: Phi-3 Mini (simple tasks, 8-18 credits), Mistral 7B (general, 15-35), Llama 3.1 8B (chat/instruction, 20-40), Gemma 2 9B (complex, 25-50)`;

export async function POST(req: Request) {
  try {
    const { messages } = await req.json() as { messages: { role: string; content: string }[] };

    if (!messages?.length) {
      return NextResponse.json({ ok: false, error: "No messages provided" }, { status: 400 });
    }

    // Count how many user messages we have — forces config after 3 answers (prevents infinite loop)
    const userMsgCount = messages.filter((m) => m.role === "user").length;

    // Build Groq message history
    const groqMessages: { role: "system" | "user" | "assistant"; content: string }[] = [
      { role: "system", content: SYSTEM_PROMPT },
      ...messages.map((m) => ({
        role: (m.role === "user" ? "user" : "assistant") as "user" | "assistant",
        content: m.content,
      })),
    ];

    // After 3 answers, force the AI to output the config
    if (userMsgCount >= 3) {
      groqMessages.push({
        role: "user",
        content: "That is enough information. Output the final config JSON now.",
      });
    }

    const completion = await groq.chat.completions.create({
      model: "openai/gpt-oss-20b",
      messages: groqMessages,
      temperature: 0.3,
      max_tokens: 600,
    });

    const text = completion.choices[0]?.message?.content?.trim() ?? "";

    let parsed;
    try {
      const clean = text.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();
      parsed = JSON.parse(clean);
    } catch {
      // Try to find JSON anywhere in the response
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try { parsed = JSON.parse(jsonMatch[0]); } catch { parsed = null; }
      }
    }

    // If AI response couldn't be parsed, use smart fallback based on how many questions answered
    if (!parsed) {
      if (userMsgCount >= 2) {
        parsed = {
          type: "config",
          summary: "Custom AI assistant based on your requirements",
          recommendedModel: "meta-llama/Llama-3.1-8B-Instruct",
          method: "lora",
          epochs: 3,
          learningRate: 0.0002,
          batchSize: 4,
          estimatedCredits: 28,
          estimatedTime: "12-18 min",
          reasoning: "Llama 3.1 8B is the best general-purpose model for chat and instruction tasks.",
        };
      } else {
        parsed = {
          type: "question",
          text: "What tone should your model use?",
          options: ["Professional & formal", "Friendly & conversational", "Technical & precise", "Creative & expressive"],
          allowCustom: true,
          multiSelect: false,
        };
      }
    }

    return NextResponse.json({ ok: true, data: parsed });

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Wizard API error:", message);

    return NextResponse.json({
      ok: true,
      data: {
        type: "question",
        text: "What tone should your model use?",
        options: ["Professional & formal", "Friendly & conversational", "Technical & precise", "Creative & expressive"],
        allowCustom: true,
        multiSelect: false,
      },
    });
  }
}
