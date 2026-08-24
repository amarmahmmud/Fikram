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

// Maximum allowed time for a fine-tuning job before declaring it failed (20 minutes)
const MAX_JOB_DURATION_MS = 20 * 60 * 1000;

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

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const jobId = searchParams.get("id");

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    if (!jobId) {
      // Sync all user's running / pending jobs
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
        const hasAdapter = await checkJobR2(j.id);
        const startTime = new Date(j.started_at || j.created_at).getTime();
        const isStale = Date.now() - startTime > MAX_JOB_DURATION_MS;

        if (hasAdapter) {
          await supabase
            .from("jobs")
            .update({
              status: "completed",
              result_url: `adapters/${j.id}`,
              completed_at: new Date().toISOString(),
              finished_at: new Date().toISOString(),
            })
            .eq("id", j.id);
          updatedCount++;
        } else if (isStale) {
          // Honest status: GPU job stopped or failed to produce an adapter within 20 minutes
          await supabase
            .from("jobs")
            .update({
              status: "failed",
              completed_at: new Date().toISOString(),
              finished_at: new Date().toISOString(),
              logs: (j.logs || "") + "\n[System] Training execution failed or timed out without adapter.",
            })
            .eq("id", j.id);
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

    // If job is already in a final state, return as is
    if (job.status === "completed" || job.status === "failed" || job.status === "cancelled") {
      return NextResponse.json({ ok: true, job });
    }

    // Check Cloudflare R2 for the completed adapter
    const hasAdapter = await checkJobR2(jobId);

    if (hasAdapter) {
      console.log(`[Sync] Found adapter in R2 for job ${jobId}. Updating to completed.`);
      const { data: updatedJob } = await supabase
        .from("jobs")
        .update({
          status: "completed",
          result_url: `adapters/${jobId}`,
          completed_at: new Date().toISOString(),
          finished_at: new Date().toISOString(),
        })
        .eq("id", jobId)
        .select()
        .single();

      return NextResponse.json({ ok: true, job: updatedJob || job });
    }

    // Check if the job has been running too long without producing an adapter
    const startTime = new Date(job.started_at || job.created_at).getTime();
    const elapsedMs = Date.now() - startTime;

    if (elapsedMs > MAX_JOB_DURATION_MS) {
      console.warn(`[Sync] Job ${jobId} exceeded ${MAX_JOB_DURATION_MS / 60000}m without adapter. Marking as failed.`);
      const { data: failedJob } = await supabase
        .from("jobs")
        .update({
          status: "failed",
          completed_at: new Date().toISOString(),
          finished_at: new Date().toISOString(),
          logs: (job.logs || "") + "\n[System] Job failed: GPU worker did not complete within the maximum allowed time.",
        })
        .eq("id", jobId)
        .select()
        .single();

      return NextResponse.json({ ok: true, job: failedJob || job });
    }

    return NextResponse.json({ ok: true, job });
  } catch (err: any) {
    console.error("Job sync error:", err);
    return NextResponse.json({ error: err.message || "Failed to sync" }, { status: 500 });
  }
}

// POST endpoint to manually fail, cancel, or force-sync a job
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { jobId, action } = body;

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    if (!jobId) {
      return NextResponse.json({ error: "Missing jobId" }, { status: 400 });
    }

    const { data: job } = await supabase
      .from("jobs")
      .select("*")
      .eq("id", jobId)
      .eq("user_id", user.id)
      .single();

    if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

    const newStatus = action === "cancel" ? "cancelled" : "failed";
    const { data: updatedJob, error } = await supabase
      .from("jobs")
      .update({
        status: newStatus,
        completed_at: new Date().toISOString(),
        finished_at: new Date().toISOString(),
        logs: (job.logs || "") + `\n[System] Job marked as ${newStatus} by user.`,
      })
      .eq("id", jobId)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, job: updatedJob });
  } catch (err: any) {
    console.error("Manual job update error:", err);
    return NextResponse.json({ error: err.message || "Failed to update job" }, { status: 500 });
  }
}
