import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// DELETE /api/experts/[id] — delete an expert owned by the authenticated user
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Fetch the expert and verify ownership
  const { data: expert, error: fetchErr } = await supabase
    .from("experts")
    .select("id, user_id, is_published, chats_count, likes_count")
    .eq("id", id)
    .single();

  if (fetchErr || !expert) {
    return NextResponse.json({ error: "Expert not found" }, { status: 404 });
  }

  if (expert.user_id !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Check if assistant is published and used by >= 30% of active platform users (MAU)
  if (expert.is_published) {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    // 1. Calculate active platform users (users active in the last 30 days)
    const [
      { data: recentProfiles },
      { data: recentJobs },
      { data: recentLikes },
      { data: recentTransactions },
    ] = await Promise.all([
      supabase.from("profiles").select("id").gte("created_at", thirtyDaysAgo),
      supabase.from("jobs").select("user_id").gte("created_at", thirtyDaysAgo),
      supabase.from("user_likes").select("user_id").gte("created_at", thirtyDaysAgo),
      supabase.from("credit_transactions").select("user_id").gte("created_at", thirtyDaysAgo),
    ]);

    const activeUserSet = new Set<string>();
    recentProfiles?.forEach((p: any) => p.id && activeUserSet.add(p.id));
    recentJobs?.forEach((j: any) => j.user_id && activeUserSet.add(j.user_id));
    recentLikes?.forEach((l: any) => l.user_id && activeUserSet.add(l.user_id));
    recentTransactions?.forEach((t: any) => t.user_id && activeUserSet.add(t.user_id));

    let activeUsersCount = activeUserSet.size;
    if (activeUsersCount === 0) {
      const { count: totalCount } = await supabase.from("profiles").select("id", { count: "exact", head: true });
      activeUsersCount = Math.max(totalCount || 1, 1);
    }

    // 2. Count distinct active users who interacted with or liked this assistant
    const { data: modelLikers } = await supabase
      .from("user_likes")
      .select("user_id")
      .eq("target_id", id)
      .eq("target_type", "expert");

    const modelUserSet = new Set<string>();
    modelLikers?.forEach((l: any) => l.user_id && modelUserSet.add(l.user_id));

    const chatsCount = expert.chats_count || 0;
    const modelActiveUsers = Math.max(modelUserSet.size, Math.min(chatsCount, activeUsersCount));
    const activeUsagePercentage = (modelActiveUsers / activeUsersCount) * 100;

    // Check threshold: 30% and over (>= 30%) of active platform users
    if (activeUsagePercentage >= 30 || (activeUsersCount >= 2 && chatsCount >= activeUsersCount * 0.3)) {
      return NextResponse.json(
        {
          underReview: true,
          activeUsagePercentage: Math.round(activeUsagePercentage),
          error: "Deletion application under review: This published assistant is actively used by 30% or more of active platform users. To maintain service continuity for active users, your deletion request is under administrative review and will be processed once verified.",
        },
        { status: 423 }
      );
    }
  }

  // 1. Delete associated expert knowledge chunks and likes
  await supabase.from("expert_chunks").delete().eq("expert_id", id);
  await supabase.from("user_likes").delete().eq("target_id", id).eq("target_type", "expert");

  // 2. Delete the expert
  const { error: deleteErr } = await supabase
    .from("experts")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);

  if (deleteErr) {
    console.error("[Experts API] Delete error:", deleteErr);
    return NextResponse.json({ error: deleteErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
