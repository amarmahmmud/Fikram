import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Webhook endpoint that Modal calls when training completes or fails.
 *
 * Implements post-job billing reconciliation:
 * - On success: charge actual credits used, refund excess hold back to balance
 * - On failure: charge flat fee only, refund the rest
 * - Records all transactions with estimated-vs-actual breakdown
 *
 * Modal's train.py sends:
 * Success: { job_id, status: "completed", adapter_prefix, detected_family,
 *            resolved_base_model, actual_gpu_seconds, actual_credits,
 *            used_qlora_fallback }
 * Failure: { job_id, status: "failed", error, actual_gpu_seconds,
 *            credits_to_charge (flat fee) }
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const {
      job_id, status, adapter_prefix, detected_family, resolved_base_model,
      actual_gpu_seconds, actual_credits, credits_to_charge,
      error: errorMessage, used_qlora_fallback,
    } = body;

    console.log("Modal webhook received:", {
      job_id, status, adapter_prefix, detected_family,
      actual_gpu_seconds, actual_credits, credits_to_charge,
    });

    if (!job_id) {
      return NextResponse.json({ error: "Missing job_id" }, { status: 400 });
    }

    const supabase = createAdminClient();

    // Fetch the job and its owner's profile for reconciliation
    const { data: job } = await supabase
      .from("jobs")
      .select("*, profiles!inner(id, credits_balance, credits_held)")
      .eq("id", job_id)
      .single();

    if (!job) {
      console.error(`[Webhook] Job ${job_id} not found`);
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    const jobConfig = (job.config && typeof job.config === "object" && !Array.isArray(job.config))
      ? job.config as Record<string, unknown>
      : {};
    const creditsHeld = (jobConfig.credits_held as number) || 0;
    const profile = (job as Record<string, unknown>).profiles as {
      id: string;
      credits_balance: number;
      credits_held: number;
    };

    if (status === "completed" && adapter_prefix) {
      // ── SUCCESS: Charge actual usage, refund excess ──
      const actualCreditsCharged = Math.ceil(actual_credits ?? creditsHeld);
      const excessRefund = Math.max(0, creditsHeld - actualCreditsCharged);

      // Update user's balance: refund excess to balance, reduce held amount
      const newBalance = profile.credits_balance + excessRefund;
      const newHeld = Math.max(0, profile.credits_held - creditsHeld);

      await supabase.from("profiles").update({
        credits_balance: newBalance,
        credits_held: newHeld,
      }).eq("id", profile.id);

      // Record the actual charge transaction
      await supabase.from("credit_transactions").insert({
        user_id: profile.id,
        type: "job_consumed",
        label: `Training completed: ${job.name}`,
        amount: -actualCreditsCharged,
        balance_after: newBalance,
        reference_id: job_id,
      });

      // Record the refund transaction (if any excess)
      if (excessRefund > 0) {
        await supabase.from("credit_transactions").insert({
          user_id: profile.id,
          type: "job_refund",
          label: `Unused hold refunded: ${job.name}`,
          amount: excessRefund,
          balance_after: newBalance,
          reference_id: job_id,
        });
      }

      // Update job record
      await supabase.from("jobs").update({
        status: "completed",
        result_url: adapter_prefix,
        completed_at: new Date().toISOString(),
        credits_used: actualCreditsCharged,
        config: {
          ...jobConfig,
          ...(detected_family ? { detected_family } : {}),
          ...(resolved_base_model ? { resolved_base_model } : {}),
          actual_gpu_seconds: actual_gpu_seconds ?? 0,
          actual_credits: actualCreditsCharged,
          credits_refunded: excessRefund,
          used_qlora_fallback: used_qlora_fallback ?? false,
        },
      }).eq("id", job_id);

      console.log(`[Webhook] Job ${job_id} completed. Charged: ${actualCreditsCharged}, Refunded: ${excessRefund}`);

    } else {
      // ── FAILURE: Charge flat fee only, refund the rest ──
      const flatFee = Math.min(credits_to_charge ?? 25, creditsHeld);
      const refundAmount = Math.max(0, creditsHeld - flatFee);

      const newBalance = profile.credits_balance + refundAmount;
      const newHeld = Math.max(0, profile.credits_held - creditsHeld);

      await supabase.from("profiles").update({
        credits_balance: newBalance,
        credits_held: newHeld,
      }).eq("id", profile.id);

      // Record flat fee charge
      if (flatFee > 0) {
        await supabase.from("credit_transactions").insert({
          user_id: profile.id,
          type: "job_consumed",
          label: `Training failed (attempt fee): ${job.name}`,
          amount: -flatFee,
          balance_after: newBalance,
          reference_id: job_id,
        });
      }

      // Record refund
      if (refundAmount > 0) {
        await supabase.from("credit_transactions").insert({
          user_id: profile.id,
          type: "job_refund",
          label: `Refund (training failed): ${job.name}`,
          amount: refundAmount,
          balance_after: newBalance,
          reference_id: job_id,
        });
      }

      // Update job record
      await supabase.from("jobs").update({
        status: "failed",
        completed_at: new Date().toISOString(),
        credits_used: flatFee,
        logs: errorMessage || "Training failed",
        config: {
          ...jobConfig,
          actual_gpu_seconds: actual_gpu_seconds ?? 0,
          actual_credits: flatFee,
          credits_refunded: refundAmount,
          failure_error: errorMessage,
        },
      }).eq("id", job_id);

      console.warn(`[Webhook] Job ${job_id} failed. Flat fee: ${flatFee}, Refunded: ${refundAmount}. Error: ${errorMessage}`);
    }

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error("Modal webhook error:", errMsg);
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}
