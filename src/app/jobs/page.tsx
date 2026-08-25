import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import JobsClient from "./JobsClient";


export default async function JobsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/signin");

  const { data: jobs } = await supabase
    .from("jobs")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  const { data: experts } = await supabase
    .from("experts")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  return <JobsClient jobs={jobs ?? []} experts={experts ?? []} />;
}
