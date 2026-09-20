import { NextResponse } from "next/server";
import { generateWithModelFallback } from "@/lib/gemini";
import { extractPdfText } from "@/lib/document-ai";
import { Groq } from "groq-sdk";

export const maxDuration = 60;

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
        label: "Direct Clients & Practitioners",
        description: "Clear, practical explanations focused on solutions and application.",
      },
      {
        id: "opt_team",
        label: "Specialists & Researchers",
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
    question: "How strictly should the assistant adhere to the uploaded source files?",
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
    question: "What format best serves your users' decision-making and inquiry needs?",
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
        label: "Executive Synthesis",
        description: "Distilled bottom-line conclusion upfront followed by supporting facts.",
      },
    ],
  },
];

export async function POST(req: Request) {
  try {
    let expertName = "";
    let description = "";
    let filenames: string[] = [];
    let snippets: string[] = [];

    const contentType = req.headers.get("content-type") || "";

    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      expertName = String(formData.get("expertName") || "");
      description = String(formData.get("description") || "");

      const fNames = formData.getAll("filenames");
      if (fNames.length > 0) {
        filenames = fNames.map(String);
      }

      // Extract text content directly from uploaded files for deep grounding
      const uploadedFiles = formData.getAll("files");
      for (const item of uploadedFiles) {
        if (item instanceof File) {
          const ext = item.name.toLowerCase().split(".").pop() || "";
          try {
            if (ext === "pdf" || item.type === "application/pdf") {
              const arrayBuffer = await item.arrayBuffer();
              const fullPdfText = await extractPdfText(Buffer.from(arrayBuffer));
              if (fullPdfText.trim()) {
                // Use first ~5,000 chars which include title, TOC, intro, chapters
                snippets.push(fullPdfText.slice(0, 5000));
              }
            } else if (["txt", "md", "csv", "json"].includes(ext) || item.type.startsWith("text/")) {
              const textContent = await item.text();
              if (textContent.trim()) {
                snippets.push(textContent.slice(0, 4000));
              }
            }
          } catch (fileErr) {
            console.warn(`[AlignmentQuestions] Failed to sample file ${item.name}:`, fileErr);
          }
        }
      }
    } else {
      const body = await req.json();
      expertName = body.expertName || "";
      description = body.description || "";
      filenames = Array.isArray(body.filenames) ? body.filenames : [];
      snippets = Array.isArray(body.snippets) ? body.snippets : [];
    }

    const filesContext = filenames.length > 0
      ? filenames.slice(0, 10).join(", ")
      : "Knowledge document";

    const snippetContext = snippets.length > 0
      ? snippets.slice(0, 3).map((s) => String(s).slice(0, 2000)).join("\n---\n")
      : "";

    const systemPrompt = `You are an elite enterprise AI alignment architect specializing in Retrieval-Augmented Generation (RAG).
Your goal is to inspect source documents and generate exactly 3 concise, highly relevant alignment questions before vector indexing.

CRITICAL INSTRUCTIONS:
- The questions and options MUST be deeply domain-aware and tailored directly to the specific subject matter, concepts, terminology, language, and author perspective present in the uploaded document excerpt.
- NEVER generate generic, interchangeable placeholder questions (like 'Who is the primary audience consulting this knowledge base?') when document content is available.
- Reference the actual subject matter (e.g. if economics/Bitcoin: sound money, Austrian vs fiat economics, translation terminology, time preference; if medical: clinical diagnostic depth; if legal: statutory jurisdiction; etc.).
- Tone: Strictly executive, professional, and precise. NEVER use emojis, exclamation marks, or conversational filler.
- Question 1 MUST address: Target Audience & Practitioner Depth (tailored specifically to readers/professionals in this subject).
- Question 2 MUST address: Grounding Boundaries & Author/Theoretical Perspective (how strictly to uphold this document's specific stance vs conventional/opposing views).
- Question 3 MUST address: Output Structure & Analytical Rigor (e.g. conceptual deconstruction, comparative breakdown, practical takeaways with page citations).
- Provide exactly 3 distinct, high-signal options per question.
- Return ONLY valid JSON matching this exact structure:
{
  "questions": [
    {
      "id": "q_audience",
      "category": "audience",
      "categoryLabel": "Target Audience & Persona",
      "question": "Deeply domain-specific question text?",
      "description": "Short 1-sentence explanation of how this influences RAG answers.",
      "options": [
        { "id": "opt_1", "label": "Concise Option Name", "description": "Short impact description." },
        { "id": "opt_2", "label": "Concise Option Name", "description": "Short impact description." },
        { "id": "opt_3", "label": "Concise Option Name", "description": "Short impact description." }
      ]
    },
    {
      "id": "q_boundaries",
      "category": "boundaries",
      "categoryLabel": "Grounding & Perspective Adherence",
      "question": "Deeply domain-specific question text?",
      "description": "Short 1-sentence explanation of how this influences RAG answers.",
      "options": [
        { "id": "opt_1", "label": "Concise Option Name", "description": "Short impact description." },
        { "id": "opt_2", "label": "Concise Option Name", "description": "Short impact description." },
        { "id": "opt_3", "label": "Concise Option Name", "description": "Short impact description." }
      ]
    },
    {
      "id": "q_structure",
      "category": "structure",
      "categoryLabel": "Response Structure & Rigor",
      "question": "Deeply domain-specific question text?",
      "description": "Short 1-sentence explanation of how this influences RAG answers.",
      "options": [
        { "id": "opt_1", "label": "Concise Option Name", "description": "Short impact description." },
        { "id": "opt_2", "label": "Concise Option Name", "description": "Short impact description." },
        { "id": "opt_3", "label": "Concise Option Name", "description": "Short impact description." }
      ]
    }
  ]
}`;

    const userPrompt = `Generate RAG alignment questions for:
- Expert Name: "${expertName || "Knowledge Assistant"}"
- Expert Domain/Description: "${description || "Specialized Knowledge Base"}"
- Uploaded Source Files: [${filesContext}]
${snippetContext ? `- Content Excerpt from Uploaded Files:\n${snippetContext}` : ""}`;

    // 1. Try Gemini with modern models (gemini-3.6-flash, gemini-3.5-flash)
    try {
      const result = await generateWithModelFallback(userPrompt, {
        systemInstruction: systemPrompt,
        preferredModels: ["gemini-3.6-flash", "gemini-3.5-flash"],
        generationConfig: {
          responseMimeType: "application/json",
          temperature: 0.25,
          maxOutputTokens: 1200,
        },
      });

      const raw = result.text()?.trim() || "";
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed.questions) && parsed.questions.length >= 3) {
        return NextResponse.json({ ok: true, questions: parsed.questions });
      }
    } catch (geminiErr: any) {
      console.warn("[AlignmentQuestions] Gemini failed, attempting Groq fallback:", geminiErr?.message || geminiErr);
    }

    // 2. Try Groq (with available models)
    const groq = getGroq();
    if (groq) {
      try {
        const completion = await groq.chat.completions.create({
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          model: "openai/gpt-oss-120b",
          temperature: 0.3,
          max_completion_tokens: 1200,
          response_format: { type: "json_object" },
        });

        const raw = completion.choices[0]?.message?.content?.trim() || "";
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed.questions) && parsed.questions.length >= 3) {
          return NextResponse.json({ ok: true, questions: parsed.questions });
        }
      } catch (groqErr: any) {
        console.warn("[AlignmentQuestions] Groq failed, using verified fallbacks:", groqErr?.message || groqErr);
      }
    }

    // 3. Fallback
    return NextResponse.json({ ok: true, questions: FALLBACK_QUESTIONS });
  } catch (err: any) {
    console.error("[AlignmentQuestions] Unexpected error:", err);
    return NextResponse.json({ ok: true, questions: FALLBACK_QUESTIONS });
  }
}
