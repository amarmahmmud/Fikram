import { createClient } from "@supabase/supabase-js";

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function main() {
  const userId = "7187f574-e408-4040-b001-f471a2fe9821"; // The user's ID from previous investigate_job
  
  // 1. Insert Job
  const { data: job, error } = await supabase.from("jobs").insert({
    user_id: userId,
    name: "Small Test E2E Job",
    status: "pending",
    base_model: "google/gemma-2-9b-it",
    method: "qlora",
    dataset_url: "https://model-factory-datasets.ff2a21f0d19f9614496c82086cac9b62.r2.cloudflarestorage.com/datasets/7187f574-e408-4040-b001-f471a2fe9821/1788944182644-AI_Job_Replacement_Intelligence_Report_2024-2030_dataset.jsonl?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Amz-Credential=0110c69591d0958a63da826e61db7786%2F20260909%2Fauto%2Fs3%2Faws4_request&X-Amz-Date=20260909T085622Z&X-Amz-Expires=604800&X-Amz-Signature=232a0c92f9d8ea89ae6b224b8096bd18dd2a288d66ff8d3a8167a4fde99eb002&X-Amz-SignedHeaders=host&x-amz-checksum-mode=ENABLED&x-id=GetObject",
    config: {
      epochs: 1,
      maxSteps: 10, // very small
      warmupSteps: 2,
      learningRate: 0.0002,
      batchSize: 1,
      use_qlora: true,
      credits_held: 10,
      credits_estimated: 10,
      eval_dataset_url: "https://model-factory-datasets.ff2a21f0d19f9614496c82086cac9b62.r2.cloudflarestorage.com/datasets/7187f574-e408-4040-b001-f471a2fe9821/1788944180169-AI_Job_Replacement_Intelligence_Report_2024-2030_eval.jsonl?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Amz-Credential=0110c69591d0958a63da826e61db7786%2F20260909%2Fauto%2Fs3%2Faws4_request&X-Amz-Date=20260909T085620Z&X-Amz-Expires=604800&X-Amz-Signature=f80779320de2ba2eab6e9be36cb47252475314c1b5f273ca8724a48acd2c930d&X-Amz-SignedHeaders=host&x-amz-checksum-mode=ENABLED&x-id=GetObject",
      estimated_training_seconds: 60
    }
  }).select().single();
  
  if (error) throw error;
  console.log("Created Job:", job.id);
  
  // 2. Trigger Modal
  const modalTrainUrl = process.env.MODAL_TRAIN_URL ?? "https://amarsuadbusiness--model-factory-trainer-start-training.modal.run";
  const webhookUrl = `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/api/webhooks/modal`;
  
  const res = await fetch(modalTrainUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      job_id: job.id,
      dataset_url: job.dataset_url,
      webhook_url: webhookUrl,
      base_model: job.base_model,
      dataset_size: 10, // small subset
      system_prompt: "You are a helpful assistant.",
      learning_rate: 0.0002,
      lora_r: 16,
      max_seq_length: 512,
      confirmed_credit_hold: 30,
      r2_endpoint: `https://${process.env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      r2_access_key: process.env.R2_ACCESS_KEY_ID,
      r2_secret_key: process.env.R2_SECRET_ACCESS_KEY,
      r2_bucket: process.env.R2_BUCKET_NAME,
      max_steps: 10 // override steps
    })
  });
  
  const modalData = await res.json();
  console.log("Modal triggered:", modalData);
  
  // 3. Update job with replicate_id
  if (modalData.call_id) {
    await supabase.from("jobs").update({
      replicate_id: modalData.call_id,
      status: "running",
      started_at: new Date().toISOString()
    }).eq("id", job.id);
    console.log("Updated job with call_id:", modalData.call_id);
  }
}
main();
