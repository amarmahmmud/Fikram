import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import Replicate from "replicate";

const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN! });

// Model → Replicate fine-tuning destination mapping
const MODEL_MAP: Record<string, string> = {
  "meta-llama/Llama-3.1-8B-Instruct": "lucataco/llama-3-8b-instruct-lora",
  "mistralai/Mistral-7B-Instruct-v0.3": "lucataco/mistral-7b-v0.2-lora",
  "microsoft/Phi-3-mini-4k-instruct":   "lucataco/phi-3-mini-4k-instruct-lora",
  "google/gemma-2-9b-it":               "lucataco/gemma-2-9b-it-lora",
};

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { name, baseModel, method, config, datasetUrl, estimatedCredits } = body;

  // Check user has enough credits
  const { data: profile } = await supabase
    .from("profiles").select("credits_balance").eq("id", user.id).single();

  if (!profile || profile.credits_balance < estimatedCredits) {
    return NextResponse.json({ error: "Insufficient credits" }, { status: 402 });
  }

  // Create job record in DB
  const { data: job, error: jobErr } = await supabase.from("jobs").insert({
    user_id:        user.id,
    name:           name || "Untitled Job",
    status:         "pending",
    base_model:     baseModel,
    method:         method || "lora",
    config:         config || {},
    dataset_url:    datasetUrl || null,
    credits_used:   0,
  }).select().single();

  if (jobErr || !job) {
    return NextResponse.json({ error: "Failed to create job" }, { status: 500 });
  }

  // Trigger Replicate (non-blocking — webhook updates status)
  try {
    const replicateModel = MODEL_MAP[baseModel];
    if (replicateModel && datasetUrl) {
      const prediction = await replicate.predictions.create({
        model: replicateModel,
        input: {
          train_data:   datasetUrl,
          num_train_epochs: config?.epochs ?? 3,
          learning_rate:    config?.learningRate ?? 0.0002,
        },
        webhook: `${process.env.NEXT_PUBLIC_APP_URL ?? "https://your-app.vercel.app"}/api/webhooks/replicate?job_id=${job.id}`,
        webhook_events_filter: ["completed", "failed", "logs"],
      });

      // Update job with Replicate prediction ID and mark running
      await supabase.from("jobs").update({
        replicate_id: prediction.id,
        status:       "running",
        started_at:   new Date().toISOString(),
      }).eq("id", job.id);
    } else {
      // No dataset or model mapping — simulate for testing
      await supabase.from("jobs").update({ status: "running", started_at: new Date().toISOString() }).eq("id", job.id);
    }
  } catch (err) {
    console.error("Replicate error:", err);
    // Don't fail the whole request — job is created, just mark it
    await supabase.from("jobs").update({ status: "running", started_at: new Date().toISOString() }).eq("id", job.id);
  }

  // Deduct credits
  const newBalance = profile.credits_balance - estimatedCredits;
  await supabase.from("profiles").update({ credits_balance: newBalance }).eq("id", user.id);
  await supabase.from("credit_transactions").insert({
    user_id:      user.id,
    type:         "job_consumed",
    label:        `Job: ${name}`,
    amount:       -estimatedCredits,
    balance_after: newBalance,
    reference_id: job.id,
  });

  return NextResponse.json({ ok: true, jobId: job.id });
}
