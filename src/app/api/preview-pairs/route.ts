import { NextResponse } from "next/server";
import { generateForChunk } from "@/lib/dataset-pipeline";
import type { WizardContext } from "@/lib/wizard-types";
import { buildContextBlock, EMPTY_WIZARD_CONTEXT } from "@/lib/wizard-types";

/**
 * POST /api/preview-pairs
 * Body: { text: string, context: WizardContext }
 * Returns 5 synthetic Q&A pairs generated using the enriched wizard context.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const text: string = body.text;
    const context: WizardContext = body.context ?? EMPTY_WIZARD_CONTEXT;

    if (!text || typeof text !== "string") {
      return NextResponse.json({ ok: false, error: "No text provided" }, { status: 400 });
    }

    // Use the first ~4000 chars as a representative chunk for preview
    const chunk = text.slice(0, 4000);

    // Build the enriched context block and pass it as a string to generateForChunk
    const contextBlock = buildContextBlock(context);

    // generateForChunk accepts a string as the contextBlock parameter (overloaded)
    const pairs = await generateForChunk(chunk, contextBlock, 0, 1, contextBlock, "preview");

    // Return only the first 5 pairs
    const preview = pairs.slice(0, 5);

    return NextResponse.json({ ok: true, pairs: preview });
  } catch (err: any) {
    console.error("preview-pairs error:", err);
    return NextResponse.json({ ok: false, error: err?.message ?? "Unknown error" }, { status: 500 });
  }
}
