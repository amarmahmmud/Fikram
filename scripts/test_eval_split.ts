import { readFileSync, writeFileSync } from "fs";
import { generateDataset } from "@/lib/dataset-pipeline";
import { WizardContext } from "@/lib/wizard-types";
import path from "path";

/**
 * Live verification of the eval split pipeline.
 * Tests:
 *   1. 15% eval split actually produces real counts
 *   2. Eval pairs genuinely never appear in the training JSONL
 *   3. Both sets have correct system_prompt injection
 */
async function main() {
  const docPath = "C:\\Users\\asus\\Downloads\\AI_Job_Replacement_Intelligence_Report_2024-2030.md";
  const text = readFileSync(docPath, "utf-8");
  console.log(`[Test] Document loaded: ${text.length} chars\n`);

  const ctx: WizardContext = {
    goal: "Answer questions about AI job replacement trends and risk assessments from 2024-2030",
    persona: "",
    audience: "",
    style: "",
    format: "",
    boundaries: "",
    goldExamples: [],
    documentSummary: "",
  };

  console.log("[Test] Starting pipeline...\n");

  const result = await generateDataset(
    text,
    ctx.goal,
    (progress) => {
      console.log(`  [${progress.stage}] ${progress.message}`);
    },
    ctx
  );

  const { trainPairs, evalPairs, jsonl, evalJsonl, stats } = result;

  console.log("\n========================================");
  console.log("TEST 1: EVAL SPLIT VERIFICATION");
  console.log("========================================\n");

  console.log(`Total pairs (all):    ${stats.finalTotal}`);
  console.log(`Train pairs:          ${trainPairs.length} (stats: ${stats.trainPairsCount})`);
  console.log(`Eval pairs:           ${evalPairs.length} (stats: ${stats.evalPairsCount})`);
  console.log(`Split ratio:          ${(evalPairs.length / stats.finalTotal * 100).toFixed(1)}%`);
  console.log(`Train + Eval = Total: ${trainPairs.length + evalPairs.length} === ${stats.finalTotal} ? ${trainPairs.length + evalPairs.length === stats.finalTotal ? "✅ PASS" : "❌ FAIL"}`);

  // Verify JSONL line counts match pair counts
  const trainJsonlLines = jsonl.trim().split("\n").filter(Boolean).length;
  const evalJsonlLines = evalJsonl.trim().split("\n").filter(Boolean).length;
  console.log(`\nTraining JSONL lines:  ${trainJsonlLines} === ${trainPairs.length} ? ${trainJsonlLines === trainPairs.length ? "✅ PASS" : "❌ FAIL"}`);
  console.log(`Eval JSONL lines:     ${evalJsonlLines} === ${evalPairs.length} ? ${evalJsonlLines === evalPairs.length ? "✅ PASS" : "❌ FAIL"}`);

  // Verify stratification — eval set should contain multiple pass_types
  const evalPassTypes = new Map<string, number>();
  for (const p of evalPairs) {
    const pt = p._meta?.pass_type ?? "unknown";
    evalPassTypes.set(pt, (evalPassTypes.get(pt) ?? 0) + 1);
  }
  console.log(`\nEval set pass_type breakdown:`);
  for (const [k, v] of evalPassTypes) {
    console.log(`  ${k}: ${v}`);
  }
  console.log(`Stratified (multiple types)? ${evalPassTypes.size > 1 ? "✅ PASS" : "❌ FAIL"}`);

  console.log("\n========================================");
  console.log("TEST 2: NO-OVERLAP GUARANTEE");
  console.log("========================================\n");

  // Build a set of all training prompts
  const trainPromptSet = new Set(trainPairs.map(p => p.prompt));

  // Check each eval pair's prompt against the training set
  let overlapCount = 0;
  for (const ep of evalPairs) {
    if (trainPromptSet.has(ep.prompt)) {
      overlapCount++;
    }
  }
  console.log(`Eval prompts found in training set: ${overlapCount}`);
  console.log(`No-overlap guarantee: ${overlapCount === 0 ? "✅ PASS" : "❌ FAIL — " + overlapCount + " eval pairs leaked into training!"}`);

  // Spot-check 5 specific eval questions against the training JSONL text
  console.log(`\nSpot-checking 5 eval questions against training JSONL:`);
  const sampleEvals = evalPairs.slice(0, 5);
  for (let i = 0; i < sampleEvals.length; i++) {
    const q = sampleEvals[i].prompt;
    const inTraining = jsonl.includes(q);
    const category = sampleEvals[i]._meta?.pass_type ?? "unknown";
    console.log(`  ${i + 1}. [${category}] "${q.substring(0, 80)}..."`);
    console.log(`     In training JSONL? ${inTraining ? "❌ FAIL — LEAKED!" : "✅ NOT FOUND (correct)"}`);
  }

  console.log("\n========================================");
  console.log("TEST 3: SYSTEM PROMPT INJECTION");
  console.log("========================================\n");

  // Verify system_prompt is on all pairs
  const trainWithSP = trainPairs.filter(p => p.system_prompt).length;
  const evalWithSP = evalPairs.filter(p => p.system_prompt).length;
  console.log(`Train pairs with system_prompt: ${trainWithSP}/${trainPairs.length} ${trainWithSP === trainPairs.length ? "✅" : "❌"}`);
  console.log(`Eval pairs with system_prompt:  ${evalWithSP}/${evalPairs.length} ${evalWithSP === evalPairs.length ? "✅" : "❌"}`);

  // Write both files for inspection
  const trainPath = path.resolve(process.cwd(), "training-data/train-dataset.jsonl");
  const evalPath = path.resolve(process.cwd(), "training-data/eval-dataset.jsonl");
  writeFileSync(trainPath, jsonl, "utf-8");
  writeFileSync(evalPath, evalJsonl, "utf-8");
  console.log(`\n[Test] Training JSONL written to: ${trainPath}`);
  console.log(`[Test] Eval JSONL written to: ${evalPath}`);

  console.log("\n========================================");
  console.log("SUMMARY");
  console.log("========================================\n");

  const allPass = (
    trainPairs.length + evalPairs.length === stats.finalTotal &&
    trainJsonlLines === trainPairs.length &&
    evalJsonlLines === evalPairs.length &&
    evalPassTypes.size > 1 &&
    overlapCount === 0 &&
    trainWithSP === trainPairs.length &&
    evalWithSP === evalPairs.length
  );

  console.log(allPass ? "🟢 ALL TESTS PASSED" : "🔴 SOME TESTS FAILED");
}

main().catch((err) => {
  console.error("[Test] FATAL:", err);
  process.exit(1);
});
