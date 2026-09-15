// ─────────────────────────────────────────────
// Google Document AI — PDF Text Extraction
// ─────────────────────────────────────────────
// Uses the Document OCR processor for fast, reliable PDF text extraction.
// ~2-5 seconds for most PDFs, handles scanned/image PDFs via OCR.
// Cost: $1.50 per 1,000 pages.
//
// Large PDFs (>30 pages) are automatically split into parallel batches
// since Document AI online processing has a 30-page-per-request limit.

import { GoogleAuth } from "google-auth-library";
import path from "path";
import fs from "fs";
import os from "os";

const LOCATION = process.env.DOCUMENT_AI_LOCATION || "us";
const PROCESSOR_ID = process.env.DOCUMENT_AI_PROCESSOR_ID || "b7d0bb5a0038c456";
const PAGES_PER_BATCH = 30;

/**
 * Ensures GCP credentials are available for Document AI auth.
 * Reuses the same credential setup as the Gemini/Vertex AI integration.
 */
function ensureCredentials() {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) return;

  const credentialsJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  if (credentialsJson) {
    const tmpPath = path.join(os.tmpdir(), "gcp-key.json");
    if (!fs.existsSync(tmpPath)) {
      fs.writeFileSync(tmpPath, credentialsJson, { mode: 0o600 });
    }
    process.env.GOOGLE_APPLICATION_CREDENTIALS = tmpPath;
    return;
  }

  const defaultKeyPath = path.resolve(process.cwd(), "gcp-key.json");
  if (fs.existsSync(defaultKeyPath)) {
    process.env.GOOGLE_APPLICATION_CREDENTIALS = defaultKeyPath;
  }
}

/**
 * Call Document AI for a specific set of pages (or all pages if none specified).
 */
async function callDocumentAI(
  pdfBase64: string,
  token: string,
  endpoint: string,
  pages?: number[]
): Promise<string> {
  const body: any = {
    rawDocument: {
      content: pdfBase64,
      mimeType: "application/pdf",
    },
  };

  if (pages) {
    body.processOptions = {
      individualPageSelector: { pages },
    };
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Document AI error (${response.status}): ${errorBody}`);
  }

  const result = await response.json();
  return result.document?.text || "";
}

/**
 * Extract text from a PDF buffer using Google Document AI OCR.
 * Automatically batches large PDFs (>30 pages) into parallel requests.
 */
export async function extractPdfText(pdfBuffer: Buffer): Promise<string> {
  ensureCredentials();

  const projectId = process.env.GOOGLE_CLOUD_PROJECT;
  if (!projectId) {
    throw new Error("GOOGLE_CLOUD_PROJECT env var is required for Document AI");
  }

  const endpoint = `https://${LOCATION}-documentai.googleapis.com/v1/projects/${projectId}/locations/${LOCATION}/processors/${PROCESSOR_ID}:process`;

  const auth = new GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
  });
  const client = await auth.getClient();
  const tokenResponse = await client.getAccessToken();
  const token = tokenResponse.token!;
  const pdfBase64 = pdfBuffer.toString("base64");

  // Try processing all pages at once first (fast path for small PDFs)
  try {
    return await callDocumentAI(pdfBase64, token, endpoint);
  } catch (err: any) {
    // If it's not a page limit error, rethrow
    if (!err.message?.includes("PAGE_LIMIT_EXCEEDED")) {
      throw err;
    }

    // Extract total page count from the error
    const pageMatch = err.message.match(/"pages":\s*"(\d+)"/);
    const totalPages = pageMatch ? parseInt(pageMatch[1], 10) : 0;
    if (!totalPages) throw err;

    console.log(`[Document AI] PDF has ${totalPages} pages, splitting into batches of ${PAGES_PER_BATCH}...`);

    // Build batches of page numbers (1-indexed)
    const batches: number[][] = [];
    for (let start = 1; start <= totalPages; start += PAGES_PER_BATCH) {
      const batch: number[] = [];
      for (let p = start; p < start + PAGES_PER_BATCH && p <= totalPages; p++) {
        batch.push(p);
      }
      batches.push(batch);
    }

    // Process all batches in parallel
    const results = await Promise.all(
      batches.map((pages) => callDocumentAI(pdfBase64, token, endpoint, pages))
    );

    return results.join("\n");
  }
}

/**
 * Extract text from a PDF at a URL using Google Document AI.
 * Downloads the PDF first, then sends to Document AI.
 */
export async function extractPdfTextFromUrl(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download PDF: ${res.statusText}`);
  const arrayBuffer = await res.arrayBuffer();
  return extractPdfText(Buffer.from(arrayBuffer));
}
