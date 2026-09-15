import { NextResponse } from "next/server";
import { describeMediaWithGemini } from "@/lib/embedding";

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    
    if (!file) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const data = Buffer.from(arrayBuffer).toString("base64");

    const text = await describeMediaWithGemini({
      data,
      mimeType: "application/pdf",
      filename: file.name || "document.pdf",
    });
    
    return NextResponse.json({ text });
  } catch (error: any) {
    console.error("PDF Parsing Error:", error?.message ?? error);
    return NextResponse.json({ error: "Failed to parse PDF: " + (error?.message ?? "Unknown error") }, { status: 500 });
  }
}
