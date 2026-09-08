import { readFileSync, writeFileSync } from "fs";
import { generateDataset } from "@/lib/dataset-pipeline";
import { WizardContext } from "@/lib/wizard-types";
import path from "path";

async function main() {
  const docPath = "C:\\Users\\asus\\Downloads\\AI_Job_Replacement_Intelligence_Report_2024-2030.md";
  const text = readFileSync(docPath, "utf-8");
  console.log(`[Test] Document loaded: ${text.length} chars`);

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

  const { pairs, jsonl, stats, systemPrompt } = await generateDataset(
    text,
    ctx.goal,
    (progress) => {
      console.log(`  [${progress.stage}] ${progress.message}`);
    },
    ctx
  );

  console.log("\n========================================");
  console.log("PIPELINE RESULTS");
  console.log("========================================\n");

  console.log("--- Stats ---");
  console.log(JSON.stringify(stats, null, 2));

  console.log(`\n--- System Prompt ---`);
  console.log(systemPrompt);

  const passTypes = new Map<string, number>();
  let withSystemPrompt = 0;
  for (const p of pairs) {
    const pt = p._meta?.pass_type ?? "unknown";
    passTypes.set(pt, (passTypes.get(pt) ?? 0) + 1);
    if (p.system_prompt) withSystemPrompt++;
  }

  console.log(`\n--- Pair Breakdown ---`);
  console.log(`Total pairs: ${pairs.length}`);
  for (const [k, v] of passTypes) {
    console.log(`  ${k}: ${v}`);
  }
  console.log(`  Records with system_prompt: ${withSystemPrompt} / ${pairs.length}`);

  const keywords = [
    { name: "McKinsey 29.5%", pattern: /29\.5/ },
    { name: "McKinsey 21.5%", pattern: /21\.5/ },
    { name: "Very High risk", pattern: /Very High/i },
    { name: "photographer", pattern: /photograph/i },
    { name: "contract review", pattern: /contract review/i },
    { name: "bookkeeper", pattern: /bookkeeper/i },
    { name: "call center", pattern: /call center/i },
    { name: "robotaxi", pattern: /robotaxi|robo.taxi/i },
    { name: "rideshare/driver", pattern: /rideshare|ride.share|uber|lyft|taxi.*driver/i },
    { name: "3-5% decline", pattern: /3.{0,3}5%/i },
    { name: "litigator", pattern: /litigator/i },
    { name: "paralegal", pattern: /paralegal/i },
    { name: "boundary/refusal", pattern: /does not cover|doesn't cover|outside.*scope|don't have that|not covered/i },
    { name: "contrastive/despite", pattern: /despite|common misconception|counterintuitive|contrary to/i },
  ];

  console.log(`\n--- Keyword Coverage ---`);
  for (const kw of keywords) {
    const matches = pairs.filter(p => kw.pattern.test(p.prompt) || kw.pattern.test(p.completion));
    console.log(`  ${kw.name}: ${matches.length} records`);
  }

  const standard = pairs.find(p => p._meta?.pass_type !== "boundary" && p._meta?.pass_type !== "contrastive");
  const boundary = pairs.find(p => p._meta?.pass_type === "boundary");
  const contrastive = pairs.find(p => p._meta?.pass_type === "contrastive");

  console.log(`\n--- Sample Records ---`);
  if (standard) {
    console.log("\n[STANDARD PAIR]");
    console.log(JSON.stringify({ prompt: standard.prompt, completion: standard.completion.substring(0, 250), system_prompt: standard.system_prompt?.substring(0, 120) }, null, 2));
  }
  if (boundary) {
    console.log("\n[BOUNDARY PAIR]");
    console.log(JSON.stringify({ prompt: boundary.prompt, completion: boundary.completion.substring(0, 250), system_prompt: boundary.system_prompt?.substring(0, 120) }, null, 2));
  }
  if (contrastive) {
    console.log("\n[CONTRASTIVE PAIR]");
    console.log(JSON.stringify({ prompt: contrastive.prompt, completion: contrastive.completion.substring(0, 250), system_prompt: contrastive.system_prompt?.substring(0, 120) }, null, 2));
  }

  const outPath = path.resolve(process.cwd(), "training-data/regenerated-dataset.jsonl");
  writeFileSync(outPath, jsonl, "utf-8");
  console.log(`\n[Test] JSONL written to: ${outPath}`);
  console.log(`[Test] JSONL lines: ${jsonl.trim().split("\\n").length}`);
}

main().catch((err) => {
  console.error("[Test] FATAL:", err);
  process.exit(1);
});
