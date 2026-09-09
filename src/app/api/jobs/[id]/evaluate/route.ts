import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { runEvaluation, type EvalPair, type EvalReport } from "@/lib/evaluator";

/**
 * POST /api/jobs/[id]/evaluate
 *
 * Triggers the LLM-as-a-Judge evaluation for a completed training job.
 * Called automatically by the Modal webhook after training completes.
 *
 * Flow:
 * 1. Fetch the job and its eval_dataset_url from config
 * 2. Download the held-out eval pairs from R2
 * 3. For each pair, call the fine-tuned model via inference, then judge with Gemini
 * 4. Compute aggregate report and store in job.config.eval_result
 *
 * If this endpoint fails, the job status remains "completed" — evaluation is
 * non-blocking. The job page will show "Completed — evaluation unavailable".
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

    // Check if already evaluated
    if (config.eval_result) {
      return NextResponse.json({ ok: true, message: "Already evaluated", eval_result: config.eval_result });
    }

    const evalDatasetUrl = config.eval_dataset_url as string | undefined;
    if (!evalDatasetUrl) {
      // Mark as evaluation unavailable (no eval set was generated)
      await supabase.from("jobs").update({
        config: { ...config, eval_status: "unavailable", eval_error: "No evaluation dataset was generated for this job." },
      }).eq("id", jobId);

      return NextResponse.json({ ok: false, error: "No eval dataset URL found" }, { status: 400 });
    }

    // Mark evaluation as in-progress
    await supabase.from("jobs").update({
      config: { ...config, eval_status: "running" },
    }).eq("id", jobId);

    // Download the eval pairs from R2
    let evalPairs: EvalPair[];
    try {
      const evalRes = await fetch(evalDatasetUrl);
      if (!evalRes.ok) throw new Error(`Failed to download eval set: ${evalRes.status}`);
      const evalText = await evalRes.text();
      evalPairs = evalText.trim().split("\n").filter(Boolean).map(line => JSON.parse(line));
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      await supabase.from("jobs").update({
        config: { ...config, eval_status: "unavailable", eval_error: errMsg },
      }).eq("id", jobId);
      return NextResponse.json({ ok: false, error: errMsg }, { status: 500 });
    }

    console.log(`[Evaluate] Starting evaluation for job ${jobId} with ${evalPairs.length} held-out pairs`);

    // Build the inference function that calls our fine-tuned model
    // [TESTING] Intentionally broken URL to test fallback behavior
    const modalInferenceUrl = "https://this-url-definitely-does-not-exist.modal.run";
    if (!modalInferenceUrl) {
      await supabase.from("jobs").update({
        config: { ...config, eval_status: "unavailable", eval_error: "Inference endpoint not configured" },
      }).eq("id", jobId);
      return NextResponse.json({ ok: false, error: "Inference endpoint not configured" }, { status: 500 });
    }

    const getModelResponse = async (prompt: string, systemPrompt?: string): Promise<string> => {
      const inferRes = await fetch(modalInferenceUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          adapter_prefix: job.result_url,
          base_model: job.base_model,
          messages: [{ role: "user", content: prompt }],
          system_prompt: systemPrompt || "You are a helpful assistant.",
          temperature: 0.1, // Low temperature for deterministic evaluation
          max_new_tokens: 1024,
          r2_endpoint: `https://${process.env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
          r2_access_key: process.env.R2_ACCESS_KEY_ID,
          r2_secret_key: process.env.R2_SECRET_ACCESS_KEY,
          r2_bucket: process.env.R2_BUCKET_NAME,
        }),
      });

      const data = await inferRes.json();
      if (!inferRes.ok || data.status === "failed") {
        throw new Error(data.error || "Inference failed");
      }
      return data.reply || "";
    };

    // Run the evaluation
    let evalReport: EvalReport;
    try {
      evalReport = await runEvaluation(evalPairs, getModelResponse, config);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`[Evaluate] Evaluation failed for job ${jobId}:`, errMsg);
      await supabase.from("jobs").update({
        config: { ...config, eval_status: "unavailable", eval_error: errMsg },
      }).eq("id", jobId);
      return NextResponse.json({ ok: false, error: errMsg }, { status: 500 });
    }

    // Store the evaluation result in the job config
    await supabase.from("jobs").update({
      config: {
        ...config,
        eval_status: "completed",
        eval_result: JSON.parse(JSON.stringify(evalReport)),
      },
    }).eq("id", jobId);

    console.log(`[Evaluate] Job ${jobId} evaluation complete: ${evalReport.overallPercentage}% (${evalReport.overallScore}/5)`);

    return NextResponse.json({ ok: true, eval_result: evalReport });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[Evaluate] Unexpected error for job ${jobId}:`, errMsg);
    return NextResponse.json({ ok: false, error: errMsg }, { status: 500 });
  }
}
