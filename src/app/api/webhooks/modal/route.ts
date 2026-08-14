import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Webhook endpoint that Modal calls when training completes.
 * Modal's train.py sends a POST with:
 * { job_id, status: "completed", adapter_prefix: "adapters/job-uuid" }
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { job_id, status, adapter_prefix } = body;

    console.log("Modal webhook received:", { job_id, status, adapter_prefix });

    if (!job_id) {
      return NextResponse.json({ error: "Missing job_id" }, { status: 400 });
    }

    const supabase = await createClient();

    if (status === "completed" && adapter_prefix) {
      // Update job: mark as completed, store the R2 prefix as result_url
      const { error } = await supabase
        .from("jobs")
        .update({
          status:       "completed",
          result_url:   adapter_prefix,  // e.g. "adapters/job-uuid"
          completed_at: new Date().toISOString(),
        })
        .eq("id", job_id);

      if (error) {
        console.error("Supabase update error:", error);
        return NextResponse.json({ error: "Failed to update job" }, { status: 500 });
      }

      console.log(`Job ${job_id} marked as completed with adapter at: ${adapter_prefix}`);
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
