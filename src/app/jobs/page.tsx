import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import JobsClient from "./JobsClient";

export const dynamic = 'force-dynamic';

export default async function JobsPage(
  props: { searchParams: Promise<{ page?: string }> }
) {
  // Jobs and Experts only load the first page (50 items) initially.
  // Pagination is handled client-side independently via appending.
  const limit = 50;
  const from = 0;
  const to = 49;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return redirect("/auth/signin");

  const { data: jobs } = await supabase
    .from("jobs")
    .select("*")
    .eq("user_id", user!.id)
    .order("created_at", { ascending: false })
    .range(from, to);

  const { data: experts } = await supabase
    .from("experts")
    .select("*")
    .eq("user_id", user!.id)
    .order("created_at", { ascending: false })
    .range(from, to);

  return <JobsClient jobs={jobs ?? []} experts={experts ?? []} />;
}
