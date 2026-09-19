import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { parseExpertMetadata, formatExpertDescription, ReasoningMode } from "@/lib/expert-metadata";
import { z } from "zod";

const updateExpertSchema = z.object({
  name: z.string().max(100, "Name is too long").optional(),
  description: z.string().max(1000, "Description is too long").optional(),
  systemPrompt: z.string().max(5000, "System prompt is too long").optional(),
  reasoningMode: z.string().optional(),
  webSearchEnabled: z.boolean().optional(),
});

// GET /api/experts/[id] — get expert details, total chunks, and knowledge sources summary
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    const { data: expert, error } = await supabase
      .from("experts")
      .select("*")
      .eq("id", id)
      .single();

    if (error || !expert) {
      return NextResponse.json({ error: "Expert not found" }, { status: 404 });
    }

    // Access check: owner or published
    if ((!user || expert.user_id !== user.id) && !expert.is_published) {
      return NextResponse.json({ error: "Expert not found" }, { status: 404 });
    }

    // Fetch chunks summary
    const { data: chunks } = await supabase
      .from("expert_chunks")
      .select("source_filename")
      .eq("expert_id", id);

    const fileMap: Record<string, number> = {};
    chunks?.forEach((c) => {
      const fn = c.source_filename || "Unknown Source";
      fileMap[fn] = (fileMap[fn] || 0) + 1;
    });

    const sources = Object.entries(fileMap).map(([filename, chunkCount]) => ({
      filename,
      chunkCount,
    }));

    const isOwner = Boolean(user && expert.user_id === user.id);
    const metadata = parseExpertMetadata(expert.description || "", expert.name);

    return NextResponse.json({
      ok: true,
      expert,
      metadata,
      totalChunks: chunks?.length || 0,
      sources,
      isOwner,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to load expert" }, { status: 500 });
  }
}

// PATCH /api/experts/[id] — update expert settings (reasoning mode, web search, prompt, description)
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { data: expert } = await supabase
      .from("experts")
      .select("*")
      .eq("id", id)
      .eq("user_id", user.id)
      .single();

    if (!expert) return NextResponse.json({ error: "Expert not found" }, { status: 404 });

    let parsedBody;
    try {
      const json = await req.json();
      parsedBody = updateExpertSchema.parse(json);
    } catch (error: any) {
      return NextResponse.json({ error: error.errors?.[0]?.message || "Invalid input" }, { status: 400 });
    }

    const { systemPrompt, reasoningMode, webSearchEnabled, description, name } = parsedBody;

    const currentMeta = parseExpertMetadata(expert.description || "", expert.name);
    const newDescription = formatExpertDescription(
      description !== undefined ? description : currentMeta.cleanDescription,
      {
        category: currentMeta.category,
        tags: currentMeta.tags,
        reasoningMode: (reasoningMode || currentMeta.reasoningMode) as ReasoningMode,
        webSearchEnabled: webSearchEnabled !== undefined ? webSearchEnabled : currentMeta.webSearchEnabled,
      }
    );

    const updates: any = {
      description: newDescription,
      updated_at: new Date().toISOString(),
    };
    if (systemPrompt !== undefined) updates.system_prompt = systemPrompt;
    if (name !== undefined) updates.name = name;

    const { data: updated, error } = await supabase
      .from("experts")
      .update(updates)
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ ok: true, expert: updated });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to update expert" }, { status: 500 });
  }
}

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
          error: "Deletion application under review: This published RAG AI Expert is actively used by 30% or more of active platform users. To maintain service continuity for active users, your deletion request is under administrative review and will be processed once verified.",
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
