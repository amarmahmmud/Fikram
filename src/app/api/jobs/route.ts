import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

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

  // Trigger Modal Training Job
  try {
    const modalTrainUrl = process.env.MODAL_TRAIN_URL ?? "https://amarsuadbusiness--model-factory-trainer-start-training.modal.run";
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://your-app.vercel.app";

    if (datasetUrl && modalTrainUrl) {
      // The webhook Modal will call when training is done
      const webhookUrl = `${appUrl}/api/webhooks/modal`;

      // Call our deployed Modal start_training endpoint
      const modalRes = await fetch(modalTrainUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          job_id: job.id,
          dataset_url: datasetUrl,
          webhook_url: webhookUrl,
          num_train_epochs: config?.epochs ?? 1,
          learning_rate: config?.learningRate ?? 0.0002,
          max_steps: 30,  // Cap for cost control
          // Pass R2 credentials so Modal can upload the trained adapter
          r2_endpoint: `https://${process.env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
          r2_access_key: process.env.R2_ACCESS_KEY_ID,
          r2_secret_key: process.env.R2_SECRET_ACCESS_KEY,
          r2_bucket: process.env.R2_BUCKET_NAME,
        }),
      });

      const modalData = await modalRes.json();

      if (!modalRes.ok || modalData.status === "failed") {
        console.error("Modal API Error:", modalData);
        throw new Error(modalData.error || "Failed to trigger Modal training");
      }

      const modalCallId = modalData.call_id;
      console.log("Modal training triggered successfully, call_id:", modalCallId);

      // Update job with Modal call ID
      await supabase.from("jobs").update({
        replicate_id: modalCallId,
        status:       "running",
        started_at:   new Date().toISOString(),
      }).eq("id", job.id);
    } else {
      // No dataset or Modal credentials configured — mark as running for testing
      console.warn("Modal credentials not set or no dataset — marking job as running without training");
      await supabase.from("jobs").update({
        status: "running",
        started_at: new Date().toISOString(),
      }).eq("id", job.id);
    }
  } catch (err) {
    console.error("Modal training trigger error:", err);
    // Don't fail the whole request — job is saved, mark it running
    await supabase.from("jobs").update({
      status: "running",
      started_at: new Date().toISOString(),
    }).eq("id", job.id);
  }

  // Deduct credits
  const newBalance = profile.credits_balance - estimatedCredits;
  await supabase.from("profiles").update({ credits_balance: newBalance }).eq("id", user.id);
  await supabase.from("credit_transactions").insert({
    user_id:       user.id,
    type:          "job_consumed",
    label:         `Job: ${name}`,
    amount:        -estimatedCredits,
    balance_after: newBalance,
    reference_id:  job.id,
  });

  return NextResponse.json({ ok: true, jobId: job.id });
}
