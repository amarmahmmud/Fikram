import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ingestDocument } from "@/lib/embedding";
import { PDFParse, VerbosityLevel } from "pdf-parse";

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

    let text = "";
    const filename = file.name;

    if (filename.toLowerCase().endsWith(".pdf")) {
      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const parser = new PDFParse({
        data: new Uint8Array(buffer),
        verbosity: VerbosityLevel.ERRORS,
      });
      const result = await parser.getText();
      text = result.text;
    } else {
      // Plain text, markdown, etc.
      text = await file.text();
    }

    if (!text.trim()) {
      return NextResponse.json({ error: "File contains no extractable text" }, { status: 422 });
    }

    console.log(`[Ingest] Processing "${filename}" for expert ${expertId} (${text.length} chars)`);

    // Chunk, embed, and store
    const result = await ingestDocument(expertId, text, filename);

    return NextResponse.json({
      ok: true,
      filename,
      textLength: text.length,
      chunksStored: result.chunksStored,
    });
  } catch (err: any) {
    console.error("[Ingest] Error:", err);
    return NextResponse.json(
      { error: err.message || "Failed to ingest document" },
      { status: 500 }
    );
  }
}
