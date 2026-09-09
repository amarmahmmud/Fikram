import { readFileSync } from "fs";
import { createClient } from "@supabase/supabase-js";
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { generateDataset } from "../src/lib/dataset-pipeline";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

async function uploadToR2(filename: string, content: string): Promise<string> {
  const bucket = process.env.R2_BUCKET_NAME!;
  const userId = "7187f574-e408-4040-b001-f471a2fe9821";
  const fileKey = `datasets/${userId}/${Date.now()}-${filename}`;

  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: fileKey,
      Body: Buffer.from(content),
      ContentType: "application/jsonl",
    })
  );

  const getCommand = new GetObjectCommand({
    Bucket: bucket,
    Key: fileKey,
  });
  return await getSignedUrl(s3, getCommand, { expiresIn: 7 * 24 * 60 * 60 });
}

async function main() {
  console.log("=== Step 1: Generating Dataset with Contrastive Upgrades ===");
  const text = readFileSync("AI_Job_Replacement_Intelligence_Report_2024-2030.md", "utf-8");
  console.log(`Document loaded: ${text.length} characters`);

  const { jsonl, evalJsonl, stats, systemPrompt } = await generateDataset(
    text,
    "AI Job Replacement Intelligence Report",
    (progress) => {
      console.log(`[${progress.stage}] ${progress.message} (pairs: ${progress.pairsGenerated})`);
    },
    {
      goal: "AI Job Replacement Intelligence",
      persona: "Workforce Automation Economist & Intelligence Analyst",
      audience: "Executives and professionals",
      style: "Analytical and precise",
      format: "Detailed",
      boundaries: "Strictly adhere to the intelligence brief; do not invent unstated statistics or arbitrary scores",
    }
  );

  console.log("\nDataset Generation Complete!");
  console.log(`Training pairs: ${stats.trainPairsCount}, Eval pairs: ${stats.evalPairsCount}`);
  console.log(`Boundary: ${stats.boundaryPairs}, Contrastive: ${stats.contrastivePairs}, Applied: ${stats.appliedExamplePairs}`);

  console.log("\n=== Step 2: Uploading Datasets to Cloudflare R2 ===");
  const datasetUrl = await uploadToR2("contrastive_train.jsonl", jsonl);
  const evalDatasetUrl = await uploadToR2("contrastive_eval.jsonl", evalJsonl);
  console.log("Train Dataset URL generated");
  console.log("Eval Dataset URL generated");

  console.log("\n=== Step 3: Creating Job in Supabase ===");
  const userId = "7187f574-e408-4040-b001-f471a2fe9821";
  const { data: job, error: jobErr } = await supabase.from("jobs").insert({
    user_id: userId,
    name: "Contrastive Test Job (AI Workforce)",
    status: "pending",
    base_model: "google/gemma-2-9b-it",
    method: "qlora",
    dataset_url: datasetUrl,
    config: {
      epochs: 1,
      maxSteps: 10, // Keep Modal GPU runtime minimal (~60-90s)
      warmupSteps: 2,
      learningRate: 0.0002,
      batchSize: 1,
      use_qlora: true,
      credits_held: 10,
      credits_estimated: 10,
      eval_dataset_url: evalDatasetUrl,
      estimated_training_seconds: 60,
    },
  }).select().single();

  if (jobErr || !job) {
    throw new Error(`Failed to create job: ${jobErr?.message}`);
  }
  console.log(`Created Job ID: ${job.id}`);

  console.log("\n=== Step 4: Triggering Modal Training ===");
  const modalTrainUrl = process.env.MODAL_TRAIN_URL || "https://amarsuadbusiness--model-factory-trainer-start-training.modal.run";
  const webhookUrl = `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/api/webhooks/modal`;

  const trainRes = await fetch(modalTrainUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      job_id: job.id,
      dataset_url: job.dataset_url,
      webhook_url: webhookUrl,
      base_model: job.base_model,
      dataset_size: 20,
      system_prompt: systemPrompt,
      learning_rate: 0.0002,
      lora_r: 16,
      max_seq_length: 512,
      confirmed_credit_hold: 30,
      r2_endpoint: `https://${process.env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      r2_access_key: process.env.R2_ACCESS_KEY_ID,
      r2_secret_key: process.env.R2_SECRET_ACCESS_KEY,
      r2_bucket: process.env.R2_BUCKET_NAME,
      max_steps: 10,
    }),
  });

  const modalData = await trainRes.json();
  console.log("Modal Response:", modalData);

  if (modalData.call_id) {
    await supabase.from("jobs").update({
      replicate_id: modalData.call_id,
      status: "running",
      started_at: new Date().toISOString(),
    }).eq("id", job.id);
    console.log(`Job updated to running with call_id: ${modalData.call_id}`);
  }

  console.log("\nJob is now launched! Job ID:", job.id);
  console.log("Next: Polling Modal until training completes, then running evaluation.");
}

main().catch(console.error);
