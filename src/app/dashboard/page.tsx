import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import DashboardClient from "./DashboardClient";


export default async function DashboardPage(
  props: { searchParams: Promise<{ page?: string }> }
) {
  const searchParams = await props.searchParams;
  const page = parseInt(searchParams?.page || "1", 10);
  const limit = 50;
  const from = (page - 1) * limit;
  const to = from + limit - 1;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/signin");

  const [{ data: profile }, { data: jobs }] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", user.id).single(),
    supabase.from("jobs").select("*").eq("user_id", user.id).order("created_at", { ascending: false }).range(from, to),
  ]);

  return <DashboardClient profile={profile} jobs={jobs ?? []} currentPage={page} />;
}
