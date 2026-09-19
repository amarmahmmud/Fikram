import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, getClientIP, AUTH_CHAT_LIMIT, INFERENCE_LIMIT } from "@/lib/rate-limiter";

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    // Rate limiting: stricter for inference (GPU-expensive)
    const rateLimitKey = user ? `user:inference:${user.id}` : `ip:inference:${getClientIP(req)}`;
    const rateLimitConfig = user ? AUTH_CHAT_LIMIT : INFERENCE_LIMIT;
    const { allowed, remaining, resetMs } = await checkRateLimit(rateLimitKey, rateLimitConfig);

    if (!allowed) {
      return NextResponse.json(
        {
          error: "Rate limit exceeded. Please try again later.",
          remaining: 0,
          retryAfterMs: resetMs,
        },
        {
          status: 429,
          headers: { "Retry-After": String(Math.ceil(resetMs / 1000)) },
        },
      );
    }

    const body = await req.json();
    const { jobId, messages, systemPrompt, temperature, maxNewTokens, audio_url, audio_base64, expected_phonemes } = body;

    if (!jobId) {
      return NextResponse.json({ error: "Missing jobId" }, { status: 400 });
    }

    // Support ASR audio inference mode
    if (audio_url || audio_base64) {
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

      const resJson = await modalRes.json();
      return NextResponse.json(resJson, { status: modalRes.status });
    }

    if (!messages || !Array.isArray(messages)) {
      return NextResponse.json({ error: "Invalid request: missing messages or audio" }, { status: 400 });
    }

    const { data: job } = await supabase
      .from("jobs")
      .select("*")
      .eq("id", jobId)
      .single();

    if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

    // Check access: must be owner OR job must be published
    const isOwner = user && job.user_id === user.id;
    const isPublished = (typeof job.config === "object" && job.config !== null && (job.config as Record<string, unknown>).published === true);

    if (!isOwner && !isPublished) {
      return NextResponse.json({ error: "Unauthorized access to this model" }, { status: 401 });
    }
    if (job.status?.toLowerCase() !== "completed") {
      return NextResponse.json({ error: "Model is still training!" }, { status: 400 });
    }
    if (!job.result_url) {
      return NextResponse.json({ error: "Model weights not found." }, { status: 400 });
    }

    // The result_url stores the R2 adapter prefix (e.g. "adapters/job-uuid")
    const adapterPrefix = job.result_url;

    // Get the Modal inference endpoint URL from env
    const modalInferenceUrl = process.env.MODAL_INFERENCE_URL;
    if (!modalInferenceUrl) {
      return NextResponse.json({ error: "Inference endpoint not configured." }, { status: 500 });
    }

    // Call the Modal inference endpoint
    // We pass R2 credentials so Modal can download the adapter
    const modalRes = await fetch(modalInferenceUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        adapter_prefix: adapterPrefix,
        base_model: job.base_model,  // Tell Modal which base model to load
        messages: messages,
        system_prompt: systemPrompt || "You are a helpful AI expert trained on custom data.",
        // Inference parameters (use defaults if not provided)
        ...(temperature !== undefined ? { temperature } : {}),
        ...(maxNewTokens !== undefined ? { max_new_tokens: maxNewTokens } : {}),
        // Pass R2 credentials so Modal can download the adapter
        r2_endpoint: `https://${process.env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
        r2_access_key: process.env.R2_ACCESS_KEY_ID,
        r2_secret_key: process.env.R2_SECRET_ACCESS_KEY,
        r2_bucket: process.env.R2_BUCKET_NAME,
      }),
    });

    const modalResText = await modalRes.text();
    let data: any = {};
    try {
      data = JSON.parse(modalResText);
    } catch {
      console.error("Non-JSON Modal response:", modalResText);
      return NextResponse.json({ error: modalResText || "Inference server error" }, { status: 500 });
    }

    if (!modalRes.ok || data.status === "failed") {
      return NextResponse.json({ error: data.error || "Inference failed" }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      reply: data.reply,
      ...(data.detected_family ? { detected_family: data.detected_family } : {}),
    });
  } catch (err: any) {
    console.error("Playground API error:", err);
    return NextResponse.json({ error: err.message || "Failed to generate response" }, { status: 500 });
  }
}

