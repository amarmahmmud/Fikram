import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateRAGResponse, isMediaMimeType, type MediaAttachment } from "@/lib/embedding";
import { checkRateLimit, getClientIP, ANON_CHAT_LIMIT, AUTH_CHAT_LIMIT } from "@/lib/rate-limiter";
import { parseExpertMetadata } from "@/lib/expert-metadata";
import { getChatCreditCost, checkCreditBalance, deductCredits } from "@/lib/credits";

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
    const { allowed, remaining, resetMs } = await checkRateLimit(rateLimitKey, rateLimitConfig);

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

    // Parse JSON body
    const body = await req.json();
    const { message, history, conversationId, attachment } = body;

    // Process file attachment(s)
    const mediaAttachments: MediaAttachment[] = [];
    if (attachment && isMediaMimeType(attachment.mimeType)) {
      mediaAttachments.push({
        url: attachment.url,
        data: attachment.data,
        mimeType: attachment.mimeType,
        filename: attachment.filename,
      });
      console.log(`[Expert Chat] Media attachment: ${attachment.filename} (${attachment.mimeType})`);
    }

    if (!message?.trim() && mediaAttachments.length === 0) {
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

    // ── Credit check (authenticated non-owner users only) ──────────────────
    const isOwner = user && expert.user_id === user.id;
    if (user && !isOwner) {
      const hasMedia = mediaAttachments.length > 0;
      const mediaMime = hasMedia ? mediaAttachments[0].mimeType : undefined;
      const { cost, action } = getChatCreditCost(hasMedia, mediaMime);

      const { allowed: hasCredits, balance } = await checkCreditBalance(user.id, cost);
      if (!hasCredits) {
        return NextResponse.json(
          {
            error: "Insufficient credits",
            credits_required: cost,
            credits_balance: balance,
            message: `This message costs ${cost} credit${cost > 1 ? "s" : ""}. You have ${balance} remaining.`,
          },
          { status: 402 },
        );
      }

      const deducted = await deductCredits(
        user.id,
        cost,
        action,
        `Chat: ${expert.name}${hasMedia ? ` (${mediaMime?.split("/")[0]})` : ""}`,
      );
      if (!deducted) {
        return NextResponse.json({ error: "Failed to process credits" }, { status: 500 });
      }
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

