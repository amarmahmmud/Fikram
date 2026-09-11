import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ASREvalReport } from "@/lib/evaluator";

/**
 * POST /api/jobs/[id]/evaluate
 *
 * Returns or checks the phonetic ASR evaluation report for a completed job.
 * Evaluation is computed natively by Modal during the GPU training run
 * and persisted directly to job.config.eval_result.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: jobId } = await params;

  try {
    const supabase = createAdminClient();

    // Fetch the job
    const { data: job } = await supabase
      .from("jobs")
      .select("*")
      .eq("id", jobId)
      .single();

    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    if (job.status !== "completed") {
      return NextResponse.json({ error: "Job is not completed yet" }, { status: 400 });
    }

    const config = (job.config && typeof job.config === "object" && !Array.isArray(job.config))
      ? job.config as Record<string, unknown>
      : {};

    // If already evaluated (standard path via Modal webhook)
    if (config.eval_result) {
      return NextResponse.json({
        ok: true,
        message: "Evaluation already completed",
        eval_result: config.eval_result as ASREvalReport,
      });
    }

    // If eval_status is already set
    if (config.eval_status === "unavailable") {
      return NextResponse.json({
        ok: false,
        error: (config.eval_error as string) || "Evaluation unavailable",
      }, { status: 400 });
    }

    return NextResponse.json({
      ok: true,
      message: "Evaluation is pending or was not included in training payload",
      eval_status: config.eval_status || "pending",
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[Evaluate] Error for job ${jobId}:`, errMsg);
    return NextResponse.json({ ok: false, error: errMsg }, { status: 500 });
  }
}
