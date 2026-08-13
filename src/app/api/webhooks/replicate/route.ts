import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(req: Request) {
  const { searchParams } = new URL(req.url);
  const jobId = searchParams.get("job_id");
  if (!jobId) return NextResponse.json({ error: "No job_id" }, { status: 400 });

  const supabase = await createClient();
  const body = await req.json();

  const { status, output, logs, error } = body;

  if (status === "succeeded") {
    await supabase.from("jobs").update({
      status:       "completed",
      result_url:   output?.[0] ?? null,
      completed_at: new Date().toISOString(),
      logs:         logs ?? "",
    }).eq("id", jobId);
  } else if (status === "failed") {
    await supabase.from("jobs").update({
      status:       "failed",
      completed_at: new Date().toISOString(),
      logs:         error ?? "Job failed",
    }).eq("id", jobId);
  } else if (status === "processing" && logs) {
    // Append log lines
    const { data: job } = await supabase.from("jobs").select("logs").eq("id", jobId).single();
    await supabase.from("jobs").update({ logs: (job?.logs ?? "") + "\n" + logs }).eq("id", jobId);
  }

  return NextResponse.json({ ok: true });
}
