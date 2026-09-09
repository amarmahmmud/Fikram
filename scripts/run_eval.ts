/**
 * Standalone evaluation runner — bypasses Next.js API route timeout.
 *
 * Usage: npx tsx --env-file=.env.local scripts/run_eval.ts <job_id>
 *
 * This script:
 * 1. Fetches the job from Supabase
 * 2. Downloads eval pairs from R2
 * 3. For each pair: calls Modal inference → Gemini judge
 * 4. Computes aggregate report → stores in DB
 */

import { createClient } from "@supabase/supabase-js";

import { generateWithModelFallback } from "../src/lib/gemini";

async function generateWithFallback(
  contents: string,
  config: Record<string, unknown> = {}
): Promise<string> {
  const res = await generateWithModelFallback(contents, {
    generationConfig: config,
  });
  return res.text();
}

// ── Judge prompt (same as evaluator.ts) ──

function buildJudgePrompt(
  question: string,
  referenceAnswer: string,
  modelResponse: string
): string {
  return `You are a strict but fair evaluation judge. Your job is to grade a fine-tuned AI model's answer against a verified reference answer from the source training data.

QUESTION ASKED:
"${question}"

REFERENCE ANSWER (ground truth from source document):
"${referenceAnswer}"

MODEL'S ACTUAL RESPONSE:
"${modelResponse}"

GRADING RUBRIC (0-5):
5 = Perfect: All key facts present, no hallucination, well-structured
4 = Good: Most key facts present, minor omissions, no hallucination
3 = Adequate: Core answer correct but missing important details
2 = Poor: Partially correct but significant errors or omissions
1 = Bad: Mostly incorrect or largely hallucinated content
0 = Fail: Completely wrong, refused to answer, or pure hallucination

CRITICAL RULES:
- Penalize hallucinated content NOT in the reference (even if plausible)
- Penalize verbosity that adds unsupported claims
- A shorter correct answer beats a longer partially-hallucinated one
- Quote the specific part of the reference you're grading against

Respond with ONLY a JSON object (no markdown, no explanation outside the JSON):
{"source_quote": "exact quote from reference you graded against", "reasoning": "step-by-step why you gave this score", "score": <0-5>}`;
}

// ── Category inference (same as evaluator.ts) ──

function inferCategory(prompt: string, _completion: string): string {
  const p = prompt.toLowerCase();
  if (p.includes("list") || p.includes("bullet") || p.includes("format") || p.includes("table"))
    return "format_following";
  if (p.includes("compare") || p.includes("contrast") || p.includes("difference") || p.includes("versus") ||
      p.includes("what factors") || p.includes("why is") || p.includes("why are") || p.includes("core reasons"))
    return "contrastive";
  if (p.includes("score") || p.includes("evaluate using") || p.includes("calculate") || p.includes("rubric") || p.includes("apply the"))
    return "application";
  if (p.includes("reflect") || p.includes("evaluate your") || p.includes("confidence") || p.includes("limitation"))
    return "meta_cognitive";
  return "recall";
}

// ── Main ──

interface EvalPair {
  prompt: string;
  completion: string;
  system_prompt?: string;
}

interface JudgeResult {
  prompt: string;
  expectedCompletion: string;
  modelResponse: string;
  sourceQuote: string;
  reasoning: string;
  score: number;
  category: string;
}

