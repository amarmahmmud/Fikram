// ─────────────────────────────────────────────
// Google Document AI — PDF Text Extraction
// ─────────────────────────────────────────────
// Uses the Document OCR processor for fast, reliable PDF text extraction.
// ~2-5 seconds for most PDFs, handles scanned/image PDFs via OCR.
// Cost: $1.50 per 1,000 pages.

import { GoogleAuth } from "google-auth-library";
import path from "path";
import fs from "fs";
import os from "os";

const LOCATION = process.env.DOCUMENT_AI_LOCATION || "us";
const PROCESSOR_ID = process.env.DOCUMENT_AI_PROCESSOR_ID || "b7d0bb5a0038c456";

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
 * Extract text from a PDF buffer using Google Document AI OCR.
 * Returns the full extracted text with structure preserved.
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

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${tokenResponse.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      rawDocument: {
        content: pdfBuffer.toString("base64"),
        mimeType: "application/pdf",
      },
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Document AI error (${response.status}): ${errorBody}`);
  }

  const result = await response.json();
  return result.document?.text || "";
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
