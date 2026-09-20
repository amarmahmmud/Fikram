import { NextResponse } from "next/server";
import { generateWithModelFallback } from "@/lib/gemini";
import { Groq } from "groq-sdk";

export const maxDuration = 30;

let groqClient: Groq | null = null;
function getGroq(): Groq | null {
  if (!groqClient && process.env.GROQ_API_KEY) {
    groqClient = new Groq({ apiKey: process.env.GROQ_API_KEY });
  }
  return groqClient;
}

function buildDeterministicPrompt(name: string, description: string, tone: string): string {
  const cleanName = name.trim();
  const domain = description.trim() || "the provided domain knowledge";
  const toneDesc = tone?.trim() || "Professional & Precise";
  return `You are ${cleanName}, an authoritative and specialized RAG AI Expert focusing on ${domain}. Communicate with a ${toneDesc.toLowerCase()} tone: deliver structured, actionable explanations grounded strictly in the source documents. Where verified source context is available, cite relevant principles and sections; if a query falls outside the knowledge base, state the boundaries clearly and avoid unfounded extrapolation.`;
}

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

    const systemInstruction = `You are an elite prompt architect creating system instructions for RAG AI Experts.
Generate an articulate, comprehensive system prompt (4-6 sentences) tailored specifically for this expert.
The system prompt must clearly define:
1. Role and identity (who this expert is and what expertise they possess)
2. Tone and communication demeanor (matching the specified tone)
3. Retrieval grounding and boundary discipline (relying directly on indexed source context, citing references when applicable, and explicitly stating when knowledge is absent)

Output ONLY the final plain text of the system prompt. Do not include markdown quotes, introductory pleasantries, or concluding notes.`;

    const userPrompt = `Generate a system prompt for this RAG AI Expert:
- Expert Name: "${name.trim()}"
- Core Domain / Role: "${description?.trim() || "Domain subject-matter expert"}"
- Preferred Tone: "${tone?.trim() || "Professional & Precise"}"
- Grounding Constraints: "${boundaries?.trim() || "Base all statements strictly on the retrieved knowledge base. Acknowledge boundaries if unstated in the source documents."}"`;

    // 1. Primary: Resilient Gemini (gemini-3.6-flash, gemini-3.5-flash) with thinking budget disabled to avoid token starvation
    try {
      const result = await generateWithModelFallback(userPrompt, {
        systemInstruction,
        preferredModels: ["gemini-3.6-flash", "gemini-3.5-flash"],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 800,
          thinkingConfig: { thinkingBudget: 0 },
        },
      });

      const promptText = result.text()?.trim() || "";
      if (promptText.length >= 40) {
        return NextResponse.json({ ok: true, systemPrompt: promptText });
      }
    } catch (geminiErr: any) {
      console.warn("[SuggestPrompt] Gemini failed, attempting Groq fallback:", geminiErr?.message || geminiErr);
    }

    // 2. Secondary: Groq fallback
    const groq = getGroq();
    if (groq) {
      try {
        const completion = await groq.chat.completions.create({
          messages: [
            { role: "system", content: systemInstruction },
            { role: "user", content: userPrompt },
          ],
          model: "openai/gpt-oss-120b",
          temperature: 0.6,
          max_completion_tokens: 800,
        });

        const promptText = completion.choices[0]?.message?.content?.trim() || "";
        if (promptText.length >= 40) {
          return NextResponse.json({ ok: true, systemPrompt: promptText });
        }
      } catch (groqErr: any) {
        console.warn("[SuggestPrompt] Groq fallback failed:", groqErr?.message || groqErr);
      }
    }

    // 3. Fallback: Guaranteed deterministic template
    const fallbackPrompt = buildDeterministicPrompt(name, description || "", tone || "");
    return NextResponse.json({ ok: true, systemPrompt: fallbackPrompt });
  } catch (err: any) {
    console.error("[SuggestPrompt] Unexpected error:", err);
    return NextResponse.json({
      ok: true,
      systemPrompt: buildDeterministicPrompt("Specialist", "domain documents", "Professional & Precise"),
    });
  }
}
