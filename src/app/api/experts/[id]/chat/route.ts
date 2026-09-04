import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateRAGResponse } from "@/lib/embedding";
import { checkRateLimit, getClientIP, ANON_CHAT_LIMIT, AUTH_CHAT_LIMIT } from "@/lib/rate-limiter";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: expertId } = await params;
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    // Rate limiting: use user ID if logged in, IP if anonymous
    const rateLimitKey = user ? `user:${user.id}` : `ip:${getClientIP(req)}`;
    const rateLimitConfig = user ? AUTH_CHAT_LIMIT : ANON_CHAT_LIMIT;
    const { allowed, remaining, resetMs } = checkRateLimit(rateLimitKey, rateLimitConfig);

    if (!allowed) {
      return NextResponse.json(
        {
          error: "Rate limit exceeded. Please try again later.",
          remaining: 0,
          retryAfterMs: resetMs,
        },
        {
          status: 429,
          headers: { "Retry-After": String(Math.ceil(resetMs / 1000)) },
        },
      );
    }

    const body = await req.json();
    const { message, history } = body;

    if (!message?.trim()) {
      return NextResponse.json({ error: "No message provided" }, { status: 400 });
    }

    // Fetch expert (allow owner OR if published)
    const { data: expert } = await supabase
      .from("experts")
      .select("*")
      .eq("id", expertId)
      .single();

    if (!expert) {
      return NextResponse.json({ error: "Expert not found" }, { status: 404 });
    }

    // Access check: owner or published
    if ((!user || expert.user_id !== user.id) && !expert.is_published) {
      return NextResponse.json({ error: "Expert not found" }, { status: 404 });
    }

    // Check expert has ingested content
    const { count } = await supabase
      .from("expert_chunks")
      .select("id", { count: "exact", head: true })
      .eq("expert_id", expertId);

    if (!count || count === 0) {
      return NextResponse.json({
        ok: true,
        reply: "I don't have any knowledge base content yet. Please upload some documents first.",
        sources: [],
      });
    }

    // Run RAG pipeline
    const result = await generateRAGResponse(
      message.trim(),
      expertId,
      expert.system_prompt || `You are ${expert.name}, a knowledgeable expert.`,
      history || [],
    );

    return NextResponse.json({
      ok: true,
      reply: result.reply,
      sources: result.sources,
    });
  } catch (err: any) {
    console.error("[Expert Chat] Error:", err);
    return NextResponse.json(
      { error: err.message || "Failed to generate response" },
      { status: 500 }
    );
  }
}
