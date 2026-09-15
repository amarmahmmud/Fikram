import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ingestDocument } from "@/lib/embedding";
import { describeMediaWithGemini, isMediaMimeType, getMediaCategory } from "@/lib/embedding";
import { checkRateLimit, getClientIP, EMBEDDING_LIMIT } from "@/lib/rate-limiter";
import { extractPdfTextFromUrl, extractPdfText } from "@/lib/document-ai";
import { getIngestCreditCost, checkCreditBalance, deductCredits, getUserTier, shouldUseEnterprise } from "@/lib/credits";

// Allow up to 60s for large PDF parsing + embedding (Vercel Hobby max)
export const maxDuration = 60;
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

    const isPdf = filename.toLowerCase().endsWith(".pdf");
    const isMedia = isMediaMimeType(mimeType || "application/octet-stream");
    const mediaCategory = isMedia ? getMediaCategory(mimeType) : isPdf ? "document" : "text";

    // ── Credit check & deduction ──────────────────────────────────────────
    const { cost, action } = getIngestCreditCost(mimeType || "text/plain", isMedia || isPdf);
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
    if (!deducted.success) {
      return NextResponse.json({ error: `Failed to process credits: ${deducted.error}` }, { status: 500 });
    }

    let text = "";

    if (isPdf) {
      // ── PDF: use Google Document AI for fast OCR-based extraction ─────
      // ~2-5 seconds, handles both digital and scanned PDFs.
      console.log(`[Ingest] Processing PDF "${filename}" via Document AI`);

      if (url) {
        text = await extractPdfTextFromUrl(url);
      } else if (data) {
        text = await extractPdfText(Buffer.from(data, "base64"));
      }

      if (!text.trim()) {
        return NextResponse.json({
          error: "Could not extract text from this PDF. The file may be empty or corrupted.",
        }, { status: 422 });
      }

      console.log(`[Ingest] Document AI extracted ${text.length} chars from "${filename}"`);
    } else if (isMedia) {
      // ── Media (image/audio/video): use Gemini to describe/transcribe ──
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

      text = `[Source: ${mediaCategory} file "${filename}"]\n\n${text}`;

      console.log(`[Ingest] Gemini extracted ${text.length} chars from ${mediaCategory} "${filename}"`);
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

