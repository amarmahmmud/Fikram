import { NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { Groq } from "groq-sdk";

const googleApiKey = process.env.GOOGLE_CLOUD_API_KEY || process.env.GOOGLE_GEMINI_API_KEY;
const ai = googleApiKey ? new GoogleGenAI({ apiKey: googleApiKey }) : null;

let groqClient: Groq | null = null;
function getGroq(): Groq | null {
  if (!groqClient && process.env.GROQ_API_KEY) {
    groqClient = new Groq({ apiKey: process.env.GROQ_API_KEY });
  }
  return groqClient;
}

export interface AlignmentOption {
  id: string;
  label: string;
  description: string;
}

export interface AlignmentQuestion {
  id: string;
  category: "audience" | "boundaries" | "structure";
  categoryLabel: string;
  question: string;
  description: string;
  options: AlignmentOption[];
}

const FALLBACK_QUESTIONS: AlignmentQuestion[] = [
  {
    id: "q_audience",
    category: "audience",
    categoryLabel: "Target Audience",
    question: "Who is the primary audience consulting this knowledge base?",
    description: "Calibrates terminology, explanation depth, and prerequisite assumptions.",
    options: [
      {
        id: "opt_clients",
        label: "Direct Clients & Customers",
        description: "Clear, practical explanations focused on solutions without internal complexity.",
      },
      {
        id: "opt_team",
        label: "Internal Team & Practitioners",
        description: "Technical precision, operational workflows, and rigorous source cross-referencing.",
      },
      {
        id: "opt_general",
        label: "General Public & Learners",
        description: "Approachable, foundational guidance with step-by-step conceptual clarity.",
      },
    ],
  },
  {
    id: "q_boundaries",
    category: "boundaries",
    categoryLabel: "Grounding Boundaries",
    question: "How should the assistant handle queries not found in the documents?",
    description: "Establishes retrieval containment to protect against ungrounded extrapolation.",
    options: [
      {
        id: "opt_strict",
        label: "Strict Document Grounding",
        description: "Decline immediately if unstated in the files. Never extrapolate or assume.",
      },
      {
        id: "opt_bounded",
        label: "Bounded Contextual Guidance",
        description: "Synthesize from the documents; clearly state when bridging with general knowledge.",
      },
      {
        id: "opt_referral",
        label: "Summary with Human Referral",
        description: "Offer a high-level summary and explicitly recommend consulting a verified expert.",
      },
    ],
  },
  {
    id: "q_structure",
    category: "structure",
    categoryLabel: "Response Structure",
    question: "What format best serves your users' day-to-day decision making?",
    description: "Determines the layout, citation density, and information hierarchy of replies.",
    options: [
      {
        id: "opt_actionable",
        label: "Actionable Checklists & Key Points",
        description: "Bullet points, bold takeaways, and explicit source citation references.",
      },
      {
        id: "opt_detailed",
        label: "In-Depth Analytical Walkthrough",
        description: "Thorough paragraphs explaining underlying logic, mechanics, and nuance.",
      },
      {
        id: "opt_executive",
        label: "Executive Briefing",
        description: "Distilled bottom-line synthesis upfront followed by essential supporting facts.",
      },
    ],
  },
];

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { expertName, description, filenames = [], snippets = [] } = body;

    const filesContext = Array.isArray(filenames) && filenames.length > 0
      ? filenames.slice(0, 10).join(", ")
      : "General knowledge document";

    const snippetContext = Array.isArray(snippets) && snippets.length > 0
      ? snippets.slice(0, 3).map((s: string) => String(s).slice(0, 300)).join("\n---\n")
      : "";

    const systemPrompt = `You are an enterprise AI alignment architect specializing in Retrieval-Augmented Generation (RAG).
Your goal is to inspect source documents and generate exactly 3 concise, highly relevant alignment questions before vector indexing.

RULES:
1. NEVER use any emojis or conversational filler (e.g. no "Hey!", no rocket icons, no generic praise). Keep the tone strictly executive, professional, and precise.
2. Question 1 MUST address Target Audience & Primary Persona based on the document types.
3. Question 2 MUST address Grounding Boundaries (how strictly the model should adhere to the source files when asked outside questions).
4. Question 3 MUST address Output Structure & Analytical Depth.
5. Provide exactly 3 distinct, mutually-exclusive options per question.
6. Return strictly a JSON object with this format, no markdown tags:
{
  "questions": [
    {
      "id": "q_audience",
      "category": "audience",
      "categoryLabel": "Target Audience",
      "question": "Clear question text?",
      "description": "Short 1-sentence explanation of how this influences RAG answers.",
      "options": [
        { "id": "opt_1", "label": "Concise Option Name", "description": "Short impact description." },
        { "id": "opt_2", "label": "Concise Option Name", "description": "Short impact description." },
        { "id": "opt_3", "label": "Concise Option Name", "description": "Short impact description." }
      ]
    },
    ... (total 3 questions: categories 'audience', 'boundaries', 'structure')
  ]
}`;

    const userPrompt = `Generate RAG alignment questions for:
- Expert Name: "${expertName || "Knowledge Assistant"}"
- Expert Domain/Description: "${description || "Specialized Knowledge Base"}"
- Uploaded Source Files: [${filesContext}]
${snippetContext ? `- File Content Excerpt:\n${snippetContext}` : ""}`;

    // 1. Try Gemini
    if (ai) {
      try {
        const result = await ai.models.generateContent({
          model: "gemini-2.5-flash",
          contents: userPrompt,
          config: {
            systemInstruction: systemPrompt,
            responseMimeType: "application/json",
            temperature: 0.3,
            maxOutputTokens: 900,
          },
        });

        const raw = result.text?.trim() || "";
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed.questions) && parsed.questions.length >= 3) {
          return NextResponse.json({ ok: true, questions: parsed.questions });
        }
      } catch (geminiErr) {
        console.warn("[AlignmentQuestions] Gemini failed, attempting Groq fallback:", geminiErr);
      }
    }

    // 2. Try Groq
    const groq = getGroq();
    if (groq) {
      try {
        const completion = await groq.chat.completions.create({
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          model: "llama-3.3-70b-versatile",
          temperature: 0.3,
          max_completion_tokens: 900,
          response_format: { type: "json_object" },
        });

        const raw = completion.choices[0]?.message?.content?.trim() || "";
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed.questions) && parsed.questions.length >= 3) {
          return NextResponse.json({ ok: true, questions: parsed.questions });
        }
      } catch (groqErr) {
        console.warn("[AlignmentQuestions] Groq failed, using verified fallbacks:", groqErr);
      }
    }

    // 3. Fallback
    return NextResponse.json({ ok: true, questions: FALLBACK_QUESTIONS });
  } catch (err: any) {
    console.error("[AlignmentQuestions] Unexpected error:", err);
    return NextResponse.json({ ok: true, questions: FALLBACK_QUESTIONS });
  }
}
