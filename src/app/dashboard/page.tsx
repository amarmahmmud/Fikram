import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import DashboardClient from "./DashboardClient";

export const dynamic = 'force-dynamic';

export default async function DashboardPage(
  props: { searchParams: Promise<{ page?: string }> }
) {
  // Dashboard only loads the first page (50 items) initially.
  // Pagination is handled client-side via appending.
  const limit = 50;
  const from = 0;
  const to = 49;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return redirect("/auth/signin");

  const [{ data: profile }, { data: jobs }] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", user!.id).single(),
    supabase.from("jobs").select("*").eq("user_id", user!.id).order("created_at", { ascending: false }).range(from, to),
  ]);

  return <DashboardClient profile={profile} jobs={jobs ?? []} />;
}
