import { NextResponse } from "next/server";
import { ASRWizardContext, validateASRWizardContext } from "@/lib/asr-wizard-types";
import { getRecommendedModel } from "@/lib/models";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const ctx: ASRWizardContext = body.wizardContext;

    if (!ctx) {
      return NextResponse.json({ error: "Missing wizardContext" }, { status: 400 });
    }

    const warnings = validateASRWizardContext(ctx);
    if (warnings.length > 0) {
      return NextResponse.json({ error: warnings[0].reason }, { status: 400 });
    }

    const recommendedModel = getRecommendedModel({
      needsRealtime: ctx.optimizeForRealtime,
      needsSifatLevel: ctx.scriptType === "QPS",
    });

    return NextResponse.json({ recommendedModelId: recommendedModel.id });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
