import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isMediaMimeType, getMediaCategory } from "@/lib/embedding";
import { checkRateLimit, getClientIP, EMBEDDING_LIMIT } from "@/lib/rate-limiter";
import { getIngestCreditCost, checkCreditBalance, deductCredits } from "@/lib/credits";

// This endpoint is now fast — it only validates, deducts credits, and creates a job record.
// The heavy processing (extraction, embedding) happens in /ingest/process via multi-phase calls.
export const maxDuration = 15;

// Maximum file sizes per type (in bytes) - informational limits
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

    // ── Parse request body ──────────────
    const body = await req.json();
    const { url, mimeType, filename } = body;

    if (!filename) {
      return NextResponse.json({ error: "Filename is required" }, { status: 400 });
    }
    if (!url) {
      return NextResponse.json({ error: "File URL is required" }, { status: 400 });
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
          code: "INSUFFICIENT_CREDITS",
          status: "insufficient_credits",
          credits_required: cost,
          credits_balance: balance,
          credits_needed: Math.max(0, cost - balance),
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

    // ── Create ingest job record ──────────────────────────────────────────
    const { data: jobData, error: jobError } = await supabase
      .from("ingest_jobs")
      .insert({
        expert_id: expertId,
        user_id: user.id,
        filename,
        mime_type: effectiveMime,
        file_url: url,
        status: "processing",
        phase: "pending",
      })
      .select("id")
      .single();

    if (jobError || !jobData) {
      console.error("[Ingest] Failed to create job record:", jobError);
      return NextResponse.json({ error: "Failed to create processing job" }, { status: 500 });
    }

    console.log(`[Ingest] Created job ${jobData.id} for "${filename}" (expert: ${expertId}, type: ${mediaCategory})`);

    // ── Return immediately — frontend drives processing via /process ─────
    return NextResponse.json({
      ok: true,
      jobId: jobData.id,
      status: "processing",
      phase: "pending",
      filename,
      mediaType: mediaCategory,
    });
  } catch (err: any) {
    console.error("[Ingest] Error:", err);
    return NextResponse.json(
      { error: err.message || "Failed to initiate document processing" },
      { status: 500 }
    );
  }
}