async function main() {
  const jobId = process.argv[2];
  const maxPairs = process.argv[3] ? parseInt(process.argv[3], 10) : undefined;
  if (!jobId) {
    console.error("Usage: npx tsx --env-file=.env.local scripts/run_eval.ts <job_id> [max_pairs]");
    process.exit(1);
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Fetch job
  const { data: job, error: jobErr } = await supabase
    .from("jobs")
    .select("*")
    .eq("id", jobId)
    .single();

  if (!job || jobErr) {
    console.error("Job not found:", jobErr?.message);
    process.exit(1);
  }

  console.log(`Job: ${job.name} (${job.id})`);
  console.log(`Status: ${job.status}`);
  console.log(`Base model: ${job.base_model}`);
  console.log(`Adapter: ${job.result_url}`);

  const config = (job.config || {}) as Record<string, unknown>;
  const evalDatasetUrl = config.eval_dataset_url as string;
  if (!evalDatasetUrl) {
    console.error("No eval_dataset_url in job config");
    process.exit(1);
  }

  // Download eval pairs
  console.log("\nDownloading eval pairs...");
  const evalRes = await fetch(evalDatasetUrl);
  if (!evalRes.ok) {
    console.error("Failed to download eval set:", evalRes.status);
    process.exit(1);
  }
  const evalText = await evalRes.text();
  const evalPairs: EvalPair[] = evalText
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));

  const pairsToRun = maxPairs ? evalPairs.slice(0, maxPairs) : evalPairs;
  console.log(`Downloaded ${evalPairs.length} eval pairs, will evaluate ${pairsToRun.length}`);

  // Mark as running
  await supabase
    .from("jobs")
    .update({ config: { ...config, eval_status: "running" } })
    .eq("id", jobId);

  // Build inference function
  const modalInferenceUrl = process.env.MODAL_INFERENCE_URL;
  if (!modalInferenceUrl) {
    console.error("MODAL_INFERENCE_URL not set");
    process.exit(1);
  }

  console.log(`\nInference URL: ${modalInferenceUrl}`);
  console.log("Starting evaluation...\n");

  const getModelResponse = async (
    prompt: string,
    systemPrompt?: string
  ): Promise<string> => {
    let lastErr: any;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const inferRes = await fetch(modalInferenceUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            adapter_prefix: job.result_url,
            base_model: job.base_model,
            messages: [{ role: "user", content: prompt }],
            system_prompt: systemPrompt || "You are a helpful assistant.",
            temperature: 0.1,
            max_new_tokens: 1024,
            r2_endpoint: `https://${process.env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
            r2_access_key: process.env.R2_ACCESS_KEY_ID,
            r2_secret_key: process.env.R2_SECRET_ACCESS_KEY,
            r2_bucket: process.env.R2_BUCKET_NAME,
          }),
        });

        const data = await inferRes.json();
        if (!inferRes.ok || data.status === "failed") {
          throw new Error(data.error || `Inference HTTP ${inferRes.status}`);
        }
        return data.reply || "";
      } catch (err: any) {
        lastErr = err;
        if (attempt < 3) {
          console.warn(`[Inference] Attempt ${attempt} failed (${err.message?.slice(0, 80)}). Retrying in ${attempt * 2000}ms...`);
          await new Promise((r) => setTimeout(r, attempt * 2000));
        }
      }
    }
    throw lastErr;
  };

  // Run evaluation
  const results: JudgeResult[] = [];
  let hadErrors = false;
  const GOOD_SCORE_THRESHOLD = 4.0;

  for (let i = 0; i < pairsToRun.length; i++) {
    const pair = pairsToRun[i];
    try {
      // Step 1: Get model response
      const modelResponse = await getModelResponse(pair.prompt, pair.system_prompt);

      // Step 2: Judge with Gemini
      const judgePrompt = buildJudgePrompt(pair.prompt, pair.completion, modelResponse);
      const rawText = await generateWithFallback(judgePrompt, {
        temperature: 0.0,
        maxOutputTokens: 2048,
        responseMimeType: "application/json",
      });

      // Parse judge response
      let parsed: { source_quote?: string; reasoning?: string; score?: number };
      try {
        const cleaned = rawText.replace(/```json\s*/gi, "").replace(/```\s*/gi, "").trim();
        parsed = JSON.parse(cleaned);
      } catch {
        console.warn(`[Pair ${i + 1}] JSON parse failed, extracting score from text`);
        const scoreMatch = rawText.match(/"score"\s*:\s*(\d)/);
        parsed = {
          source_quote: "Parse error",
          reasoning: rawText.substring(0, 300),
          score: scoreMatch ? parseInt(scoreMatch[1]) : 2,
        };
      }

      const category = inferCategory(pair.prompt, pair.completion);
      const result: JudgeResult = {
        prompt: pair.prompt,
        expectedCompletion: pair.completion,
        modelResponse,
        sourceQuote: parsed.source_quote || "",
        reasoning: parsed.reasoning || "",
        score: Math.min(5, Math.max(0, Math.round(parsed.score ?? 0))),
        category,
      };

      results.push(result);
      console.log(
        `[${i + 1}/${pairsToRun.length}] score=${result.score}/5 cat=${result.category} prompt="${pair.prompt.slice(0, 60)}..."`
      );

      // Rate limit delay (minimized thanks to 7-key rotation)
      if (i < pairsToRun.length - 1) {
        await new Promise((r) => setTimeout(r, 1000));
      }
    } catch (err) {
      console.error(`[${i + 1}/${pairsToRun.length}] FAILED:`, (err as Error).message?.slice(0, 120));
      hadErrors = true;
    }
  }

  // Compute report
  if (results.length === 0) {
    console.error("No results - all pairs failed");
    await supabase
      .from("jobs")
      .update({ config: { ...config, eval_status: "unavailable", eval_error: "All pairs failed" } })
      .eq("id", jobId);
    process.exit(1);
  }

  const overallScore = results.reduce((sum, r) => sum + r.score, 0) / results.length;
  const overallPercentage = Math.round((overallScore / 5) * 100);

  const categoryMap = new Map<string, number[]>();
  for (const r of results) {
    if (!categoryMap.has(r.category)) categoryMap.set(r.category, []);
    categoryMap.get(r.category)!.push(r.score);
  }

  const categoryScores: Record<string, { avg: number; count: number; percentage: number }> = {};
  for (const [cat, scores] of categoryMap.entries()) {
    const avg = scores.reduce((s, v) => s + v, 0) / scores.length;
    categoryScores[cat] = {
      avg: Math.round(avg * 100) / 100,
      count: scores.length,
      percentage: Math.round((avg / 5) * 100),
    };
  }

  const failedResults = results
    .filter((r) => r.score < GOOD_SCORE_THRESHOLD)
    .sort((a, b) => a.score - b.score)
    .slice(0, 3);

  // Guidance
  let guidance = null;
  if (overallScore < GOOD_SCORE_THRESHOLD) {
    if (hadErrors) {
      guidance = {
        summary: "The evaluation encountered some errors, so results may be incomplete.",
        primaryAction: "none",
        actionLabel: "Review partial results",
      };
    } else {
      const recallScore = categoryScores["recall"]?.avg ?? overallScore;
      if (recallScore < 3.5) {
        guidance = {
          summary: "The model has difficulty recalling facts from training data. More training steps may help.",
          primaryAction: "more_steps",
          actionLabel: "Retrain with More Steps",
        };
      } else {
        guidance = {
          summary: "Consider trying a larger base model for better results.",
          primaryAction: "different_model",
          actionLabel: "Try a Different Base Model",
        };
      }
    }
  }

  const evalReport = {
    overallScore: Math.round(overallScore * 100) / 100,
    overallPercentage,
    categoryScores,
    totalEvaluated: results.length,
    failedCount: results.filter((r) => r.score < GOOD_SCORE_THRESHOLD).length,
    failedExamples: failedResults,
    evaluatedAt: new Date().toISOString(),
    hadErrors,
    guidance,
  };

  // Store in DB
  await supabase
    .from("jobs")
    .update({
      config: {
        ...config,
        eval_status: "completed",
        eval_result: JSON.parse(JSON.stringify(evalReport)),
      },
    })
    .eq("id", jobId);

  // Print summary
  console.log("\n" + "=".repeat(60));
  console.log("EVALUATION COMPLETE");
  console.log("=".repeat(60));
  console.log(`Overall Score: ${evalReport.overallScore}/5 (${evalReport.overallPercentage}%)`);
  console.log(`Total Evaluated: ${evalReport.totalEvaluated}`);
  console.log(`Failed (< 4): ${evalReport.failedCount}`);
  console.log(`Had Errors: ${evalReport.hadErrors}`);
  console.log("\nCategory Breakdown:");
  for (const [cat, s] of Object.entries(evalReport.categoryScores)) {
    console.log(`  ${cat}: ${s.avg}/5 (${s.percentage}%) [${s.count} pairs]`);
  }

  if (failedResults.length > 0) {
    console.log("\nWorst Examples:");
    for (const ex of failedResults.slice(0, 2)) {
      console.log(`\n  Score: ${ex.score}/5 | Category: ${ex.category}`);
      console.log(`  Q: "${ex.prompt.slice(0, 100)}"`);
      console.log(`  Expected: "${ex.expectedCompletion.slice(0, 100)}..."`);
      console.log(`  Model said: "${ex.modelResponse.slice(0, 100)}..."`);
      console.log(`  Judge: "${ex.reasoning.slice(0, 150)}..."`);
    }
  }

  console.log("\n" + JSON.stringify(evalReport, null, 2));
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
