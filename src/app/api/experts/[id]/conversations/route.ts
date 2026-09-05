import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: expertId } = await params;
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ ok: true, conversations: [] });
    }

    const { data: conversations, error } = await supabase
      .from("expert_conversations")
      .select("id, title, created_at, updated_at")
      .eq("expert_id", expertId)
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false });

    if (error) {
      console.error("[Conversations] GET error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, conversations: conversations || [] });
  } catch (err: any) {
    console.error("[Conversations] GET exception:", err);
    return NextResponse.json(
      { error: err.message || "Failed to fetch conversations" },
      { status: 500 }
    );
  }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: expertId } = await params;
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { error: "Authentication required to save conversations" },
        { status: 401 }
      );
    }

    let title = "New Conversation";
    try {
      const body = await req.json();
      if (body?.title?.trim()) {
        title = body.title.trim().slice(0, 60);
      }
    } catch {
      // Body might be empty
    }

    const { data: conversation, error } = await supabase
      .from("expert_conversations")
      .insert({
        user_id: user.id,
        expert_id: expertId,
        title,
      })
      .select()
      .single();

    if (error) {
      console.error("[Conversations] POST error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, conversation });
  } catch (err: any) {
    console.error("[Conversations] POST exception:", err);
    return NextResponse.json(
      { error: err.message || "Failed to create conversation" },
      { status: 500 }
    );
  }
}
