import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, getClientIP, INFERENCE_LIMIT } from "@/lib/rate-limiter";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: jobId } = await params;
    if (!jobId) {
      return NextResponse.json({ error: "Missing job ID" }, { status: 400 });
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const rateLimitKey = user ? `user_${user.id}` : `ip_${getClientIP(req)}`;
    const { allowed, resetMs } = checkRateLimit(rateLimitKey, INFERENCE_LIMIT);
    if (!allowed) {
      return NextResponse.json(
        { error: `Too many requests. Please try again in ${Math.ceil(resetMs / 1000 / 60)} minutes.` },
        { status: 429 }
      );
    }

    // 1. Verify job exists and is completed
    const { data: job, error: jobErr } = await supabase
      .from("jobs")
      .select("*")
      .eq("id", jobId)
      .single();

    if (jobErr || !job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    if (job.status?.toLowerCase() !== "completed") {
      return NextResponse.json(
        { error: "Model is not ready for testing. Current status: " + job.status },
        { status: 400 }
      );
    }

    const body = await req.json();
    const { audio_url, audio_base64, expected_phonemes } = body;

    if (!audio_url && !audio_base64) {
      return NextResponse.json(
        { error: "Please provide an audio recording or audio URL to test." },
        { status: 400 }
      );
    }

    const modalEndpoint =
      process.env.MODAL_INFER_AUDIO_URL ||
      "https://amarsuadbusiness--model-factory-trainer-infer-audio.modal.run";

    const modalPayload = {
      job_id: jobId,
      audio_url: audio_url || "",
      audio_base64: audio_base64 || "",
      expected_phonemes: expected_phonemes || null,
      r2_endpoint: `https://${process.env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      r2_access_key: process.env.R2_ACCESS_KEY_ID || "",
      r2_secret_key: process.env.R2_SECRET_ACCESS_KEY || "",
      r2_bucket: process.env.R2_BUCKET_NAME || "model-factory-datasets",
    };

    const modalRes = await fetch(modalEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(modalPayload),
    });

    const resText = await modalRes.text();
    let resJson: any = null;
    try {
      resJson = JSON.parse(resText);
    } catch {
      console.error("[Infer API] Non-JSON response from Modal:", resText);
      return NextResponse.json(
        { error: "Model inference server returned unexpected output: " + resText.slice(0, 300) },
        { status: 502 }
      );
    }

    if (!modalRes.ok || resJson.status === "failed") {
      return NextResponse.json(
        { error: resJson.error || "Inference failed on Modal" },
        { status: modalRes.status || 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      data: resJson,
    });
  } catch (err: any) {
    console.error("[Infer API] Internal error:", err);
    return NextResponse.json(
      { error: err.message || "Failed to process audio inference" },
      { status: 500 }
    );
  }
}
