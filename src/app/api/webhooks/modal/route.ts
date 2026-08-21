import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Webhook endpoint that Modal calls when training completes.
 * Modal's train.py sends a POST with:
 * { job_id, status: "completed", adapter_prefix: "adapters/job-uuid",
 *   detected_family: "gemma", resolved_base_model: "unsloth/gemma-2-2b-it" }
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { job_id, status, adapter_prefix, detected_family, resolved_base_model } = body;

    console.log("Modal webhook received:", { job_id, status, adapter_prefix, detected_family, resolved_base_model });

    if (!job_id) {
      return NextResponse.json({ error: "Missing job_id" }, { status: 400 });
    }

    const supabase = await createClient();

    if (status === "completed" && adapter_prefix) {
      // Read existing config so we can merge new fields without overwriting
      const { data: existingJob } = await supabase
        .from("jobs")
        .select("config")
        .eq("id", job_id)
        .single();

      const existingConfig = (existingJob?.config && typeof existingJob.config === "object" && !Array.isArray(existingJob.config))
        ? existingJob.config as Record<string, unknown>
        : {};

      // Update job: mark as completed, store the R2 prefix as result_url,
      // and merge detected_family + resolved_base_model into config JSON
      const { error } = await supabase
        .from("jobs")
        .update({
          status:       "completed",
          result_url:   adapter_prefix,  // e.g. "adapters/job-uuid"
          completed_at: new Date().toISOString(),
          config:       {
            ...existingConfig,
            ...(detected_family ? { detected_family } : {}),
            ...(resolved_base_model ? { resolved_base_model } : {}),
          },
        })
        .eq("id", job_id);

      if (error) {
        console.error("Supabase update error:", error);
        return NextResponse.json({ error: "Failed to update job" }, { status: 500 });
      }

      console.log(`Job ${job_id} marked as completed with adapter at: ${adapter_prefix} (family: ${detected_family || "unknown"})`);
    } else {
      // Training failed or unknown status
      await supabase
        .from("jobs")
        .update({
          status:      "failed",
          completed_at: new Date().toISOString(),
        })
        .eq("id", job_id);

      console.warn(`Job ${job_id} marked as failed. Status: ${status}`);
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error("Modal webhook error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

