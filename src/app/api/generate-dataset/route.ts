import { NextResponse } from "next/server";
import Groq from "groq-sdk";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

export async function POST(req: Request) {
  try {
    const { text, goal } = await req.json();

    if (!text) {
      return NextResponse.json({ error: "No text provided" }, { status: 400 });
    }

    const systemPrompt = `You are an expert AI Data Engineer. Your job is to create a high-quality fine-tuning dataset based on the provided raw document text and the user's goal.
    
User's Goal: ${goal || "Extract knowledge into Q&A format."}

Instructions:
1. Generate between 15 and 40 diverse Question & Answer pairs based strictly on the knowledge in the document.
2. The format MUST be a valid JSON array of objects, with NO markdown formatting, NO code blocks, and NO introductory text. 
3. Each object must have exactly two keys: "prompt" (the user's message/question) and "completion" (the AI's ideal response).
4. Example output:
[
  {"prompt": "What is the return policy?", "completion": "You can return items within 30 days."},
  {"prompt": "How do I reset my password?", "completion": "Click the 'Forgot Password' link on the login page."}
]
    
Do NOT output anything other than the raw JSON array. Do not wrap in \`\`\`json.`;

    const completion = await groq.chat.completions.create({
      messages: [
        { role: "system", content: systemPrompt },
        // Limit text to ~50k chars to avoid token limits for Groq
        { role: "user", content: `Here is the document text:\n\n${text.substring(0, 50000)}` } 
      ],
      model: "llama-3.3-70b-versatile",
      temperature: 0.2, // Low temp for structured adherence
      max_tokens: 6000,
    });

    const rawResponse = completion.choices[0]?.message?.content || "[]";
    
    // Clean up potential markdown blocks if Groq ignored the prompt
    const cleaned = rawResponse.replace(/```json/gi, "").replace(/```/gi, "").trim();
    
    const parsedArray = JSON.parse(cleaned);

    if (!Array.isArray(parsedArray)) {
      throw new Error("Generated data is not an array");
    }

    // Convert JSON array to standard JSONL format
    const jsonlString = parsedArray.map(obj => JSON.stringify(obj)).join("\n");

    return NextResponse.json({ ok: true, jsonl: jsonlString });
  } catch (error: any) {
    console.error("Dataset Generation Error:", error);
    return NextResponse.json({ error: "Failed to generate dataset" }, { status: 500 });
  }
}
