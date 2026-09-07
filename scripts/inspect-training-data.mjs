// Fetch the most recent training JSONL from R2 and search for hallucination-prone strings
// Run with: node --env-file=.env.local scripts/inspect-training-data.mjs

import { S3Client, ListObjectsV2Command, GetObjectCommand } from "@aws-sdk/client-s3";
import { createClient } from "@supabase/supabase-js";
import fs from "fs";

const SEARCH_TERMS = [
  // Numbers the other AI flagged
  "29.5", "300 million", "40%", "92 million", "170 million",
  // Occupations / sources
  "cashiers", "word processors", "Solar Panel Installer", "solar panel",
  // The 4 stats the user asked about
  "McKinsey", "mckinsey",
  "WEF", "World Economic Forum", "2030",
  "IMF", "exposure",
  "BLS", "Bureau of Labor Statistics", "fastest-shrinking", "fastest shrinking",
  // Comparative subjects that might get swapped
  "advanced economies", "developing economies",
  "developed countries", "developing countries",
];

async function main() {
  // --- Approach 1: Query Supabase for the most recent job's dataset_url ---
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (supabaseUrl && supabaseKey) {
    console.log("=== Querying Supabase for recent jobs ===\n");
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: jobs, error } = await supabase
      .from("jobs")
      .select("id, name, status, base_model, dataset_url, created_at, config")
      .order("created_at", { ascending: false })
      .limit(5);

    if (error) {
      console.error("Supabase query error:", error.message);
    } else if (jobs && jobs.length > 0) {
      console.log(`Found ${jobs.length} recent jobs:\n`);
      for (const job of jobs) {
        console.log(`  Job: ${job.name}`);
        console.log(`  ID: ${job.id}`);
        console.log(`  Status: ${job.status}`);
        console.log(`  Model: ${job.base_model}`);
        console.log(`  Created: ${job.created_at}`);
        console.log(`  Dataset URL: ${job.dataset_url ? job.dataset_url.substring(0, 80) + "..." : "NULL"}`);
        console.log(`  Config: ${JSON.stringify(job.config)}`);
        console.log();
      }

      // Try to download the most recent dataset
      const latestWithUrl = jobs.find(j => j.dataset_url);
      if (latestWithUrl?.dataset_url) {
        console.log(`\n=== Downloading JSONL from: ${latestWithUrl.dataset_url.substring(0, 80)}... ===\n`);
        try {
          const res = await fetch(latestWithUrl.dataset_url);
          if (res.ok) {
            const text = await res.text();
            analyzeJsonl(text, latestWithUrl.name || latestWithUrl.id);
            return;
          } else {
            console.log(`Download failed (status ${res.status}) - URL may have expired. Trying R2 direct...`);
          }
        } catch (err) {
          console.log(`Download failed: ${err.message}. Trying R2 direct...`);
        }
      }
    } else {
      console.log("No jobs found in Supabase.");
    }
  }

  // --- Approach 2: List R2 bucket directly ---
  console.log("\n=== Listing R2 bucket for dataset files ===\n");

  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const accessKey = process.env.R2_ACCESS_KEY_ID;
  const secretKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET_NAME;

  if (!accountId || !accessKey || !secretKey || !bucket) {
    console.error("Missing R2 credentials in .env.local");
    return;
  }

  const s3 = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: accessKey,
      secretAccessKey: secretKey,
    },
  });

  // List all objects in the datasets/ prefix
  const listCmd = new ListObjectsV2Command({
    Bucket: bucket,
    Prefix: "datasets/",
    MaxKeys: 50,
  });

  const listResult = await s3.send(listCmd);
  const objects = listResult.Contents || [];

  if (objects.length === 0) {
    console.log("No dataset files found in R2 bucket under 'datasets/' prefix.");

    // Try without prefix
    const listAll = new ListObjectsV2Command({ Bucket: bucket, MaxKeys: 100 });
    const allResult = await s3.send(listAll);
    const allObjects = allResult.Contents || [];
    console.log(`\nAll objects in bucket (${allObjects.length}):`);
    for (const obj of allObjects) {
      console.log(`  ${obj.Key}  (${obj.Size} bytes, ${obj.LastModified})`);
    }
    return;
  }

  // Sort by last modified, newest first
  objects.sort((a, b) => (b.LastModified?.getTime() || 0) - (a.LastModified?.getTime() || 0));

  console.log(`Found ${objects.length} dataset files:`);
  for (const obj of objects.slice(0, 10)) {
    console.log(`  ${obj.Key}  (${obj.Size} bytes, ${obj.LastModified})`);
  }

  // Download the most recent JSONL
  const latestKey = objects[0].Key;
  console.log(`\n=== Downloading latest: ${latestKey} ===\n`);

  const getCmd = new GetObjectCommand({ Bucket: bucket, Key: latestKey });
  const getResult = await s3.send(getCmd);
  const body = await getResult.Body.transformToString();

  analyzeJsonl(body, latestKey);
}

