import { NextResponse } from "next/server";

/**
 * Batch cost estimation — calls estimate_cost for multiple models in parallel.
 * Used by the "insufficient credits" downgrade suggestion panel to show
 * cheaper alternatives with real cost estimates.
 *
 * POST body: { models: string[], dataset_size: number, lora_r?: number, max_seq_length?: number }
 * Returns: { ok: true, estimates: CostEstimate[] } sorted by estimated_credits ascending
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { models, dataset_size, lora_r, max_seq_length } = body;

    if (!models || !Array.isArray(models) || models.length === 0) {
      return NextResponse.json(
        { ok: false, error: "Missing or empty models array" },
        { status: 400 }
      );
    }

    // Cap at 6 models to avoid excessive parallel calls
    const modelList = models.slice(0, 6);

    const modalEstimateUrl = process.env.MODAL_ESTIMATE_URL;
    if (!modalEstimateUrl) {
      return NextResponse.json(
        { ok: false, error: "MODAL_ESTIMATE_URL not configured" },
        { status: 500 }
      );
    }

    // Call estimate_cost for each model in parallel
    const estimatePromises = modelList.map(async (base_model: string) => {
      try {
        const res = await fetch(modalEstimateUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            base_model,
            dataset_size: dataset_size ?? 100,
            lora_r: lora_r ?? 16,
            max_seq_length: max_seq_length ?? 1024,
          }),
        });
        const data = await res.json();
        return { model_id: base_model, ...data };
      } catch {
        return {
          model_id: base_model,
          status: "failed",
          error: "Estimation request failed",
        };
      }
    });

    const estimates = await Promise.all(estimatePromises);

    // Sort by estimated_credits ascending (cheapest first), failed estimates at end
    estimates.sort((a, b) => {
      if (a.status !== "ok" && b.status === "ok") return 1;
      if (a.status === "ok" && b.status !== "ok") return -1;
      return (a.estimated_credits ?? Infinity) - (b.estimated_credits ?? Infinity);
    });

    return NextResponse.json({ ok: true, estimates });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[estimate-cost/batch] Error:", message);
    return NextResponse.json(
      { ok: false, error: `Batch estimation failed: ${message}` },
      { status: 500 }
    );
  }
}
