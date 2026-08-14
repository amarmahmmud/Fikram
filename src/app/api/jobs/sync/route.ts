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

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const jobId = searchParams.get("id");

    if (!jobId) {
      return NextResponse.json({ error: "Missing job id" }, { status: 400 });
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { data: job } = await supabase
      .from("jobs")
      .select("*")
      .eq("id", jobId)
      .eq("user_id", user.id)
      .single();

    if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

    // If job is already completed, return as is
    if (job.status === "completed") {
      return NextResponse.json({ ok: true, job });
    }

    // Check Cloudflare R2 for the completed adapter
    const adapterPrefix = `adapters/${jobId}`;
    const headCommand = new HeadObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: `${adapterPrefix}/adapter_model.safetensors`,
    });

    try {
      await s3.send(headCommand);
      // If headCommand succeeds, adapter_model.safetensors exists!
      console.log(`[Sync] Found adapter in R2 for job ${jobId}. Updating to completed!`);

      const { data: updatedJob, error: updateError } = await supabase
        .from("jobs")
        .update({
          status: "completed",
          result_url: adapterPrefix,
          completed_at: new Date().toISOString(),
        })
        .eq("id", jobId)
        .select()
        .single();

      if (updateError) {
        console.error("Failed to update synced job in Supabase:", updateError);
        return NextResponse.json({ ok: true, job });
      }

      return NextResponse.json({ ok: true, job: updatedJob });
    } catch {
      // Object not yet in R2 -> still running
      return NextResponse.json({ ok: true, job });
    }
  } catch (err: any) {
    console.error("Job sync error:", err);
    return NextResponse.json({ error: err.message || "Failed to sync" }, { status: 500 });
  }
}
