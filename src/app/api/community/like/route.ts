import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const { targetId, targetType } = body;

    if (!targetId || !targetType || !['expert', 'job'].includes(targetType)) {
      return NextResponse.json({ error: "Invalid request data" }, { status: 400 });
    }

    // 1. Try to insert into user_likes
    const { error: likeError } = await supabase
      .from('user_likes')
      .insert({
        user_id: user.id,
        target_id: targetId,
        target_type: targetType as "expert" | "job"
      });

    // If there's an error (like a unique constraint violation), the user already liked it.
    if (likeError) {
      if (likeError.code === '23505') { // Postgres unique_violation code
        return NextResponse.json({ error: "Already liked" }, { status: 409 });
      }
      throw likeError;
    }

    // 2. Increment the likes_count in the respective table
    const table = targetType === 'expert' ? 'experts' : 'jobs';
    
    // Fallback manual fetch/update logic for the increment
    const { data: currentData, error: fetchError } = await supabase
      .from(table)
      .select('likes_count')
      .eq('id', targetId)
      .single();

    if (fetchError) throw fetchError;

    const newCount = (currentData.likes_count || 0) + 1;

    const { error: updateError } = await supabase
      .from(table)
      .update({ likes_count: newCount } as any) // suppress TS error for dynamic table update
      .eq('id', targetId);

    if (updateError) throw updateError;

    return NextResponse.json({ ok: true, likes_count: newCount });
  } catch (err: any) {
    console.error("[Community Like API Error]:", err);
    return NextResponse.json({ error: "Failed to process like" }, { status: 500 });
  }
}
