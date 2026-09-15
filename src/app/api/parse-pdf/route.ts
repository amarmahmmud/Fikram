import { NextResponse } from "next/server";
import { getDocumentProxy } from "unpdf";

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    
    if (!file) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const pdf = await getDocumentProxy(new Uint8Array(arrayBuffer));

    // Extract text page-by-page using pdfjs directly
    const pages: string[] = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const items = (content as any).items ?? [];
      const pageText = items
        .filter((item: any) => item.str != null)
        .map((item: any) => item.str + (item.hasEOL ? "\n" : ""))
        .join("");
      pages.push(pageText);
    }
    const text = pages.join("\n");
    
    return NextResponse.json({ text });
  } catch (error: any) {
    console.error("PDF Parsing Error:", error?.message ?? error);
    return NextResponse.json({ error: "Failed to parse PDF: " + (error?.message ?? "Unknown error") }, { status: 500 });
  }
}
