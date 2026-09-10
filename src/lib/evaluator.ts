import { generateWithModelFallback } from "@/lib/gemini";

// ─────────────────────────────────────────────
// LLM-as-a-Judge Post-Training Evaluator
// ─────────────────────────────────────────────
// Implements research-backed best practices to reduce judge bias:
//
// 1. CROSS-MODEL JUDGING: Gemini judges a fine-tuned Llama/Qwen/etc model,
//    avoiding self-preference bias (Zheng et al., 2023 — "Judging LLM-as-a-Judge").
//
// 2. CHAIN-OF-THOUGHT GRADING: The judge must output source_quote and reasoning
//    BEFORE the score. This grounds the evaluation in evidence and reduces
//    position/verbosity bias (Liu et al., 2024 — "Calibrating LLM-Based Evaluator").
//
// 3. NARROW 0-5 SCALE: Research shows 0-5 scales achieve the highest inter-annotator
//    agreement between LLM judges and human raters compared to 0-10 or 0-100
//    (Kocmi & Federmann, 2023 — "Large language models are state-of-the-art evaluators").
//
// 4. ANTI-VERBOSITY INSTRUCTION: The rubric explicitly penalizes hallucinated extra
//    content, countering the known LLM tendency to reward longer answers.
// ─────────────────────────────────────────────

/** A single held-out evaluation pair from the dataset pipeline */
export interface EvalPair {
  prompt: string;
  completion: string;
  system_prompt?: string;
}

/** The structured judge output for a single eval pair */
export interface JudgeResult {
  /** The question that was asked */
  prompt: string;
  /** The ground-truth answer from training data */
  expectedCompletion: string;
  /** The fine-tuned model's actual answer */
  modelResponse: string;
  /** Exact text from the reference completion the judge graded against */
  sourceQuote: string;
  /** Step-by-step reasoning explaining the score */
  reasoning: string;
  /** 0-5 score */
  score: number;
  /** Category of the eval pair for breakdown reporting */
  category: "recall" | "application" | "format_following" | "meta_cognitive" | "contrastive" | "boundary" | "unknown";
}

/** Aggregate evaluation report stored in the job config */
export interface EvalReport {
  /** Overall average score (0-5) */
  overallScore: number;
  /** Overall percentage (0-100) */
  overallPercentage: number;
  /** Per-category average scores */
  categoryScores: Record<string, { avg: number; count: number; percentage: number }>;
  /** Total number of eval pairs assessed */
  totalEvaluated: number;
  /** Number of pairs that failed (scored below the threshold) */
  failedCount: number;
  /** 2-3 worst-performing examples with full judge reasoning (for transparency) */
  failedExamples: JudgeResult[];
  /** Timestamp when evaluation completed */
  evaluatedAt: string;
  /** Whether the eval encountered any errors (partial results) */
  hadErrors: boolean;
  /** Diagnostic guidance for the user */
  guidance: EvalGuidance | null;
}

export interface EvalGuidance {
  /** Plain-language summary of what might be wrong */
  summary: string;
  /** The primary recommended action */
  primaryAction: "add_data" | "more_steps" | "different_model" | "none";
  /** Human-readable description of the action */
  actionLabel: string;
}

// Heuristic: tune this threshold once real user data exists
const GOOD_SCORE_THRESHOLD = 4.0;

/**
 * Build the LLM judge prompt for a single evaluation.
 * Forces chain-of-thought (quote + reasoning) BEFORE the score.
 */
function buildJudgePrompt(
  question: string,
  referenceAnswer: string,
  modelResponse: string,
): string {
  return `You are a strict but fair evaluation judge. Your job is to grade a fine-tuned AI model's answer against a verified reference answer from the source training data.

QUESTION ASKED:
"${question}"

REFERENCE ANSWER (ground truth from source document):
"${referenceAnswer}"

MODEL'S ACTUAL RESPONSE:
"${modelResponse}"

EVALUATION RUBRIC (score 0-5):
  5 = Perfect: All key facts match the reference, numbers/comparisons correctly linked, zero hallucination
  4 = Strong: Minor omissions but all stated facts are correct, no fabrication
  3 = Adequate: Core fact is present but missing important supporting details or context
  2 = Weak: Some relevant information but significant factual gaps or minor inaccuracies
  1 = Poor: Mostly incorrect, major facts wrong or missing, OR contains fabricated information not in source
  0 = Failed: Completely wrong, refuses to answer, or pure hallucination

CRITICAL ANTI-BIAS RULES:
- Do NOT reward verbosity. A shorter answer that is factually correct scores HIGHER than a longer answer that adds unsupported claims.
- Penalize hallucination harshly: any specific claim (name, number, date, statistic) not present in or derivable from the reference answer is a fabrication.
- Grade ONLY factual accuracy against the reference — do not reward or penalize stylistic differences.

You MUST respond with valid JSON in exactly this format:
{
  "source_quote": "<exact key phrase from the REFERENCE ANSWER you are primarily grading against>",
  "reasoning": "<2-3 sentences explaining your assessment step-by-step: what matched, what was missing, what was fabricated>",
  "score": <integer 0-5>
}

Output ONLY the JSON object. No markdown, no explanation outside the JSON.`;
}