function analyzeJsonl(text, sourceName) {
  console.log(`=== JSONL Analysis: ${sourceName} ===\n`);
  console.log(`Total size: ${text.length} chars`);

  const lines = text.trim().split("\n").filter(l => l.trim());
  console.log(`Total records: ${lines.length}\n`);

  // Parse all records
  const records = [];
  for (let i = 0; i < lines.length; i++) {
    try {
      records.push({ index: i, ...JSON.parse(lines[i]) });
    } catch {
      console.warn(`  [WARN] Line ${i} is not valid JSON`);
    }
  }

  // Search for each term
  console.log("=== SEARCH RESULTS ===\n");
  const matchedRecords = new Set();

  for (const term of SEARCH_TERMS) {
    const matches = records.filter(r => {
      const fullText = `${r.prompt} ${r.completion}`.toLowerCase();
      return fullText.includes(term.toLowerCase());
    });

    if (matches.length > 0) {
      console.log(`\n"${term}" - ${matches.length} hit(s):`);
      for (const m of matches) {
        matchedRecords.add(m.index);
        console.log(`  [Record ${m.index}]`);
        console.log(`    Q: ${m.prompt}`);
        console.log(`    A: ${m.completion.substring(0, 200)}${m.completion.length > 200 ? "..." : ""}`);
      }
    }
  }

  // Write full matched records to file for detailed inspection
  const outputPath = "training-data/inspected-records.json";
  const matchedArr = [...matchedRecords].map(i => records[i]);
  try {
    fs.mkdirSync("training-data", { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(matchedArr, null, 2));
    console.log(`\n=== Wrote ${matchedArr.length} matched records to ${outputPath} ===`);
  } catch (err) {
    console.log(`\nCould not write output file: ${err.message}`);
    console.log("\n=== ALL MATCHED RECORDS (full text) ===\n");
    console.log(JSON.stringify(matchedArr, null, 2));
  }

  // Summary stats
  console.log(`\n=== SUMMARY ===`);
  console.log(`Total records in JSONL: ${records.length}`);
  console.log(`Records matching search terms: ${matchedRecords.size}`);
  console.log(`Records NOT matching any term: ${records.length - matchedRecords.size}`);

  // Check for conflicting answers about the same fact
  console.log(`\n=== CONFLICT CHECK ===`);
  const numberPairs = records
    .filter(r => r.completion.match(/\d+(?:\.\d+)?%/))
    .map(r => ({
      ...r,
      numbers: [...r.completion.matchAll(/(\d+(?:\.\d+)?%)/g)].map(m => m[1]),
    }));

  console.log(`Records containing percentages: ${numberPairs.length}`);

  // Find records with similar questions but different percentage answers
  for (let i = 0; i < numberPairs.length; i++) {
    for (let j = i + 1; j < numberPairs.length; j++) {
      const a = numberPairs[i];
      const b = numberPairs[j];
      const wordsA = new Set(a.prompt.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/));
      const wordsB = new Set(b.prompt.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/));
      const intersection = [...wordsA].filter(w => wordsB.has(w)).length;
      const union = new Set([...wordsA, ...wordsB]).size;
      const sim = union > 0 ? intersection / union : 0;

      if (sim > 0.6) {
        const numsA = new Set(a.numbers);
        const numsB = new Set(b.numbers);
        const overlap = [...numsA].some(n => numsB.has(n));
        if (!overlap && a.numbers.length > 0 && b.numbers.length > 0) {
          console.log(`\n  !! CONFLICT (similarity ${(sim*100).toFixed(0)}%):`);
          console.log(`    [${a.index}] Q: ${a.prompt}`);
          console.log(`           A numbers: ${a.numbers.join(", ")}`);
          console.log(`    [${b.index}] Q: ${b.prompt}`);
          console.log(`           A numbers: ${b.numbers.join(", ")}`);
        }
      }
    }
  }
}

main().catch(console.error);
