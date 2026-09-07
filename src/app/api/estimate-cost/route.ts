import { NextResponse } from "next/server";

/**
 * Proxy to Modal's estimate_cost endpoint.
 * Frontend calls this instead of Modal directly (avoids CORS, keeps URL server-side).
 * No auth required — this is a free price preview, callable before any commitment.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { base_model, dataset_size, lora_r, max_seq_length } = body;

    if (!base_model) {
      return NextResponse.json(
        { status: "failed", error: "Missing base_model" },
        { status: 400 }
      );
    }

    const modalEstimateUrl = process.env.MODAL_ESTIMATE_URL;
    if (!modalEstimateUrl) {
      return NextResponse.json(
        { status: "failed", error: "MODAL_ESTIMATE_URL not configured" },
        { status: 500 }
      );
    }

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
    return NextResponse.json(data);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[estimate-cost] Error:", message);
    return NextResponse.json(
      { status: "failed", error: `Cost estimation failed: ${message}` },
      { status: 500 }
    );
  }
}
