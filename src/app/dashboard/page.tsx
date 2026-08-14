import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import DashboardClient from "./DashboardClient";


export default async function DashboardPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/signin");

  const [{ data: profile }, { data: jobs }] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", user.id).single(),
    supabase.from("jobs").select("*").eq("user_id", user.id).order("created_at", { ascending: false }).limit(5),
  ]);

  return <DashboardClient profile={profile} jobs={jobs ?? []} />;
}
