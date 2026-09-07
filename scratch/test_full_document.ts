import fs from "fs";
import { generateDataset } from "../src/lib/dataset-pipeline";

if (fs.existsSync(".env.local")) {
  const envContent = fs.readFileSync(".env.local", "utf-8");
  envContent.split("\n").forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx !== -1) {
      const k = trimmed.slice(0, eqIdx).trim();
      const v = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
      process.env[k] = v;
    }
  });
}

async function run() {
  const filePath = "C:\\Users\\asus\\Downloads\\AI_Job_Replacement_Intelligence_Report_2024-2030.md";
  console.log("Reading file:", filePath);
  const text = fs.readFileSync(filePath, "utf-8");
  console.log(`Document loaded: ${text.length} characters.`);

  console.log("Running generateDataset on full document...");
  const startTime = Date.now();
  const result = await generateDataset(
    text,
    "Fine-tune an AI model as a Workforce Risk Analyst to provide precise, data-backed assessments on job displacement, automation exposure, and workforce transition statistics.",
    (prog) => {
      console.log(`[Progress] ${prog.stage}: ${prog.message} (chunks: ${prog.chunksProcessed}/${prog.chunksTotal}, pairs: ${prog.pairsGenerated})`);
    }
  );

  const durationSec = Math.round((Date.now() - startTime) / 1000);
  console.log(`\n=== GENERATION COMPLETE (${durationSec}s) ===`);
  console.log(`Raw pairs: ${result.stats.rawPairsGenerated}`);
  console.log(`Passed validation: ${result.stats.afterValidation}`);
  console.log(`After deduplication: ${result.stats.afterDedup}`);

  // Test critical keywords in the generated pairs
  const jsonl = result.jsonl;
  const checks = [
    { label: "Goldman Sachs", pattern: /Goldman Sachs/i },
    { label: "300 million", pattern: /300\s*million/i },
    { label: "IMF", pattern: /IMF|International Monetary Fund/i },
    { label: "40%", pattern: /40%/ },
    { label: "60%", pattern: /60%/ },
    { label: "SWE-bench", pattern: /SWE-bench/i },
    { label: "Devin", pattern: /Devin/i },
    { label: "70-77% or 13.86%", pattern: /70|77|13\.86|14%/ },
  ];

  console.log("\n=== KEYWORD & ENTITY AUDIT ===");
  for (const check of checks) {
    const matched = check.pattern.test(jsonl);
    console.log(`- ${check.label}: ${matched ? "✅ FOUND" : "❌ MISSING"}`);
  }

  // Save the full dataset for inspection or direct use
  fs.writeFileSync("scratch/generated_dataset.jsonl", jsonl, "utf-8");
  console.log("\nSaved full dataset to scratch/generated_dataset.jsonl");
}

run().catch((err) => {
  console.error("Pipeline test failed:", err);
});
