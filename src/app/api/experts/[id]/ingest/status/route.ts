import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/experts/{id}/ingest/status
 * 
 * Lightweight polling endpoint that returns the current status of all
 * ingest jobs for a given expert. The frontend polls this every 2-3 seconds
 * during file ingestion to show real-time per-file progress.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: expertId } = await params;
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    // Fetch all ingest jobs for this expert, ordered by creation time
    const { data: jobs, error } = await supabase
      .from("ingest_jobs")
      .select("id, filename, status, chunks_stored, error, retry_count, provider, created_at, updated_at")
      .eq("expert_id", expertId)
      .eq("user_id", user.id)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("[Ingest Status] Query error:", error);
      return NextResponse.json({ error: "Failed to fetch ingest status" }, { status: 500 });
    }

    // Compute summary
    const total = jobs?.length || 0;
    const completed = jobs?.filter((j) => j.status === "completed").length || 0;
    const failed = jobs?.filter((j) => j.status === "failed").length || 0;
    const processing = jobs?.filter((j) => j.status === "processing").length || 0;
    const allDone = total > 0 && processing === 0;

    return NextResponse.json({
      ok: true,
      jobs: jobs || [],
      summary: { total, completed, failed, processing, allDone },
    });
  } catch (err: any) {
    console.error("[Ingest Status] Error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
