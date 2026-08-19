import { NextResponse } from "next/server";
import { generateDataset } from "@/lib/dataset-pipeline";

export async function POST(req: Request) {
  try {
    const { text, goal } = await req.json();

    if (!text) {
      return NextResponse.json({ error: "No text provided" }, { status: 400 });
    }

    const { jsonl, stats } = await generateDataset(text, goal);

    if (stats.afterDedup === 0) {
      return NextResponse.json({
        error: "Failed to generate any valid Q&A pairs from the document. Try a different file.",
      }, { status: 422 });
    }

    return NextResponse.json({
      ok: true,
      jsonl,
      stats,
    });
  } catch (error: any) {
    console.error("Dataset Generation Error:", error?.message ?? error);
    return NextResponse.json(
      { error: "Failed to generate dataset: " + (error?.message ?? "Unknown error") },
      { status: 500 }
    );
  }
}