/**
 * Infer the category of an eval pair based on its prompt content.
 * Maps to the pass_type categories from the dataset pipeline.
 */
function inferCategory(prompt: string, completion: string | string[]): JudgeResult["category"] {
  const p = prompt.toLowerCase();
  const c = typeof completion === "string" ? completion.toLowerCase() : "";

  // Format-following: look for format-related keywords in the prompt
  if (p.includes("bullet") || p.includes("table") || p.includes("markdown") ||
      p.includes("list") || p.includes("short answer") || p.includes("one to two sentences") ||
      p.includes("numbered list")) {
    return "format_following";
  }

  // Contrastive / reasoning: compare, contrast, difference, vs, what factors, why
  if (p.includes("compare") || p.includes("contrast") || p.includes("difference between") ||
      p.includes(" vs ") || p.includes("versus") || p.includes("what factors") ||
      p.includes("why is") || p.includes("why are") || p.includes("core reasons")) {
    return "contrastive";
  }

  // Application/scoring: look for explicit rubric/scoring application keywords
  if (p.includes("score") || p.includes("evaluate using") || p.includes("calculate") ||
      p.includes("apply the") || p.includes("using the rubric") || p.includes("rubric")) {
    return "application";
  }

  // Meta-cognitive: confidence, limitations, time-sensitivity
  if (p.includes("confident") || p.includes("limitation") || p.includes("time-sensitive") ||
      p.includes("outdated") || p.includes("scope") || p.includes("methodology") ||
      p.includes("how reliable") || p.includes("what can't you")) {
    return "meta_cognitive";
  }

  // Boundary: what you don't know, outside scope
  if (p.includes("don't have") || p.includes("outside") || p.includes("cannot answer") ||
      c.includes("i don't have") || c.includes("outside my") || c.includes("falls outside")) {
    return "boundary";
  }

  // Default: factual recall
  return "recall";
}

/**
 * Judge a single eval pair by calling the fine-tuned model for inference,
 * then scoring the response with Gemini as the judge.
 */
export async function judgeOnePair(
  pair: EvalPair,
  getModelResponse: (prompt: string, systemPrompt?: string) => Promise<string>,
): Promise<JudgeResult> {
  // Step 1: Get the fine-tuned model's response
  const modelResponse = await getModelResponse(pair.prompt, pair.system_prompt);

  // Step 2: Have Gemini judge the response against the reference
  const judgePrompt = buildJudgePrompt(pair.prompt, pair.completion, modelResponse);

  const result = await generateWithModelFallback(judgePrompt, {
    generationConfig: {
      temperature: 0.0, // Deterministic for consistent grading
      maxOutputTokens: 2048,
      responseMimeType: "application/json",
    },
  });

  const rawText = result.response.text();

  // Parse the JSON response from the judge
  let parsed: { source_quote?: string; reasoning?: string; score?: number };
  try {
    // Strip markdown code fences if present
    const cleaned = rawText.replace(/```json\s*/gi, "").replace(/```\s*/gi, "").trim();
    parsed = JSON.parse(cleaned);
  } catch {
    // If JSON parsing fails, try to extract score from text
    console.warn("[Evaluator] Failed to parse judge response as JSON:", rawText.substring(0, 200));
    const scoreMatch = rawText.match(/"score"\s*:\s*(\d)/);
    parsed = {
      source_quote: "Parse error — see reasoning",
      reasoning: rawText.substring(0, 300),
      score: scoreMatch ? parseInt(scoreMatch[1]) : 2,
    };
  }

  const category = inferCategory(pair.prompt, pair.completion);

  return {
    prompt: pair.prompt,
    expectedCompletion: pair.completion,
    modelResponse,
    sourceQuote: parsed.source_quote || "",
    reasoning: parsed.reasoning || "",
    score: Math.min(5, Math.max(0, Math.round(parsed.score ?? 0))),
    category,
  };
}

/**
 * Run the full evaluation suite against all held-out pairs.
 * Returns an EvalReport with aggregate scores and failed examples.
 */
