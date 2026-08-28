import { NextResponse } from "next/server";
import { generateForChunk } from "@/lib/dataset-pipeline"; // reuse generation logic for a single chunk
import { WizardContext, buildContextBlock } from "@/lib/wizard-types";

/**
 * POST /api/preview-pairs
 * Body: { text: string, context: WizardContext }
 * Returns 5 synthetic Q&A pairs generated using the same prompts the full pipeline uses.
 */
export async function POST(req: Request) {
  try {
    const { text, context } = await req.json();
    if (typeof text !== "string" || typeof context !== "object") {
      return NextResponse.json({ ok: false, error: "Invalid payload" }, { status: 400 });
    }
    // Use the first chunk only – smartChunk is internal, we mimic it simply
    const chunk = text.slice(0, 4000); // rough first chunk, enough for a preview
    const goal = context.goal;
    const prompt = buildContextBlock(context);
    // Call the generation function directly with the enriched prompt
    const pairs = await generateForChunk(chunk, goal, 0, 1, prompt, "general");
    // Return only the first 5 pairs (or less if generation returned fewer)
    const preview = pairs.slice(0, 5);
    return NextResponse.json({ ok: true, pairs: preview });
  } catch (err: any) {
    console.error("preview-pairs error:", err);
    return NextResponse.json({ ok: false, error: err?.message ?? "Unknown error" }, { status: 500 });
  }
}
