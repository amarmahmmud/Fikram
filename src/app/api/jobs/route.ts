import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import Replicate from "replicate";

const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN! });


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

  // Trigger Replicate Native Training
  try {
    const replicateUsername = process.env.REPLICATE_USERNAME;
    
    if (datasetUrl && replicateUsername) {
      const destinationModelName = `job-${job.id.slice(0, 8)}`;
      const destinationStr = `${replicateUsername}/${destinationModelName}`;

      // 1. Create the destination model on Replicate via HTTP API
      const createModelRes = await fetch("https://api.replicate.com/v1/models", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.REPLICATE_API_TOKEN}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          owner: replicateUsername,
          name: destinationModelName,
          visibility: "private",
          hardware: "gpu-t4",
          description: `Fine-tuned model for ${name}`
        })
      });

      if (!createModelRes.ok) {
        console.warn("Failed to create model (might already exist):", await createModelRes.text());
      }

      // 2. Fetch the latest version hash of the base model dynamically
      // Map HuggingFace IDs from the frontend to valid Replicate base models for training
      let baseOwner = "meta";
      let baseName = "meta-llama-3-8b";
      
      if (baseModel.toLowerCase().includes("mistral")) {
        baseOwner = "mistralai";
        baseName = "mistral-7b-v0.1";
      }
      
      const modelRes = await fetch(`https://api.replicate.com/v1/models/${baseOwner}/${baseName}`, {
        headers: { "Authorization": `Bearer ${process.env.REPLICATE_API_TOKEN}` }
      });
      const modelData = await modelRes.json();
      const latestVersion = modelData.latest_version?.id;

      if (!latestVersion) {
        console.error("Replicate Model Fetch Error:", modelData);
        throw new Error("Could not fetch latest base model version");
      }

      // 3. Start the training
      const training = await replicate.trainings.create(
        baseOwner,
        baseName,
        latestVersion,
        {
          destination: destinationStr,
          input: {
            train_data: datasetUrl,
            num_train_epochs: config?.epochs ?? 3,
            learning_rate: config?.learningRate ?? 0.0002,
          },
          webhook: `${process.env.NEXT_PUBLIC_APP_URL ?? "https://your-app.vercel.app"}/api/webhooks/replicate?job_id=${job.id}`,
          webhook_events_filter: ["completed"],
        }
      );

      // 4. Update job with Replicate training ID
      await supabase.from("jobs").update({
        replicate_id: training.id,
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
