import { createClient } from "@supabase/supabase-js";

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const jobId = "15ff2b1b-a271-4334-907b-59e1f95bc913";
const callId = "fc-01M22XCGY4J6TKW4387R4BNW8R";

async function poll() {
  while (true) {
    console.log("Polling Modal endpoint directly...");
    try {
      const res = await fetch(`https://amarsuadbusiness--model-factory-trainer-check-job-status.modal.run?call_id=${callId}`);
      const modalCheck = await res.json();
      console.log(`Modal status: ${modalCheck.status}`);
      if (modalCheck.status === "completed" || modalCheck.status === "failed") {
        console.log("Job finished on Modal! Simulating sync fallback...");
        
        // 1. Mark completed
        await supabase.from("jobs").update({
          status: modalCheck.status,
          result_url: `adapters/${jobId}`,
          completed_at: new Date().toISOString(),
          finished_at: new Date().toISOString(),
        }).eq("id", jobId);
        
        // 2. Trigger evaluate webhook manually (which the sync fallback does)
        console.log("Triggering /evaluate fallback...");
        const evalRes = await fetch(`http://localhost:3000/api/jobs/${jobId}/evaluate`, {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ trigger: "sync_fallback" })
        });
        console.log("Eval trigger response:", evalRes.status);
        
        console.log("Waiting 20s for evaluation to run...");
        await new Promise(r => setTimeout(r, 20000));
        
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
