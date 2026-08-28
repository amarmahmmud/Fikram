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

  // Check if assistant is published and actively used by >30% of platform users
  if (expert.is_published) {
    const { count: totalPlatformUsers } = await supabase
      .from("profiles")
      .select("id", { count: "exact", head: true });

    const totalUsers = Math.max(totalPlatformUsers || 1, 1);

    const { count: uniqueLikedUsers } = await supabase
      .from("user_likes")
      .select("user_id", { count: "exact", head: true })
      .eq("target_id", id)
      .eq("target_type", "expert");

    const chatsCount = expert.chats_count || 0;
    const userInteractions = Math.max(uniqueLikedUsers || 0, Math.min(chatsCount, totalUsers));
    const usagePercentage = (userInteractions / totalUsers) * 100;

    if (usagePercentage >= 30 || (totalUsers >= 3 && chatsCount >= totalUsers * 0.3)) {
      return NextResponse.json(
        {
          underReview: true,
          usagePercentage: Math.round(usagePercentage),
          error: "Deletion application under review: This published assistant is actively used by over 30% of platform users. To protect active user workflows, your deletion request has been submitted for review and will be processed once verified.",
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
