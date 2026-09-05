import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; conversationId: string }> }
) {
  try {
    const { id: expertId, conversationId } = await params;
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Verify ownership
    const { data: conversation, error: convErr } = await supabase
      .from("expert_conversations")
      .select("*")
      .eq("id", conversationId)
      .eq("user_id", user.id)
      .eq("expert_id", expertId)
      .single();

    if (convErr || !conversation) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }

    // Fetch messages
    const { data: messages, error: msgErr } = await supabase
      .from("expert_messages")
      .select("id, role, content, sources, web_sources, created_at")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true });

    if (msgErr) {
      console.error("[Conversation Detail] Messages error:", msgErr);
      return NextResponse.json({ error: msgErr.message }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      conversation,
      messages: (messages || []).map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        sources: m.sources,
        webSources: m.web_sources,
        createdAt: m.created_at,
      })),
    });
  } catch (err: any) {
    console.error("[Conversation Detail] GET exception:", err);
    return NextResponse.json(
      { error: err.message || "Failed to load conversation" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; conversationId: string }> }
) {
  try {
    const { id: expertId, conversationId } = await params;
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { error } = await supabase
      .from("expert_conversations")
      .delete()
      .eq("id", conversationId)
      .eq("user_id", user.id)
      .eq("expert_id", expertId);

    if (error) {
      console.error("[Conversation Detail] DELETE error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error("[Conversation Detail] DELETE exception:", err);
    return NextResponse.json(
      { error: err.message || "Failed to delete conversation" },
      { status: 500 }
    );
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; conversationId: string }> }
) {
  try {
    const { id: expertId, conversationId } = await params;
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const title = body?.title?.trim()?.slice(0, 60);

    if (!title) {
      return NextResponse.json({ error: "Title is required" }, { status: 400 });
    }

    const { data: updated, error } = await supabase
      .from("expert_conversations")
      .update({ title, updated_at: new Date().toISOString() })
      .eq("id", conversationId)
      .eq("user_id", user.id)
      .eq("expert_id", expertId)
      .select()
      .single();

    if (error) {
      console.error("[Conversation Detail] PATCH error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, conversation: updated });
  } catch (err: any) {
    console.error("[Conversation Detail] PATCH exception:", err);
    return NextResponse.json(
      { error: err.message || "Failed to update conversation" },
      { status: 500 }
    );
  }
}
