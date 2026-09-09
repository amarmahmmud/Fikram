const url = "https://awjluyeoijmytrzobsdy.supabase.co/rest/v1/jobs?id=eq.0227d976-09c8-4118-8d40-1d42e6e7ed56";
const key = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF3amx1eWVvaWpteXRyem9ic2R5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NjUyMTI0MiwiZXhwIjoyMTAyMDk3MjQyfQ.IzwhJ_jm2CxaoxsOxxR978VLG5n6gPaCQhJKaW8g30s";

fetch(url, {
  method: "PATCH",
  headers: {
    "apikey": key,
    "Authorization": `Bearer ${key}`,
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    status: "completed",
    result_url: "adapters/0227d976-09c8-4118-8d40-1d42e6e7ed56",
    logs: "\n[System] Modal execution finished successfully."
  })
})
.then(r => console.log("DB Update Status:", r.status))
.then(() => {
  return fetch("http://localhost:3000/api/jobs/0227d976-09c8-4118-8d40-1d42e6e7ed56/evaluate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ trigger: "manual_fix" })
  });
})
.then(r => console.log("Eval trigger status:", r.status))
.catch(err => console.error(err));
