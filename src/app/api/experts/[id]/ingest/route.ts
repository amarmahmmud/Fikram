import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ingestDocument } from "@/lib/embedding";
import { describeMediaWithGemini, isMediaMimeType, getMediaCategory } from "@/lib/embedding";
import { PDFParse, VerbosityLevel } from "pdf-parse";

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

    // Parse the uploaded file
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

    const filename = file.name;
    const mimeType = file.type || "application/octet-stream";
    const fileSize = file.size;
    const isMedia = isMediaMimeType(mimeType);
    const mediaCategory = isMedia ? getMediaCategory(mimeType) : "text";

    // Check file size limits
    const sizeLimit = MAX_FILE_SIZES[mediaCategory] ?? MAX_FILE_SIZES.text;
    if (fileSize > sizeLimit) {
      return NextResponse.json({
        error: `File too large. Maximum size for ${mediaCategory} files is ${Math.round(sizeLimit / 1024 / 1024)}MB.`,
      }, { status: 413 });
    }

    let text = "";

    if (isMedia) {
      // ── Media file: use Gemini to describe/transcribe ──────────────────
      console.log(`[Ingest] Processing ${mediaCategory} file "${filename}" (${(fileSize / 1024).toFixed(0)}KB) via Gemini`);

      const base64 = Buffer.from(await file.arrayBuffer()).toString("base64");

      text = await describeMediaWithGemini({
        data: base64,
        mimeType,
        filename,
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
      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const parser = new PDFParse({
        data: new Uint8Array(buffer),
        verbosity: VerbosityLevel.ERRORS,
      });
      const result = await parser.getText();
      text = result.text;
    } else {
      // ── Plain text, markdown, CSV, etc. ────────────────────────────────
      text = await file.text();
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

