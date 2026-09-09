import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const jobId = "2d8e3cb3-2488-4818-b52c-0d6fb0bfc86e";
const callId = "fc-01M23AFD2YEY5SW5K0YER6C0RG";

async function main() {
  console.log(`Polling Modal training for Job: ${jobId} (call: ${callId})...`);

  while (true) {
    try {
      const res = await fetch(
        `https://amarsuadbusiness--model-factory-trainer-check-job-status.modal.run?call_id=${callId}`
      );
      const data = await res.json();
      console.log(`[${new Date().toLocaleTimeString()}] Modal Status: ${data.status}`);

      if (data.status === "completed") {
        console.log("\n🎉 Modal training COMPLETED successfully!");
        
        // 1. Mark completed in Supabase
        await supabase.from("jobs").update({
          status: "completed",
          result_url: `adapters/${jobId}`,
          completed_at: new Date().toISOString(),
          finished_at: new Date().toISOString(),
        }).eq("id", jobId);

        console.log("Job marked as completed in Supabase with adapter in R2.");
        break;
      } else if (data.status === "failed" || data.status === "error") {
        console.error("Training failed:", data.error);
        await supabase.from("jobs").update({
          status: "failed",
          completed_at: new Date().toISOString(),
          logs: `[Modal] Training failed: ${data.error}`,
        }).eq("id", jobId);
        process.exit(1);
      }
    } catch (e: any) {
      console.warn("Poll error (retrying):", e?.message || e);
    }

    await new Promise((r) => setTimeout(r, 15000));
  }
}

main().catch(console.error);
