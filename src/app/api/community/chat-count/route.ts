import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    // We don't necessarily enforce strict auth here since anyone playing in playground counts as a chat.
    
    const body = await req.json();
    const { targetId, targetType } = body;

    if (!targetId || !targetType || !['expert', 'job'].includes(targetType)) {
      return NextResponse.json({ error: "Invalid request data" }, { status: 400 });
    }

    const table = targetType === 'expert' ? 'experts' : 'jobs';
    
    // Fetch and increment
    const { data: currentData, error: fetchError } = await supabase
      .from(table)
      .select('chats_count')
      .eq('id', targetId)
      .single();

    if (fetchError) throw fetchError;

    const newCount = (currentData.chats_count || 0) + 1;

    const { error: updateError } = await supabase
      .from(table)
      .update({ chats_count: newCount } as any)
      .eq('id', targetId);

    if (updateError) throw updateError;

    return NextResponse.json({ ok: true, chats_count: newCount });
  } catch (err: any) {
    console.error("[Community ChatCount API Error]:", err);
    return NextResponse.json({ error: "Failed to increment chat count" }, { status: 500 });
  }
}
