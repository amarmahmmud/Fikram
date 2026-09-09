import { createClient } from "@supabase/supabase-js";

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const jobId = "f54c8e4d-3bff-4ca9-b843-33b79fd3fef6";

async function poll() {
  while (true) {
    console.log("Polling sync endpoint...");
    try {
      const res = await fetch(`http://localhost:3000/api/jobs/sync?id=${jobId}`);
      const data = await res.json();
      console.log(`Sync status: ${data.job?.status}`);
      if (data.job?.status === "completed" || data.job?.status === "failed") {
        console.log("Job finished! Waiting 15s for evaluation to run...");
        await new Promise(r => setTimeout(r, 15000));
        
        // Fetch eval results
        const { data: finalJob } = await supabase.from("jobs").select("config").eq("id", jobId).single();
        console.log("\n--- Eval Results ---");
        console.log(JSON.stringify(finalJob?.config?.eval_result, null, 2));
        break;
      }
    } catch (e: any) {
      console.error("Poll error:", e?.message || e);
    }
    await new Promise(r => setTimeout(r, 10000));
  }
}
poll();
