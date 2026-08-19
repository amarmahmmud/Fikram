import { NextResponse } from "next/server";
import { PDFParse, VerbosityLevel } from "pdf-parse";

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    
    if (!file) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    
    // pdf-parse v2: pass data in constructor, getText() returns TextResult
    const parser = new PDFParse({
      data: new Uint8Array(buffer),
      verbosity: VerbosityLevel.ERRORS,
    });
    const result = await parser.getText();
    
    return NextResponse.json({ text: result.text });
  } catch (error: any) {
    console.error("PDF Parsing Error:", error?.message ?? error);
    return NextResponse.json({ error: "Failed to parse PDF: " + (error?.message ?? "Unknown error") }, { status: 500 });
  }
}
