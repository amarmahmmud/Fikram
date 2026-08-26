import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// DELETE /api/jobs/[id] — delete a job owned by the authenticated user
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Fetch the job and verify ownership
  const { data: job, error: fetchErr } = await supabase
    .from("jobs")
    .select("id, user_id, status")
    .eq("id", id)
    .single();

  if (fetchErr || !job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  if (job.user_id !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Block deletion of running or pending jobs
  if (job.status === "running" || job.status === "pending") {
    return NextResponse.json(
      { error: "Cannot remove a job that is currently running or pending. Please wait for it to finish or mark it as failed first." },
      { status: 409 }
    );
  }

  // Delete the job
  const { error: deleteErr } = await supabase
    .from("jobs")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);

  if (deleteErr) {
    console.error("[Jobs API] Delete error:", deleteErr);
    return NextResponse.json({ error: deleteErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
