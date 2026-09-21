import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ingestDocument, chunkForRetrieval, embedTexts } from "@/lib/embedding";
import { describeMediaWithGemini, isMediaMimeType, getMediaCategory } from "@/lib/embedding";
import { extractPdfTextFromUrl, extractPdfText } from "@/lib/document-ai";
import {
  routeRequest,
  executeWithFallback,
  classifyIngestTask,
  taskToVertexOp,
  type Provider,
} from "@/lib/ai-gateway";
import { getUserTier } from "@/lib/credits";

// Vercel Hobby hard cap — 60s gives extraction enough headroom for large PDFs
export const maxDuration = 60;

// Embedding batch size per invocation — 10 chunks × ~0.5s each ≈ 5-7s
// Leaves ~6-8s headroom for overhead within the 15s Hobby cap
const EMBED_BATCH_SIZE = 10;

/**
 * POST /api/experts/{id}/ingest/process
 *
 * Multi-phase processing endpoint designed for Vercel Hobby's 15s limit.
 * The frontend calls this repeatedly for the same job, each call advancing
 * one phase. Each phase completes well under 15 seconds.
 *
 * Phase lifecycle:
 *   pending   → extract text from file, store in DB           (~3-10s)
 *   extracted → chunk text, embed batch 0, store chunks       (~5-10s)
 *   embedding:N → embed batch N, store chunks                 (~5-10s)
 *   completed → done (no more calls needed)
 *   failed    → terminal error
 *
 * The frontend drives the pipeline by calling this endpoint in a loop
 * until the job reaches 'completed' or 'failed' status.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: expertId } = await params;
    const body = await req.json();
    const { jobId } = body;

    if (!jobId) {
      return NextResponse.json({ error: "jobId is required" }, { status: 400 });
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    // Fetch the job
    const { data: job, error: jobError } = await supabase
      .from("ingest_jobs")
      .select("*")
      .eq("id", jobId)
      .eq("user_id", user.id)
      .single();

    if (jobError || !job) {
      return NextResponse.json({ error: "Ingest job not found" }, { status: 404 });
    }

    // Already done — idempotent
    if (job.status === "completed") {
      return NextResponse.json({
        ok: true,
        status: "completed",
        phase: "completed",
        chunksStored: job.chunks_stored,
      });
    }

    if (job.status === "failed") {
      return NextResponse.json({
        ok: false,
        status: "failed",
        phase: "failed",
        error: job.error,
      });
    }

    const phase = job.phase || "pending";

    // ═══════════════════════════════════════════════════════════════════════
    // PHASE 1: EXTRACT TEXT  (pending → extracted)
    // ═══════════════════════════════════════════════════════════════════════
    if (phase === "pending") {
      return await handleExtractPhase(supabase, job, expertId);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // PHASE 2+: EMBED & STORE  (extracted / embedding:N → completed)
    // ═══════════════════════════════════════════════════════════════════════
    if (phase === "extracted" || phase.startsWith("embedding:")) {
      return await handleEmbedPhase(supabase, job, expertId);
    }

    return NextResponse.json({ error: `Unknown phase: ${phase}` }, { status: 400 });
  } catch (err: any) {
    console.error("[Ingest Process] Unhandled error:", err);
    return NextResponse.json({ error: err.message || "Processing failed" }, { status: 500 });
  }
}


// ── Phase 1: Extract text from file ──────────────────────────────────────────

async function handleExtractPhase(
  supabase: any,
  job: any,
  expertId: string,
) {
  const { id: jobId, filename, file_url: url, mime_type: mimeType, user_id: userId } = job;

  try {
    const effectiveMime = inferMimeType(filename, mimeType);
    const isPdf = filename.toLowerCase().endsWith(".pdf") || effectiveMime === "application/pdf";
    const isMedia = isMediaMimeType(effectiveMime);
    const mediaCategory = isMedia ? getMediaCategory(effectiveMime) : isPdf ? "document" : "text";

    // AI Gateway routing
    const { tier } = await getUserTier(userId);
    const task = classifyIngestTask(effectiveMime, filename);
    const decision = await routeRequest(task, tier);
    const vertexOp = taskToVertexOp(task);

    console.log(`[Ingest Extract] "${filename}" | Route: ${decision.provider} → ${decision.fallback || "none"} | Job: ${jobId}`);

    let text = "";
    let usedProvider: Provider = decision.provider;

    if (isPdf) {
      const result = await executeWithFallback<string>({
        decision,
        primaryFn: async () => {
          if (url) return await extractPdfTextFromUrl(url);
          throw new Error("No URL for PDF");
        },
        fallbackFn: decision.fallback ? async () => {
          console.log(`[Ingest Extract] PDF fallback: ${decision.fallback} for "${filename}"`);
          return await describeMediaWithGemini({
            url: url || undefined,
            mimeType: "application/pdf",
            filename,
            useEnterprise: decision.fallback === "vertex-ai",
          });
        } : undefined,
        secondFallbackFn: decision.secondFallback ? async () => {
          console.log(`[Ingest Extract] PDF 2nd fallback: Vertex AI for "${filename}"`);
          return await describeMediaWithGemini({
            url: url || undefined,
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
        await markJobFailed(supabase, jobId, "Could not extract text from this PDF. The file may be empty or corrupted.");
        return NextResponse.json({ ok: false, status: "failed", error: "No text extracted from PDF" });
      }
    } else if (isMedia) {
      const result = await executeWithFallback<string>({
        decision,
        primaryFn: async () => {
          return await describeMediaWithGemini({
            url: url || undefined,
            mimeType: effectiveMime,
            filename,
            useEnterprise: decision.useEnterprise,
          });
        },
        fallbackFn: decision.fallback ? async () => {
          console.log(`[Ingest Extract] Media fallback: ${decision.fallback} for "${filename}"`);
          return await describeMediaWithGemini({
            url: url || undefined,
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
        await markJobFailed(supabase, jobId, `Could not extract content from this ${mediaCategory} file.`);
        return NextResponse.json({ ok: false, status: "failed", error: "No content extracted" });
      }

      text = `[Source: ${mediaCategory} file "${filename}"]\n\n${text}`;
    } else {
      // Plain text, markdown, CSV, etc.
      if (url) {
        const res = await fetch(url);
        if (!res.ok) throw new Error("Failed to fetch text from storage");
        text = await res.text();
      }
    }

    if (!text.trim()) {
      await markJobFailed(supabase, jobId, "File contains no extractable text.");
      return NextResponse.json({ ok: false, status: "failed", error: "No text" });
    }

    console.log(`[Ingest Extract] ✓ Extracted ${text.length} chars from "${filename}" via ${usedProvider}`);

    // Store extracted text and advance to embed phase
    await supabase
      .from("ingest_jobs")
      .update({
        phase: "extracted",
        extracted_text: text,
        provider: usedProvider,
      })
      .eq("id", jobId);

    return NextResponse.json({
      ok: true,
      status: "processing",
      phase: "extracted",
      textLength: text.length,
      provider: usedProvider,
    });
  } catch (err: any) {
    console.error(`[Ingest Extract] Error for "${filename}":`, err);
    const friendlyError = translateError(err.message);
    await markJobFailed(supabase, jobId, friendlyError);
    return NextResponse.json({ ok: false, status: "failed", error: friendlyError });
  }
}


// ── Phase 2+: Chunk, embed batch, store ──────────────────────────────────────

async function handleEmbedPhase(
  supabase: any,
  job: any,
  expertId: string,
) {
  const {
    id: jobId,
    filename,
    file_url: url,
    mime_type: mimeType,
    extracted_text: extractedText,
    phase,
    chunks_stored: previouslyStored,
  } = job;

  try {
    if (!extractedText || !extractedText.trim()) {
      await markJobFailed(supabase, jobId, "No extracted text found — extraction phase may have failed.");
      return NextResponse.json({ ok: false, status: "failed", error: "No extracted text" });
    }

    const effectiveMime = inferMimeType(filename, mimeType);
    const isPdf = filename.toLowerCase().endsWith(".pdf") || effectiveMime === "application/pdf";
    const isMedia = isMediaMimeType(effectiveMime);
    const mediaCategory = isMedia ? getMediaCategory(effectiveMime) : isPdf ? "document" : "text";

    // Chunk the full text (deterministic, fast <100ms, safe to re-run)
    const allChunks = chunkForRetrieval(extractedText, {
      docType: mediaCategory,
      mediaUrl: url || undefined,
    });

    const totalChunks = allChunks.length;

    // Determine batch offset from phase
    const batchOffset = phase.startsWith("embedding:")
      ? parseInt(phase.split(":")[1], 10) || 0
      : 0;

    const batchEnd = Math.min(batchOffset + EMBED_BATCH_SIZE, totalChunks);
    const batchChunks = allChunks.slice(batchOffset, batchEnd);

    if (batchChunks.length === 0) {
      // Edge case: no chunks to process, mark completed
      await supabase
        .from("ingest_jobs")
        .update({
          status: "completed",
          phase: "completed",
          chunks_stored: previouslyStored || 0,
          total_chunks: totalChunks,
          extracted_text: null, // Clean up stored text
        })
        .eq("id", jobId);

      return NextResponse.json({
        ok: true,
        status: "completed",
        phase: "completed",
        chunksStored: previouslyStored || 0,
        totalChunks,
      });
    }

    console.log(
      `[Ingest Embed] "${filename}" batch [${batchOffset}..${batchEnd - 1}] of ${totalChunks} chunks (job: ${jobId})`
    );

    // Embed this batch
    const embeddings = await embedTexts(batchChunks.map((c) => c.content));

    // Build rows for Supabase insert
    const rows = batchChunks.map((chunk, i) => ({
      expert_id: expertId,
      content: chunk.content,
      embedding: `[${(embeddings[i] || []).join(",")}]`,
      source_filename: filename,
      chunk_index: batchOffset + i,
      section_title: chunk.sectionTitle,
      section_tier: chunk.sectionTier,
      section_index: chunk.sectionIndex,
      page_number: chunk.pageNumber ?? null,
      doc_type: chunk.docType ?? mediaCategory,
      media_url: chunk.mediaUrl ?? url ?? null,
      timestamp_range: chunk.timestampRange ?? null,
    }));

    // Insert this batch of chunks
    const { error: insertError } = await supabase.from("expert_chunks").insert(rows);
    if (insertError) {
      console.error(`[Ingest Embed] Failed to insert chunks batch:`, insertError);
      throw new Error(`Failed to store chunks: ${insertError.message}`);
    }

    const totalStored = (previouslyStored || 0) + rows.length;

    // Check if we're done
    if (batchEnd >= totalChunks) {
      // All batches complete — mark job as done and clean up extracted text
      await supabase
        .from("ingest_jobs")
        .update({
          status: "completed",
          phase: "completed",
          chunks_stored: totalStored,
          total_chunks: totalChunks,
          extracted_text: null,
        })
        .eq("id", jobId);

      console.log(`[Ingest Embed] ✓ Completed "${filename}" — ${totalStored} chunks stored (job: ${jobId})`);

      return NextResponse.json({
        ok: true,
        status: "completed",
        phase: "completed",
        chunksStored: totalStored,
        totalChunks,
      });
    } else {
      // More batches needed — save progress, frontend will call again
      const nextPhase = `embedding:${batchEnd}`;

      await supabase
        .from("ingest_jobs")
        .update({
          phase: nextPhase,
          chunks_stored: totalStored,
          total_chunks: totalChunks,
        })
        .eq("id", jobId);

      console.log(
        `[Ingest Embed] "${filename}" progress: ${totalStored}/${totalChunks} chunks stored, next batch at ${batchEnd}`
      );

      return NextResponse.json({
        ok: true,
        status: "processing",
        phase: nextPhase,
        chunksStored: totalStored,
        totalChunks,
      });
    }
  } catch (err: any) {
    console.error(`[Ingest Embed] Error for "${filename}":`, err);
    const friendlyError = translateError(err.message);
    await markJobFailed(supabase, jobId, friendlyError);
    return NextResponse.json({ ok: false, status: "failed", error: friendlyError });
  }
}


// ── Helpers ──────────────────────────────────────────────────────────────────

async function markJobFailed(supabase: any, jobId: string, error: string) {
  await supabase
    .from("ingest_jobs")
    .update({
      status: "failed",
      error,
      retry_count: (await supabase
        .from("ingest_jobs")
        .select("retry_count")
        .eq("id", jobId)
        .single()
        .then(({ data }: any) => (data?.retry_count || 0) + 1)),
    })
    .eq("id", jobId);
}

function translateError(message: string): string {
  if (!message) return "Failed to process document";
  if (message.includes("Failed to embed text") || message.includes("429") || message.includes("Quota") || message.includes("busy")) {
    return "AI indexing service is busy. Please try again in a moment.";
  }
  if (message.includes("PAGE_LIMIT_EXCEEDED") || message.includes("page limit")) {
    return "This document exceeds the page limit. Please split it into smaller documents.";
  }
  if (message.includes("timed out") || message.includes("timeout") || message.includes("504")) {
    return "Document processing timed out. Try a smaller file or split it into sections.";
  }
  if (message.includes("No extractable text") || message.includes("Could not extract text")) {
    return "Could not extract readable text. Please verify the file contains text and is not encrypted.";
  }
  return message;
}

function inferMimeType(filename: string, mimeType?: string | null): string {
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
