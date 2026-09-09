import { createClient } from "@supabase/supabase-js";
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
supabase.from('jobs').select('id, dataset_url').order('created_at', { ascending: false }).limit(5).then(r=>console.log(r.data));
