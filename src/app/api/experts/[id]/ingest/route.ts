import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ingestDocument } from "@/lib/embedding";
import { describeMediaWithGemini, isMediaMimeType, getMediaCategory } from "@/lib/embedding";
import { checkRateLimit, getClientIP, EMBEDDING_LIMIT } from "@/lib/rate-limiter";
import { extractPdfTextFromUrl, extractPdfText } from "@/lib/document-ai";
import { getIngestCreditCost, checkCreditBalance, deductCredits, getUserTier } from "@/lib/credits";
import {
  routeRequest,
  executeWithFallback,
  classifyIngestTask,
  taskToVertexOp,
  type Provider,
} from "@/lib/ai-gateway";

// Allow up to 60s for large PDF parsing + embedding (Vercel Hobby max)
export const maxDuration = 60;
// Maximum file sizes per type (in bytes) - Capped at ~4.5MB for Vercel Serverless payload limits
const MAX_FILE_SIZES: Record<string, number> = {
  text: 4 * 1024 * 1024,     // 4MB for text/PDF
  image: 4 * 1024 * 1024,    // 4MB for images
  audio: 4 * 1024 * 1024,    // 4MB for audio
  video: 4 * 1024 * 1024,    // 4MB for video
};

function inferMimeType(filename: string, mimeType?: string): string {
  if (mimeType && mimeType !== "application/octet-stream" && mimeType.trim().length > 0) {
    return mimeType;
  }
  const ext = filename.toLowerCase().split(".").pop() || "";
  switch (ext) {
    case "pdf": return "application/pdf";
    case "png": return "image/png";
    case "jpg":
    case "jpeg": return "image/jpeg";
    case "webp": return "image/webp";
    case "gif": return "image/gif";
    case "heic": return "image/heic";
    case "heif": return "image/heif";
    case "mp3": return "audio/mpeg";
    case "wav": return "audio/wav";
    case "m4a": return "audio/x-m4a";
    case "ogg": return "audio/ogg";
    case "aac": return "audio/aac";
    case "flac": return "audio/flac";
    case "mp4": return "video/mp4";
    case "webm": return "video/webm";
    case "mov": return "video/quicktime";
    case "txt": return "text/plain";
    case "md": return "text/markdown";
    case "csv": return "text/csv";
    case "json": return "application/json";
    default: return mimeType || "text/plain";
  }
}

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

    const effectiveMime = inferMimeType(filename, mimeType);
    const isPdf = filename.toLowerCase().endsWith(".pdf") || effectiveMime === "application/pdf";
    const isMedia = isMediaMimeType(effectiveMime);
    const mediaCategory = isMedia ? getMediaCategory(effectiveMime) : isPdf ? "document" : "text";

    // ── Credit check & deduction ──────────────────────────────────────────
    const { cost, action } = getIngestCreditCost(effectiveMime, isMedia || isPdf);
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

    // ── AI Gateway: Determine routing ─────────────────────────────────────
    const { tier } = await getUserTier(user.id);
    const task = classifyIngestTask(effectiveMime, filename);
    const decision = await routeRequest(task, tier);
    const vertexOp = taskToVertexOp(task);

    console.log(
      `[Ingest] Route decision: ${decision.provider} → ${decision.fallback || "none"} → ${decision.secondFallback || "none"} | Reason: ${decision.reason}`,
    );

    let text = "";
    let usedProvider: Provider = decision.provider;

    if (isPdf) {
      // ── PDF: Document AI → Gemini free → Vertex AI cascade ─────────
      console.log(`[Ingest] Processing PDF "${filename}" via AI Gateway`);

      const result = await executeWithFallback<string>({
        decision,
        primaryFn: async () => {
          // Document AI path
          if (url) {
            return await extractPdfTextFromUrl(url);
          } else if (data) {
            return await extractPdfText(Buffer.from(data, "base64"));
          }
          throw new Error("No URL or data for PDF");
        },
        fallbackFn: decision.fallback ? async () => {
          // Gemini free or Vertex AI fallback — use Gemini to describe the PDF
          console.log(`[Ingest] PDF fallback: using ${decision.fallback} for "${filename}"`);
          return await describeMediaWithGemini({
            url,
            data,
            mimeType: "application/pdf",
            filename,
            useEnterprise: decision.fallback === "vertex-ai",
          });
        } : undefined,
        secondFallbackFn: decision.secondFallback ? async () => {
          // Vertex AI as last resort
          console.log(`[Ingest] PDF second fallback: using Vertex AI for "${filename}"`);
          return await describeMediaWithGemini({
            url,
            data,
            mimeType: "application/pdf",
            filename,
            useEnterprise: true,
          });
        } : undefined,
        vertexOp,
        vertexUnits: 1,
      });

      text = result.result;
      usedProvider = result.usedProvider;

      if (!text.trim()) {
        return NextResponse.json({
          error: "Could not extract text from this PDF. The file may be empty or corrupted.",
        }, { status: 422 });
      }

      console.log(`[Ingest] Extracted ${text.length} chars from "${filename}" via ${usedProvider}`);
    } else if (isMedia) {
      // ── Media (image/audio/video): Gemini free → Vertex AI cascade ──
      console.log(`[Ingest] Processing ${mediaCategory} file "${filename}" via AI Gateway`);

      const result = await executeWithFallback<string>({
        decision,
        primaryFn: async () => {
          return await describeMediaWithGemini({
            url,
            data,
            mimeType: effectiveMime,
            filename,
            useEnterprise: decision.useEnterprise,
          });
        },
        fallbackFn: decision.fallback ? async () => {
          console.log(`[Ingest] Media fallback: using ${decision.fallback} for "${filename}"`);
          return await describeMediaWithGemini({
            url,
            data,
            mimeType: effectiveMime,
            filename,
            useEnterprise: decision.fallback === "vertex-ai",
          });
        } : undefined,
        vertexOp,
        vertexUnits: 1,
      });

      text = result.result;
      usedProvider = result.usedProvider;

      if (!text.trim()) {
        return NextResponse.json({
          error: `Could not extract content from this ${mediaCategory} file. Please try a different file.`,
        }, { status: 422 });
      }

      text = `[Source: ${mediaCategory} file "${filename}"]\n\n${text}`;
      console.log(`[Ingest] Extracted ${text.length} chars from ${mediaCategory} "${filename}" via ${usedProvider}`);
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

    console.log(`[Ingest] Processing "${filename}" for expert ${expertId} (${text.length} chars, type: ${mediaCategory}, provider: ${usedProvider})`);

    // Chunk, embed, and store
    const result = await ingestDocument(expertId, text, filename);

    return NextResponse.json({
      ok: true,
      filename,
      textLength: text.length,
      chunksStored: result.chunksStored,
      mediaType: mediaCategory,
      provider: usedProvider,
    });
  } catch (err: any) {
    console.error("[Ingest] Error:", err);
    return NextResponse.json(
      { error: err.message || "Failed to ingest document" },
      { status: 500 }
    );
  }
}
