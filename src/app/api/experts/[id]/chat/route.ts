import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateRAGResponse, isMediaMimeType, type MediaAttachment } from "@/lib/embedding";
import { checkRateLimit, getClientIP, ANON_CHAT_LIMIT, AUTH_CHAT_LIMIT } from "@/lib/rate-limiter";
import { parseExpertMetadata } from "@/lib/expert-metadata";

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

    // ── Parse request body (supports both JSON and FormData) ──────────────
    let message = "";
    let history: any[] = [];
    let conversationId: string | null = null;
    let mediaAttachments: MediaAttachment[] = [];

    const contentType = req.headers.get("content-type") || "";

    if (contentType.includes("multipart/form-data")) {
      // FormData path — used when chat includes file attachments
      const formData = await req.formData();
      message = (formData.get("message") as string) || "";
      conversationId = (formData.get("conversationId") as string) || null;

      const historyStr = formData.get("history") as string;
      if (historyStr) {
        try { history = JSON.parse(historyStr); } catch { history = []; }
      }

      // Process file attachment(s)
      const file = formData.get("file") as File | null;
      if (file && isMediaMimeType(file.type)) {
        const arrayBuffer = await file.arrayBuffer();
        const base64 = Buffer.from(arrayBuffer).toString("base64");
        mediaAttachments.push({
          data: base64,
          mimeType: file.type,
          filename: file.name,
        });
        console.log(`[Expert Chat] Media attachment: ${file.name} (${file.type}, ${(file.size / 1024).toFixed(0)}KB)`);
      }
    } else {
      // JSON path — standard text-only chat (existing behavior)
      const body = await req.json();
      message = body.message || "";
      history = body.history || [];
      conversationId = body.conversationId || null;
    }

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

    // Ensure conversation exists if user is authenticated
    let activeConvId = conversationId;
    if (user) {
      if (activeConvId) {
        const { data: existingConv } = await supabase
          .from("expert_conversations")
          .select("id, title")
          .eq("id", activeConvId)
          .eq("user_id", user.id)
          .eq("expert_id", expertId)
          .maybeSingle();

        if (!existingConv) {
          activeConvId = null;
        }
      }

      if (!activeConvId) {
        const cleanTitle = message.trim().slice(0, 40);
        const { data: newConv } = await supabase
          .from("expert_conversations")
          .insert({
            user_id: user.id,
            expert_id: expertId,
            title: cleanTitle || "New Conversation",
          })
          .select()
          .single();

        if (newConv) {
          activeConvId = newConv.id;
        }
      } else {
        // If existing conversation title is default, update it with user message
        const { data: conv } = await supabase
          .from("expert_conversations")
          .select("title")
          .eq("id", activeConvId)
          .single();

        if (conv && (conv.title === "New Conversation" || !conv.title)) {
          await supabase
            .from("expert_conversations")
            .update({ title: message.trim().slice(0, 40) })
            .eq("id", activeConvId);
        }
      }

      // Save user message to database
      if (activeConvId) {
        await supabase.from("expert_messages").insert({
          conversation_id: activeConvId,
          role: "user",
          content: message.trim(),
          // Store attachment metadata (not the full base64) for UI reference
          ...(mediaAttachments.length > 0 ? {
            sources: mediaAttachments.map(a => ({
              type: "attachment",
              mimeType: a.mimeType,
              filename: a.filename,
            })) as any,
          } : {}),
        });
      }
    }

    // Parse expert configuration metadata (mode, web search, etc.)
    const metadata = parseExpertMetadata(expert.description || "", expert.name);

    // Run RAG pipeline — automatically routes to Gemini if media attachments present
    const result = await generateRAGResponse(
      message.trim(),
      expertId,
      expert.system_prompt || `You are ${expert.name}, a knowledgeable expert.`,
      history || [],
      {
        reasoningMode: metadata.reasoningMode,
        webSearchEnabled: metadata.webSearchEnabled,
        mediaAttachments: mediaAttachments.length > 0 ? mediaAttachments : undefined,
      }
    );

    // Save model response to database if conversation exists
    if (user && activeConvId) {
      await supabase.from("expert_messages").insert({
        conversation_id: activeConvId,
        role: "model",
        content: result.reply,
        sources: (result.sources || []) as any,
        web_sources: (result.webSources || []) as any,
      });

      await supabase
        .from("expert_conversations")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", activeConvId);
    }

    return NextResponse.json({
      ok: true,
      reply: result.reply,
      sources: result.sources,
      webSources: result.webSources,
      conversationId: activeConvId || null,
    });
  } catch (err: any) {
    console.error("[Expert Chat] Error:", err);
    return NextResponse.json(
      { error: err.message || "Failed to generate response" },
      { status: 500 }
    );
  }
}

