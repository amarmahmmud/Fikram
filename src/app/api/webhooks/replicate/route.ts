import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(req: Request) {
  try {
    // We appended job_id in the webhook URL
    const url = new URL(req.url);
    const jobId = url.searchParams.get("job_id");
    
    if (!jobId) {
      return NextResponse.json({ error: "Missing job_id in query" }, { status: 400 });
    }

    const payload = await req.json();
    const supabase = await createClient();

    let newStatus: "pending" | "running" | "completed" | "failed" | "cancelled" = "running";
    if (payload.status === "succeeded") newStatus = "completed";
    else if (payload.status === "failed" || payload.status === "canceled") newStatus = "failed";

    let resultUrl = null;
    if (payload.status === "succeeded") {
      // payload.model looks like "username/job-uuid"
      // payload.version is the specific deployment hash
      const modelName = payload.model; 
      const version = payload.version || payload.output?.version;
      
      // Store the exact model string required by replicate.predictions.create
      resultUrl = version ? `${modelName}:${version}` : modelName;
    }

    // Update job status in database
    await supabase
      .from("jobs")
      .update({
        status: newStatus,
        logs: payload.logs || "",
        ...(resultUrl ? { result_url: resultUrl } : {}),
        ...(newStatus === "completed" || newStatus === "failed" ? { completed_at: new Date().toISOString() } : {})
      })
      .eq("id", jobId);

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error("Webhook error:", err);
    return NextResponse.json({ error: "Failed to process webhook" }, { status: 500 });
  }
}
