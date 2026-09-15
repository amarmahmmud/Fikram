import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ingestDocument } from "@/lib/embedding";
import { describeMediaWithGemini, isMediaMimeType, getMediaCategory } from "@/lib/embedding";
import { checkRateLimit, getClientIP, EMBEDDING_LIMIT } from "@/lib/rate-limiter";
import { PDFParse, VerbosityLevel } from "pdf-parse";
import { getIngestCreditCost, checkCreditBalance, deductCredits, getUserTier, shouldUseEnterprise } from "@/lib/credits";

// Maximum file sizes per type (in bytes) - Capped at ~4.5MB for Vercel Serverless payload limits
const MAX_FILE_SIZES: Record<string, number> = {
  text: 4 * 1024 * 1024,     // 4MB for text/PDF
  image: 4 * 1024 * 1024,    // 4MB for images
  audio: 4 * 1024 * 1024,    // 4MB for audio
  video: 4 * 1024 * 1024,    // 4MB for video
};

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: expertId } = await params;
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const rateLimitKey = user ? `user_${user.id}` : `ip_${getClientIP(req)}`;
    const { allowed, resetMs } = await checkRateLimit(rateLimitKey, EMBEDDING_LIMIT);
    if (!allowed) {
      return NextResponse.json(
        { error: `Too many requests. Please try again in ${Math.ceil(resetMs / 1000 / 60)} minutes.` },
        { status: 429 }
      );
    }

    // Verify expert belongs to user
    const { data: expert } = await supabase
      .from("experts")
      .select("id")
      .eq("id", expertId)
      .eq("user_id", user.id)
      .single();

    if (!expert) {
      return NextResponse.json({ error: "Expert not found" }, { status: 404 });
    }

    // ── Parse request body (JSON) ──────────────
    const body = await req.json();
    const { url, data, mimeType, filename } = body;

    if (!filename) {
      return NextResponse.json({ error: "Filename is required" }, { status: 400 });
    }
    if (!url && !data) {
      return NextResponse.json({ error: "File URL or content data is required" }, { status: 400 });
    }

    const isMedia = isMediaMimeType(mimeType || "application/octet-stream");
    const mediaCategory = isMedia ? getMediaCategory(mimeType) : "text";

    // ── Credit check & deduction ──────────────────────────────────────────
    const { cost, action } = getIngestCreditCost(mimeType || "text/plain", isMedia);
    const { allowed: hasCredits, balance } = await checkCreditBalance(user.id, cost);
    if (!hasCredits) {
      return NextResponse.json(
        {
          error: "Insufficient credits",
          credits_required: cost,
          credits_balance: balance,
          message: `Uploading this ${mediaCategory} costs ${cost} credit${cost > 1 ? "s" : ""}. You have ${balance} remaining.`,
        },
        { status: 402 },
      );
    }

    const deducted = await deductCredits(
      user.id,
      cost,
      action,
      `Ingest ${mediaCategory}: ${filename}`,
    );
    if (!deducted) {
      return NextResponse.json({ error: "Failed to process credits" }, { status: 500 });
    }

    let text = "";

    if (isMedia) {
      // ── Media file: use Gemini to describe/transcribe ──────────────────
      console.log(`[Ingest] Processing ${mediaCategory} file "${filename}" via Gemini`);

      const { tier } = await getUserTier(user.id);
      const useEnterprise = shouldUseEnterprise(tier);

      text = await describeMediaWithGemini({
        url,
        data,
        mimeType,
        filename,
        useEnterprise,
      });

      if (!text.trim()) {
        return NextResponse.json({
          error: `Gemini could not extract content from this ${mediaCategory} file. Please try a different file.`,
        }, { status: 422 });
      }

      // Prepend a metadata header so chunks know their origin
      text = `[Source: ${mediaCategory} file "${filename}"]\n\n${text}`;

      console.log(`[Ingest] Gemini extracted ${text.length} chars from ${mediaCategory} "${filename}"`);
    } else if (filename.toLowerCase().endsWith(".pdf")) {
      // ── PDF: existing text extraction ──────────────────────────────────
      if (!url) {
        // Fallback for direct data upload for text
        return NextResponse.json({ error: "PDF ingestion requires a file URL in the new architecture" }, { status: 400 });
      }
      const res = await fetch(url);
      if (!res.ok) throw new Error("Failed to fetch PDF from storage");
      const arrayBuffer = await res.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const parser = new PDFParse({
        data: new Uint8Array(buffer),
        verbosity: VerbosityLevel.ERRORS,
      });
      const result = await parser.getText();
      text = result.text;
    } else {
      // ── Plain text, markdown, CSV, etc. ────────────────────────────────
      if (url) {
        const res = await fetch(url);
        if (!res.ok) throw new Error("Failed to fetch text from storage");
        text = await res.text();
      } else if (data) {
        text = Buffer.from(data, "base64").toString("utf-8");
      }
    }

    if (!text.trim()) {
      return NextResponse.json({ error: "File contains no extractable text" }, { status: 422 });
    }

    console.log(`[Ingest] Processing "${filename}" for expert ${expertId} (${text.length} chars, type: ${mediaCategory})`);

    // Chunk, embed, and store
    const result = await ingestDocument(expertId, text, filename);

    return NextResponse.json({
      ok: true,
      filename,
      textLength: text.length,
      chunksStored: result.chunksStored,
      mediaType: mediaCategory,
    });
  } catch (err: any) {
    console.error("[Ingest] Error:", err);
    return NextResponse.json(
      { error: err.message || "Failed to ingest document" },
      { status: 500 }
    );
  }
}

