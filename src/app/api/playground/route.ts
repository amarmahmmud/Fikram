import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import Replicate from "replicate";

const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN! });

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { jobId, messages } = await req.json();
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
    if (job.status?.toLowerCase() !== "completed") return NextResponse.json({ error: "Model is still training!" }, { status: 400 });
    if (!job.result_url) return NextResponse.json({ error: "Model weights not found." }, { status: 400 });

    // Format prompt for Llama 3
    const prompt = messages.map(m => `<|start_header_id|>${m.role === 'model' || m.role === 'ai' ? 'assistant' : 'user'}<|end_header_id|>\n\n${m.content}<|eot_id|>`).join("") + "<|start_header_id|>assistant<|end_header_id|>\n\n";

    // Call Replicate using the fine-tuned model
    const prediction = await replicate.predictions.create({
      model: job.result_url as any,
      input: {
        prompt: prompt,
        max_new_tokens: 512,
        temperature: 0.7,
      },
    });

    // Return the prediction ID so the frontend can poll for the result
    return NextResponse.json({ ok: true, predictionId: prediction.id });
  } catch (err: any) {
    console.error("Playground API error:", err);
    return NextResponse.json({ error: err.message || "Failed to trigger prediction" }, { status: 500 });
  }
}
