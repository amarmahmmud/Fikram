import { NextResponse } from "next/server";
import { generateDataset } from "@/lib/dataset-pipeline";
import { WizardContext } from "@/lib/wizard-types";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { text, goal, wizardContext } = body as {
      text: string;
      goal?: string;
      wizardContext?: WizardContext;
    };

    if (!text) {
      return NextResponse.json({ error: "No text provided" }, { status: 400 });
    }

    const { jsonl, stats } = await generateDataset(
      text,
      goal || wizardContext?.goal || "",
      undefined,
      wizardContext
    );

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
