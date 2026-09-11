const fs = require('fs');
const content = fs.readFileSync('.env.local', 'utf8');
const env = {};
content.split('\n').forEach(line => {
  const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
  if (match) {
    let val = (match[2] || '').trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    env[match[1]] = val;
  }
});

const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

async function check() {
  const jobId = process.argv[2] || 'b77b10e0-ddc8-4682-8889-9c577aa06a35';
  const { data, error } = await supabase.from('jobs').select('*').eq('id', jobId).single();
  if (error) {
    console.error('Error fetching job:', error);
    return;
  }
  console.log('--- JOB STATUS ---');
  console.log('ID:', data.id);
  console.log('Status:', data.status);
  console.log('Error:', data.error);
  console.log('Model Name:', data.model_name);
  console.log('Base Model:', data.base_model);
  console.log('Dataset URL:', data.dataset_url);
  console.log('Hold Amount:', data.hold_amount);
  console.log('Actual GPU Seconds:', data.actual_gpu_seconds);
  console.log('Completed At:', data.completed_at);
  console.log('Full config:');
  console.log(JSON.stringify(data.config, null, 2));
}
check();
