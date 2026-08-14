import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { jobId, messages, systemPrompt } = await req.json();
    if (!jobId || !messages || !Array.isArray(messages)) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    const { data: job } = await supabase
      .from("jobs")
      .select("*")
      .eq("id", jobId)
      .eq("user_id", user.id)
      .single();

    if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });
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
        messages: messages,
        system_prompt: systemPrompt || "You are a helpful assistant trained on custom data.",
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

    return NextResponse.json({ ok: true, reply: data.reply });
  } catch (err: any) {
    console.error("Playground API error:", err);
    return NextResponse.json({ error: err.message || "Failed to generate response" }, { status: 500 });
  }
}