export async function runEvaluation(
  evalPairs: EvalPair[],
  getModelResponse: (prompt: string, systemPrompt?: string) => Promise<string>,
  jobConfig: Record<string, unknown>,
): Promise<EvalReport> {
  const results: JudgeResult[] = [];
  let hadErrors = false;

  // Process in parallel batches of 4 to leverage 7-key rotation while staying under limits
  const CONCURRENCY = 4;
  for (let i = 0; i < evalPairs.length; i += CONCURRENCY) {
    const batch = evalPairs.slice(i, i + CONCURRENCY);
    const batchPromises = batch.map(async (pair, batchIdx) => {
      try {
        const result = await judgeOnePair(pair, getModelResponse);
        console.log(`[Evaluator] Pair ${i + batchIdx + 1}/${evalPairs.length}: score=${result.score}/5 category=${result.category}`);
        return result;
      } catch (err) {
        console.error(`[Evaluator] Failed to evaluate pair ${i + batchIdx + 1}:`, err);
        hadErrors = true;
        return null;
      }
    });

    const batchResults = await Promise.all(batchPromises);
    for (const res of batchResults) {
      if (res) results.push(res);
    }
  }

  if (results.length === 0) {
    return {
      overallScore: 0,
      overallPercentage: 0,
      categoryScores: {},
      totalEvaluated: 0,
      failedCount: 0,
      failedExamples: [],
      evaluatedAt: new Date().toISOString(),
      hadErrors: true,
      guidance: null,
    };
  }

  // Compute aggregate scores
  const overallScore = results.reduce((sum, r) => sum + r.score, 0) / results.length;
  const overallPercentage = Math.round((overallScore / 5) * 100);

  // Per-category breakdown
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

  // Find failed examples — sorted by score ascending, take worst 3
  const failedResults = results
    .filter(r => r.score < GOOD_SCORE_THRESHOLD)
    .sort((a, b) => a.score - b.score)
    .slice(0, 3);

  // Compute diagnostic guidance
  const guidance = computeGuidance(overallScore, categoryScores, jobConfig, hadErrors);

  return {
    overallScore: Math.round(overallScore * 100) / 100,
    overallPercentage,
    categoryScores,
    totalEvaluated: results.length,
    failedCount: results.filter(r => r.score < GOOD_SCORE_THRESHOLD).length,
    failedExamples: failedResults,
    evaluatedAt: new Date().toISOString(),
    hadErrors,
    guidance,
  };
}

/**
 * Compute diagnostic guidance based on the evaluation results and job history.
 * Follows the priority order specified in the plan:
 *   1. Document flagged thin → suggest adding more source content
 *   2. Facts in training data but model fails recall → suggest more steps/epochs
 *   3. Neither → suggest trying a larger/different base model
 */
function computeGuidance(
  overallScore: number,
  categoryScores: Record<string, { avg: number; count: number; percentage: number }>,
  jobConfig: Record<string, unknown>,
  hadErrors: boolean,
): EvalGuidance | null {
  // Score is good — no guidance needed
  if (overallScore >= GOOD_SCORE_THRESHOLD) {
    return null;
  }

  // If eval had errors, be cautious about diagnosis
  if (hadErrors) {
    return {
      summary: "The evaluation encountered some errors, so results may be incomplete. The scores shown are based on the pairs that were successfully evaluated.",
      primaryAction: "none",
      actionLabel: "Review partial results",
    };
  }

  const documentFlaggedThin = jobConfig.document_flagged_thin === true;
  const recallScore = categoryScores["recall"]?.avg ?? overallScore;

  // Priority 1: Document was flagged thin during generation
  if (documentFlaggedThin) {
    return {
      summary: "Your source document was flagged as relatively thin during dataset generation. The model may not have had enough diverse examples to learn from effectively. Adding more source content (additional documents, articles, or data) would give the model more material to learn from.",
      primaryAction: "add_data",
      actionLabel: "Add More Source Material & Retrain",
    };
  }

  // Priority 2: Recall specifically is weak (facts were in training data but model didn't absorb them)
  if (recallScore < 3.5) {
    return {
      summary: "The model appears to have difficulty recalling specific facts that were present in its training data. This often indicates the model needs more training steps or epochs to fully absorb the material. A retrain with an additional epoch may help.",
      primaryAction: "more_steps",
      actionLabel: "Retrain with More Steps",
    };
  }

  // Priority 3: Neither of the above — may need a more capable base model
  return {
    summary: "The model's scores suggest it may struggle with the complexity of the material. You might see improvement by trying a larger base model (e.g., a bigger parameter count in the same family) or an alternative model family. This is a suggestion to experiment with, not a certainty.",
    primaryAction: "different_model",
    actionLabel: "Try a Different Base Model",
  };
}
