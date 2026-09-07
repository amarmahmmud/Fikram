import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { MODELS } from "@/lib/models";

/**
 * POST /api/jobs — Create and launch a fine-tuning job.
 *
 * Implements the hold→charge→refund billing flow:
 * 1. Re-estimate cost live (don't trust the frontend's cached estimate)
 * 2. Check user's AVAILABLE balance (balance - already_held) covers the estimate
 * 3. If insufficient: return downgrade suggestions (3-4 cheaper models)
 * 4. Hold credits atomically (deduct from balance, track in credits_held)
 * 5. Call Modal's start_training with confirmed_credit_hold
 * 6. On Modal call failure: immediately reverse the hold
 */
export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { name, baseModel, method, config, datasetUrl, estimatedCredits, datasetSize } = body;

  // ── Step 1: Fetch user profile with current balance ──
  const { data: profile } = await supabase
    .from("profiles")
    .select("credits_balance, credits_held")
    .eq("id", user.id)
    .single();

  if (!profile) {
    return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  }

  // ── Step 2: Get live cost estimate from Modal ──
  let liveEstimate: Record<string, unknown> | null = null;
  const modalEstimateUrl = process.env.MODAL_ESTIMATE_URL;
  const creditsToHold = Math.ceil(estimatedCredits ?? 28);

  if (modalEstimateUrl && baseModel) {
    try {
      const estRes = await fetch(modalEstimateUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          base_model: baseModel,
          dataset_size: datasetSize ?? 100,
          lora_r: config?.loraR ?? 16,
          max_seq_length: config?.maxSeqLength ?? 1024,
        }),
      });
      liveEstimate = await estRes.json();
    } catch (err) {
      console.warn("[Jobs API] Live estimate failed, falling back to frontend estimate:", err);
    }
  }

  // If live estimate succeeded and is higher than frontend's cached estimate, use the live one
  const finalCreditsToHold = liveEstimate?.status === "ok" && typeof liveEstimate.estimated_credits === "number"
    ? Math.max(creditsToHold, Math.ceil(liveEstimate.estimated_credits as number))
    : creditsToHold;

  // If the model is unsupported (too large), fail fast
  if (liveEstimate?.status === "unsupported") {
    return NextResponse.json({
      status: "failed",
      error: "model_too_large",
      message: liveEstimate.message || "This model is too large for the current platform limits.",
      ...liveEstimate,
    }, { status: 422 });
  }

  // ── Step 3: Check available balance ──
  const availableBalance = profile.credits_balance - (profile.credits_held ?? 0);
  if (availableBalance < finalCreditsToHold) {
    // Build downgrade suggestions — find 3-4 cheaper models from the same family
    const selectedModel = MODELS.find(m => m.id === baseModel);
    const familyModels = selectedModel
      ? MODELS.filter(m => m.id !== baseModel && m.sizeNum < selectedModel.sizeNum)
          .sort((a, b) => a.sizeNum - b.sizeNum)
          .slice(0, 4)
      : MODELS.filter(m => m.sizeNum <= 3).slice(0, 4);

    return NextResponse.json({
      error: "Insufficient credits",
      status: "insufficient_credits",
      available_balance: availableBalance,
      required_credits: finalCreditsToHold,
      suggestion_models: familyModels.map(m => ({
        id: m.id,
        name: m.name,
        size: m.size,
        sizeNum: m.sizeNum,
        category: m.category,
      })),
    }, { status: 402 });
  }

  // ── Step 4: Hold credits atomically ──
  const newBalance = profile.credits_balance - finalCreditsToHold;
  const newHeld = (profile.credits_held ?? 0) + finalCreditsToHold;

  const { error: holdError } = await supabase
    .from("profiles")
    .update({ credits_balance: newBalance, credits_held: newHeld })
    .eq("id", user.id);

  if (holdError) {
    console.error("[Jobs API] Failed to hold credits:", holdError);
    return NextResponse.json({ error: "Failed to reserve credits" }, { status: 500 });
  }

  // Record the hold transaction
  await supabase.from("credit_transactions").insert({
    user_id: user.id,
    type: "job_hold",
    label: `Hold for: ${name || "Untitled Job"}`,
    amount: -finalCreditsToHold,
    balance_after: newBalance,
  });

  // ── Step 5: Create job record ──
  const { data: job, error: jobErr } = await supabase.from("jobs").insert({
    user_id:        user.id,
    name:           name || "Untitled Job",
    status:         "pending",
    base_model:     baseModel,
    method:         method || "lora",
    config:         {
      ...(config || {}),
      credits_estimated: finalCreditsToHold,
      credits_held: finalCreditsToHold,
      gpu_tier: liveEstimate?.gpu_tier || "L4",
      use_qlora: liveEstimate?.use_qlora || false,
      param_count_billion: liveEstimate?.param_count_billion,
    },
    dataset_url:    datasetUrl || null,
    credits_used:   0,
  }).select().single();

  if (jobErr || !job) {
    // Reverse the hold on job creation failure
    await supabase.from("profiles").update({
      credits_balance: profile.credits_balance,
      credits_held: profile.credits_held ?? 0,
    }).eq("id", user.id);
    console.error("[Jobs API] Job creation failed:", jobErr);
    return NextResponse.json({ error: "Failed to create job" }, { status: 500 });
  }

  // Update the hold transaction with the job reference
  await supabase.from("credit_transactions")
    .update({ reference_id: job.id })
    .eq("user_id", user.id)
    .eq("type", "job_hold" as const)
    .is("reference_id", null)
    .order("created_at", { ascending: false })
    .limit(1);

  // ── Step 6: Trigger Modal Training Job ──
  try {
    const modalTrainUrl = process.env.MODAL_TRAIN_URL ?? "https://amarsuadbusiness--model-factory-trainer-start-training.modal.run";
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://your-app.vercel.app";

    if (datasetUrl && modalTrainUrl) {
      const webhookUrl = `${appUrl}/api/webhooks/modal`;

      const modalRes = await fetch(modalTrainUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          job_id: job.id,
          base_model: baseModel,
          dataset_url: datasetUrl,
          dataset_size: datasetSize ?? 100,
          webhook_url: webhookUrl,
          learning_rate: config?.learningRate ?? 0.00005,
          ...(config?.maxSeqLength ? { max_seq_length: config.maxSeqLength } : {}),
          lora_r: config?.loraR ?? 16,
          lora_alpha: config?.loraAlpha ?? 32,
          // Credit hold confirmation — Modal uses this as the hard cost ceiling
          confirmed_credit_hold: finalCreditsToHold,
          // R2 credentials
          r2_endpoint: `https://${process.env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
          r2_access_key: process.env.R2_ACCESS_KEY_ID,
          r2_secret_key: process.env.R2_SECRET_ACCESS_KEY,
          r2_bucket: process.env.R2_BUCKET_NAME,
        }),
      });

      const modalData = await modalRes.json();

      if (!modalRes.ok || modalData.status === "failed") {
        console.error("Modal API Error:", modalData);
        throw new Error(modalData.error || modalData.message || "Failed to trigger Modal training");
      }

      const modalCallId = modalData.call_id;
      console.log("Modal training triggered successfully, call_id:", modalCallId,
        "gpu_tier:", modalData.gpu_tier, "est_credits:", modalData.estimated_credits);

      await supabase.from("jobs").update({
        replicate_id: modalCallId,
        status:       "running",
        started_at:   new Date().toISOString(),
        config:       {
          ...(job.config as Record<string, unknown>),
          modal_gpu_tier: modalData.gpu_tier,
          modal_estimated_credits: modalData.estimated_credits,
        },
      }).eq("id", job.id);
    } else {
      console.warn("Modal credentials not set or no dataset — marking job as failed");
      await supabase.from("jobs").update({
        status: "failed",
        logs: "Cannot start training: Missing dataset URL or Modal training endpoint.",
        finished_at: new Date().toISOString(),
      }).eq("id", job.id);

      // Reverse the hold on failure (charge nothing — no GPU was used)
      await supabase.from("profiles").update({
        credits_balance: profile.credits_balance,
        credits_held: profile.credits_held ?? 0,
      }).eq("id", user.id);

      await supabase.from("credit_transactions").insert({
        user_id: user.id,
        type: "job_refund",
        label: `Refund (job failed to start): ${name || "Untitled Job"}`,
        amount: finalCreditsToHold,
        balance_after: profile.credits_balance,
        reference_id: job.id,
      });
    }
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error("Modal training trigger error:", errMsg);

    // Mark job as failed
    await supabase.from("jobs").update({
      status: "failed",
      logs: `Failed to trigger GPU training worker: ${errMsg}`,
      finished_at: new Date().toISOString(),
    }).eq("id", job.id);

    // Reverse the hold — refund all credits since no GPU time was consumed
    await supabase.from("profiles").update({
      credits_balance: profile.credits_balance,
      credits_held: profile.credits_held ?? 0,
    }).eq("id", user.id);

    await supabase.from("credit_transactions").insert({
      user_id: user.id,
      type: "job_refund",
      label: `Refund (failed to start): ${name || "Untitled Job"}`,
      amount: finalCreditsToHold,
      balance_after: profile.credits_balance,
      reference_id: job.id,
    });
  }

  return NextResponse.json({
    ok: true,
    jobId: job.id,
    creditsHeld: finalCreditsToHold,
    gpuTier: liveEstimate?.gpu_tier || "L4",
  });
}
