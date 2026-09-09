import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { S3Client, HeadObjectCommand } from "@aws-sdk/client-s3";

const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || "",
  },
});

async function checkJobR2(jobId: string): Promise<boolean> {
  const adapterPrefix = `adapters/${jobId}`;
  const headCommand = new HeadObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME,
    Key: `${adapterPrefix}/adapter_model.safetensors`,
  });

  try {
    await s3.send(headCommand);
    return true;
  } catch {
    return false;
  }
}

async function checkModalStatus(replicateId: string): Promise<{ status: string; result?: any; error?: string } | null> {
  try {
    const checkUrl = process.env.MODAL_TRAIN_URL
      ? process.env.MODAL_TRAIN_URL.replace("-start-training", "-check-job-status")
      : "https://amarsuadbusiness--model-factory-trainer-check-job-status.modal.run";
    
    const url = new URL(checkUrl);
    url.searchParams.set("call_id", replicateId);
    
    const res = await fetch(url.toString(), { method: "GET" });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    return null;
  }
}

// Syncs a single job, returns true if updated
async function syncJobRecord(j: any, supabase: any): Promise<boolean> {
  if (j.status === "completed" || j.status === "failed" || j.status === "cancelled") {
    return false;
  }

  const hasAdapter = await checkJobR2(j.id);
  const startTime = new Date(j.started_at || j.created_at).getTime();
  
  // Dynamic timeout based on estimated training seconds + 3x multiplier
  const estSecs = (j.config as any)?.estimated_training_seconds;
  const maxDurationMs = estSecs ? (estSecs * 3 * 1000) : (20 * 60 * 1000);
  // Ensure at least 20 minutes
  const isStale = Date.now() - startTime > Math.max(maxDurationMs, 20 * 60 * 1000);

  if (hasAdapter) {
    await supabase.from("jobs").update({
      status: "completed",
      result_url: `adapters/${j.id}`,
      completed_at: new Date().toISOString(),
      finished_at: new Date().toISOString(),
    }).eq("id", j.id);

    // Trigger eval async since webhook might have been missed
    fetch(`${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/api/jobs/${j.id}/evaluate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ trigger: "sync_has_adapter" })
    }).catch(() => {});

    return true;
  } else if (isStale) {
    let finalStatus = "failed";
    let logsAppend = "\n[System] Training execution failed or timed out without adapter.";
    
    // Check Modal directly before failing
    if (j.replicate_id) {
      const modalCheck = await checkModalStatus(j.replicate_id);
      if (modalCheck?.status === "completed") {
        finalStatus = "completed";
        // Trigger eval async since webhook might have been missed
        fetch(`${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/api/jobs/${j.id}/evaluate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ trigger: "sync_fallback" })
        }).catch(() => {});
      } else if (modalCheck?.status === "running") {
        // Modal is still actually running, so don't fail it yet!
        return false;
      } else if (modalCheck?.status === "failed" || modalCheck?.status === "error") {
        logsAppend = `\n[System] Modal execution failed: ${modalCheck.error || "Unknown error"}`;
      }
    }

    if (finalStatus === "completed") {
      await supabase.from("jobs").update({
        status: "completed",
        result_url: `adapters/${j.id}`,
        completed_at: new Date().toISOString(),
        finished_at: new Date().toISOString(),
      }).eq("id", j.id);
    } else {
      await supabase.from("jobs").update({
        status: "failed",
        completed_at: new Date().toISOString(),
        finished_at: new Date().toISOString(),
        logs: (j.logs || "") + logsAppend,
      }).eq("id", j.id);
    }
    return true;
  }
  return false;
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const jobId = searchParams.get("id");

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    if (!jobId) {
      const { data: activeJobs } = await supabase
        .from("jobs")
        .select("*")
        .eq("user_id", user.id)
        .in("status", ["running", "pending"]);

      if (!activeJobs || activeJobs.length === 0) {
        return NextResponse.json({ ok: true, synced: 0 });
      }

      let updatedCount = 0;
      for (const j of activeJobs) {
        if (await syncJobRecord(j, supabase)) {
          updatedCount++;
        }
      }
      return NextResponse.json({ ok: true, synced: updatedCount });
    }

    const { data: job } = await supabase
      .from("jobs")
      .select("*")
      .eq("id", jobId)
      .eq("user_id", user.id)
      .single();

    if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

    const wasUpdated = await syncJobRecord(job, supabase);
    
    // Fetch fresh job if it was updated
    const { data: freshJob } = await supabase.from("jobs").select("*").eq("id", jobId).single();
    return NextResponse.json({ ok: true, job: freshJob || job });
  } catch (err: any) {
    console.error("Job sync error:", err);
    return NextResponse.json({ error: err.message || "Failed to sync" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const { action, jobId } = await req.json();
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!jobId) return NextResponse.json({ error: "Job ID required" }, { status: 400 });

    const { data: job } = await supabase.from("jobs").select("*").eq("id", jobId).eq("user_id", user.id).single();
    if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

    if (action === "force_fail") {
      const { data: updated } = await supabase.from("jobs").update({
        status: "failed",
        completed_at: new Date().toISOString(),
        finished_at: new Date().toISOString(),
        logs: (job.logs || "") + "\n[System] Job forcefully failed by user.",
      }).eq("id", jobId).select().single();
      return NextResponse.json({ ok: true, job: updated });
    } else if (action === "cancel") {
      const { data: updated } = await supabase.from("jobs").update({
        status: "cancelled",
        completed_at: new Date().toISOString(),
        finished_at: new Date().toISOString(),
        logs: (job.logs || "") + "\n[System] Job cancelled by user.",
      }).eq("id", jobId).select().single();
      return NextResponse.json({ ok: true, job: updated });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
