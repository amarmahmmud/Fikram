// ─────────────────────────────────────────────
// Embedding & Retrieval Library for RAG
// ─────────────────────────────────────────────
// Uses Gemini text-embedding-004 (free, 768 dimensions) for embeddings
// and Supabase pgvector for storage + similarity search.
//
// CHANGELOG (this version):
// - Multimodal support: text-only → Groq (free/fast), media → Gemini 3.5/3.6 Flash
// - Section-aware chunking: splits on the document's own numbered/heading
//   structure BEFORE falling back to char-based splitting, so a chunk never
//   silently straddles two different sections.
// - Section metadata stored per chunk (section_title, section_tier) so the
//   retriever/generator can tell a numbered "major" section apart from a
//   bulleted "additional/minor" one, instead of relying on embedding
//   similarity alone.
// - Adaptive topK: broad/summarization-style queries ("summarize", "all",
//   "list", "each", "every") pull more chunks than narrow factual queries.
// - match_threshold left configurable per call.

import { GoogleGenAI } from "@google/genai";
import Groq from "groq-sdk";
import { createClient } from "@/lib/supabase/server";
import { searchWeb, WebSearchResult } from "@/lib/web-search";
import { generateWithModelFallback, RESILIENT_GEMINI_MODELS, uploadFileFromUrl, deleteGeminiFile, getGeminiApiKeys, getEnterpriseClient } from "@/lib/gemini";
import { trackVertexSpend } from "@/lib/vertex-budget";
import { cleanRepetitionLoop } from "@/lib/text-cleaner";

// ── Gemini Key Pool Management & Round-Robin Rotation ───────────────────────
let currentEmbedKeyIndex = 0;
// Map of apiKey -> timestamp until which the key is on cooldown (after a 429)
const embedKeyCooldowns = new Map<string, number>();

function getNextHealthyKey(): { client: GoogleGenAI; key: string } {
  const keys = getGeminiApiKeys();
  if (keys.length === 0) throw new Error("No Gemini API keys found for embeddings");
  const now = Date.now();

  // 1. Try finding a key that is NOT on cooldown, rotating on EVERY single call
  for (let i = 0; i < keys.length; i++) {
    const candidateIdx = (currentEmbedKeyIndex + i) % keys.length;
    const candidateKey = keys[candidateIdx];
    const cooldownUntil = embedKeyCooldowns.get(candidateKey) || 0;
    if (now >= cooldownUntil) {
      currentEmbedKeyIndex = (candidateIdx + 1) % keys.length;
      return { client: new GoogleGenAI({ apiKey: candidateKey }), key: candidateKey };
    }
  }

  // 2. All keys are currently cooling down: pick the one that cools down earliest
  let bestIdx = 0;
  let minCooldown = Infinity;
  for (let i = 0; i < keys.length; i++) {
    const cooldownUntil = embedKeyCooldowns.get(keys[i]) || 0;
    if (cooldownUntil < minCooldown) {
      minCooldown = cooldownUntil;
      bestIdx = i;
    }
  }
  currentEmbedKeyIndex = (bestIdx + 1) % keys.length;
  return { client: new GoogleGenAI({ apiKey: keys[bestIdx] }), key: keys[bestIdx] };
}

function markKeyQuotaCooling(key: string, durationMs = 60_000) {
  embedKeyCooldowns.set(key, Date.now() + durationMs);
}
// ── Groq Key Rotation (doubles effective RPM) ────────────────────────────────

function getGroqApiKeys(): string[] {
  const keysStr = process.env.GROQ_API_KEYS;
  if (keysStr) {
    return keysStr.split(",").map((k) => k.trim()).filter(Boolean);
  }
  const single = process.env.GROQ_API_KEY;
  if (single) return [single];
  return [];
}

let currentGroqKeyIndex = 0;

/**
 * Get a Groq client with round-robin key rotation.
 * Each call advances to the next key for natural load balancing.
 */
function getGroqClient(): Groq {
  const keys = getGroqApiKeys();
  if (keys.length === 0) throw new Error("No Groq API keys configured (GROQ_API_KEYS or GROQ_API_KEY)");
  const key = keys[currentGroqKeyIndex % keys.length];
  currentGroqKeyIndex = (currentGroqKeyIndex + 1) % keys.length;
  return new Groq({ apiKey: key });
}

// ── Media Attachment Types ───────────────────────────────────────────────────

export interface MediaAttachment {
  /** If present, the URL to download the file from (e.g. Cloudflare R2) */
  url?: string;
  /** base64-encoded file data (fallback for small files) */
  data?: string;
  /** MIME type, e.g. "image/png", "audio/mp3", "video/mp4" */
  mimeType: string;
  /** Original filename for display */
  filename?: string;
}

const IMAGE_MIME_TYPES = new Set([
  "image/png", "image/jpeg", "image/webp", "image/gif", "image/heic", "image/heif",
]);
const AUDIO_MIME_TYPES = new Set([
  "audio/mpeg", "audio/mp3", "audio/wav", "audio/ogg", "audio/webm",
  "audio/mp4", "audio/x-m4a", "audio/aac", "audio/flac",
]);
const VIDEO_MIME_TYPES = new Set([
  "video/mp4", "video/webm", "video/ogg", "video/quicktime",
]);

export function isMediaMimeType(mimeType: string): boolean {
  return IMAGE_MIME_TYPES.has(mimeType) || AUDIO_MIME_TYPES.has(mimeType) || VIDEO_MIME_TYPES.has(mimeType);
}

export function getMediaCategory(mimeType: string): "image" | "audio" | "video" | "unknown" {
  if (IMAGE_MIME_TYPES.has(mimeType)) return "image";
  if (AUDIO_MIME_TYPES.has(mimeType)) return "audio";
  if (VIDEO_MIME_TYPES.has(mimeType)) return "video";
  return "unknown";
}

/**
 * Use Gemini to describe/transcribe a media file (image, audio, or video)
 * for ingestion into the knowledge base. Returns a text description that
 * can be chunked and embedded like any other document.
 */
export async function describeMediaWithGemini({
  url,
  data,
  mimeType,
  filename,
  useEnterprise,
}: {
  url?: string;
  data?: string;
  mimeType: string;
  filename: string;
  /** Route through Vertex AI (paid) or free API keys */
  useEnterprise?: boolean;
}): Promise<string> {
  const parts: any[] = [];
  let fileUri: string | null = null;
  let pinnedApiKey: string | undefined;

  if (data) {
    parts.push({ inlineData: { data, mimeType } });
  } else if (url) {
    let handledInline = false;
    try {
      const res = await fetch(url);
      if (res.ok) {
        const buffer = Buffer.from(await res.arrayBuffer());
        if (buffer.length <= 20 * 1024 * 1024 || useEnterprise) {
          parts.push({ inlineData: { data: buffer.toString("base64"), mimeType } });
          handledInline = true;
        }
      }
    } catch (downloadErr) {
      console.warn("[describeMediaWithGemini] Direct download failed, falling back to File API:", downloadErr);
    }

    if (!handledInline) {
      // Upload via Gemini File API (handles large files without timeout).
      // The upload returns the API key it used — we pin the generation request
      // to the same key, since Gemini files are scoped per API key.
      const upload = await uploadFileFromUrl(url, mimeType);
      fileUri = upload.fileUri;
      pinnedApiKey = upload.apiKey || undefined;
      parts.push({ fileData: { fileUri, mimeType } });
    }
  } else {
    throw new Error("Must provide either url or data");
  }

  const isVideo = mimeType.startsWith("video/");
  const isAudio = mimeType.startsWith("audio/");
  const isPdf = mimeType === "application/pdf";

  let prompt: string;
  if (isPdf) {
    prompt = `Extract ALL text content from this PDF document verbatim. `;
    prompt += `Preserve the document's structure: headings, paragraphs, lists, tables, and any visible text. `;
    prompt += `For each page, output a delimiter on its own line exactly like '--- [Page X] ---' before that page's text (where X is 1, 2, 3...). `;
    prompt += `If the PDF contains scanned/image pages, use OCR to extract the text. `;
    prompt += `Output the full extracted text as a clean, structured document. Do NOT summarize or paraphrase — extract the actual content.`;
  } else {
    prompt = `Describe the contents of this ${isVideo ? "video" : isAudio ? "audio" : "image"} in high detail. `;
    prompt += `Include all spoken words, visible text (OCR), key subjects, and important events. `;
    if (isVideo || isAudio) {
      prompt += `Include approximate timestamp ranges in brackets, e.g. [00:15 - 00:45] or [01:20], at the beginning of each topic, section, or speaker turn. `;
    }
    prompt += `Format the output as a clear, structured document that can be used for a knowledge base.`;
  }

  parts.push({ text: prompt });

  try {
    const result = await generateWithModelFallback([{ role: "user", parts }], {
      systemInstruction: "You are an expert transcriber and visual analyst. Your job is to convert media into highly accurate, detailed textual knowledge bases.",
      generationConfig: { temperature: 0.1 },
      useEnterprise,
      pinnedApiKey,
    });
    
    if (fileUri) {
      deleteGeminiFile(fileUri).catch(console.error);
    }
    
    return result.text();
  } catch (err) {
    if (fileUri) {
      deleteGeminiFile(fileUri).catch(console.error);
    }
    throw err;
  }
}

// ── Embedding ────────────────────────────────────────────────────────────────

const VERTEX_EMBEDDING_MODEL = "text-embedding-004";
const GEMINI_EMBEDDING_MODEL = "gemini-embedding-001";
const EMBEDDING_DIMENSIONS = 768;

/**
 * Helper to pause execution.
 */
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Extracts retry delay from Gemini API 429 errors or falls back to exponential backoff.
 */
function getRetryDelay(err: any, attempt: number): number {
  if (err?.errorDetails && Array.isArray(err.errorDetails)) {
    const retryInfo = err.errorDetails.find(
      (d: any) => d["@type"] === "type.googleapis.com/google.rpc.RetryInfo"
    );
    if (retryInfo?.retryDelay) {
      const match = retryInfo.retryDelay.match(/([\d.]+)/);
      if (match) return Math.ceil(parseFloat(match[1]) * 1000);
    }
  }

  if (err?.message) {
    const match = err.message.match(/retry in ([\d.]+)s/i);
    if (match) return Math.ceil(parseFloat(match[1]) * 1000);
  }

  const baseDelay = Math.pow(2, attempt) * 4000;
  const jitter = baseDelay * 0.2 * Math.random();
  return baseDelay + jitter;
}

/**
 * Generate an embedding vector for a single text string.
 * PRIMARY: Vertex AI Enterprise (text-embedding-004, high throughput, zero 15 RPM bottlenecks).
 * FALLBACK: Gemini Free API Key Pool with round-robin rotation.
 */
export async function embedText(text: string): Promise<number[]> {
  // ── 1. PRIMARY: Vertex AI Enterprise ───────────────────────────────────────
  try {
    const enterpriseClient = getEnterpriseClient();
    const result = await enterpriseClient.models.embedContent({
      model: VERTEX_EMBEDDING_MODEL,
      contents: text,
      config: { outputDimensionality: EMBEDDING_DIMENSIONS },
    });
    trackVertexSpend("embed_text", Math.ceil(text.length / 1000)).catch(console.error);
    return result.embeddings?.[0]?.values || [];
  } catch (vertexErr: any) {
    console.warn(`[Embedding] Vertex AI primary unavailable (${vertexErr.message}), falling back to Gemini API keys...`);
  }

  // ── 2. FALLBACK: Free Gemini API Key Pool ───────────────────────────────────
  let attempts = 0;

  while (attempts < 5) {
    attempts++;
    const { client, key } = getNextHealthyKey();

    try {
      const result = await client.models.embedContent({
        model: GEMINI_EMBEDDING_MODEL,
        contents: text,
        config: { outputDimensionality: EMBEDDING_DIMENSIONS },
      });
      return result.embeddings?.[0]?.values || [];
    } catch (err: any) {
      const isQuota = err.status === 429 || err.message?.includes("429") || err.message?.includes("Quota");

      if (isQuota) {
        markKeyQuotaCooling(key, 60_000);
        console.warn(`[Embedding] Gemini key 429 quota hit (attempt ${attempts}/5)...`);

        const keys = getGeminiApiKeys();
        if (keys.length > 1 && attempts < keys.length) {
          await delay(100);
          continue;
        }

        if (attempts < 5) {
          const delayMs = Math.min(6000, getRetryDelay(err, attempts));
          console.warn(`[Embedding] All keys cooling down, retrying in ${Math.round(delayMs / 1000)}s...`);
          await delay(delayMs);
          continue;
        }
      }
    }
  }

  throw new Error("AI embedding service is busy. Please try again in a moment or upload a shorter document.");
}

/**
 * Generate embeddings for multiple texts using high-throughput batching.
 * Batches up to 25 texts per API call into Vertex AI / Gemini embedding models,
 * reducing ingestion from minutes to ~5-10 seconds.
 */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  const BATCH_SIZE = 25;
  const results: number[][] = new Array(texts.length);

  console.log(`[Embedding] Batch embedding ${texts.length} texts (batch size: ${BATCH_SIZE})`);

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const slice = texts.slice(i, i + BATCH_SIZE);
    let batchSucceeded = false;

    // 1. Try Vertex AI Enterprise in a single batch call
    try {
      const enterpriseClient = getEnterpriseClient();
      const res = await enterpriseClient.models.embedContent({
        model: VERTEX_EMBEDDING_MODEL,
        contents: slice,
        config: { outputDimensionality: EMBEDDING_DIMENSIONS },
      });
      if (res.embeddings && res.embeddings.length === slice.length) {
        for (let j = 0; j < slice.length; j++) {
          results[i + j] = res.embeddings[j].values || [];
        }
        batchSucceeded = true;
        trackVertexSpend("embed_text", Math.ceil(slice.reduce((a, s) => a + s.length, 0) / 1000)).catch(console.error);
      }
    } catch (vertexErr: any) {
      console.warn(`[Embedding] Vertex AI batch ${i / BATCH_SIZE + 1} unavailable (${vertexErr.message}), falling back to Gemini API key pool...`);
    }

    // 2. If Vertex AI failed, try Gemini Key Pool with batch contents
    if (!batchSucceeded) {
      for (let attempt = 0; attempt < 5; attempt++) {
        const { client, key } = getNextHealthyKey();
        try {
          const res = await client.models.embedContent({
            model: GEMINI_EMBEDDING_MODEL,
            contents: slice,
            config: { outputDimensionality: EMBEDDING_DIMENSIONS },
          });
          if (res.embeddings && res.embeddings.length === slice.length) {
            for (let j = 0; j < slice.length; j++) {
              results[i + j] = res.embeddings[j].values || [];
            }
            batchSucceeded = true;
            break;
          }
        } catch (geminiErr: any) {
          const isQuota = geminiErr.status === 429 || geminiErr.message?.includes("429");
          if (isQuota) {
            markKeyQuotaCooling(key, 60_000);
            await delay(200);
          } else {
            console.warn(`[Embedding] Gemini batch attempt ${attempt + 1} failed:`, geminiErr.message);
          }
        }
      }
    }

    // 3. Fallback: single-item embedding if batch was somehow rejected
    if (!batchSucceeded) {
      for (let j = 0; j < slice.length; j++) {
        results[i + j] = await embedText(slice[j]);
      }
    }

    console.log(`[Embedding] Progress: ${Math.min(i + BATCH_SIZE, texts.length)}/${texts.length} chunks embedded`);
  }

  // Validate all embeddings were generated
  const missing = results.filter((r) => !r || r.length === 0).length;
  if (missing > 0) {
    throw new Error(`${missing}/${texts.length} texts could not be indexed. Please try again.`);
  }

  return results;
}

// ── Section-aware chunking ────────────────────────────────────────────────────

const CHUNK_SIZE = 4000;    // char soft-cap (larger = fewer chunks = fits in 60s Vercel timeout)
const CHUNK_OVERLAP = 300;  // overlap between sub-chunks

export interface SectionChunk {
  content: string;
  sectionTitle: string;   // e.g. "3. Enzyme-Converted 'Universal' Kidney"
  sectionTier: "primary" | "secondary"; // primary = numbered major section, secondary = catch-all/bulleted
  sectionIndex: number;   // order of the section in the doc
  chunkIndexInSection: number;
  pageNumber?: number | null;
  docType?: string | null;
  mediaUrl?: string | null;
  timestampRange?: string | null;
}

export interface IngestMetadata {
  docType?: string;
  mediaUrl?: string;
  pageNumber?: number;
  timestampRange?: string;
}

export function inferDocType(filename: string): string {
  const ext = filename.toLowerCase().split(".").pop() || "";
  switch (ext) {
    case "pdf": return "pdf";
    case "png":
    case "jpg":
    case "jpeg":
    case "webp":
    case "gif":
    case "heic":
    case "heif": return "image";
    case "mp3":
    case "wav":
    case "m4a":
    case "ogg":
    case "aac":
    case "flac": return "audio";
    case "mp4":
    case "webm":
    case "mov": return "video";
    case "md": return "markdown";
    case "csv": return "csv";
    case "json": return "json";
    default: return "text";
  }
}

/**
 * Detects section boundaries in the document BEFORE any char-based splitting.
 * Recognizes:
 *   - Numbered major sections: lines starting with "1. ", "2. ", etc.
 *   - A catch-all "secondary" section (e.g. "Additional Notable Advances",
 *     "Other Science Highlights", "Notes for ...") whose own bullet points
 *     are treated as lower-tier than the numbered sections above it.
 * Falls back to treating the whole doc as one primary section if no
 * numbered headers are found, so this still works on unstructured text.
 */
function splitIntoSections(text: string): {
  title: string;
  tier: "primary" | "secondary";
  body: string;
  startPage?: number | null;
}[] {
  const lines = text.split("\n");

  const SECONDARY_HEADER_RE =
    /^(?:\d+\.\s+)?(additional notable advances|other science highlights|notes for|disclaimer)/i;
  const PRIMARY_HEADER_RE = /^\d+\.\s+\S/;
  const PAGE_LINE_RE = /^---\s*\[Page\s*(\d+)\]\s*---$/i;

  const sections: { title: string; tier: "primary" | "secondary"; body: string; startPage?: number | null }[] = [];
  let currentTitle = "Preamble";
  let currentTier: "primary" | "secondary" = "primary";
  let currentActivePage: number | null = null;
  let currentSectionStartPage: number | null = null;
  let buffer: string[] = [];

  const flush = () => {
    const body = buffer.join("\n").trim();
    if (body.length > 0) {
      sections.push({ title: currentTitle, tier: currentTier, body, startPage: currentSectionStartPage });
    }
    buffer = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();

    const pageMatch = trimmed.match(PAGE_LINE_RE);
    if (pageMatch) {
      currentActivePage = parseInt(pageMatch[1], 10);
      if (currentSectionStartPage === null) {
        currentSectionStartPage = currentActivePage;
      }
      continue;
    }

    if (SECONDARY_HEADER_RE.test(trimmed)) {
      flush();
      currentTitle = trimmed;
      currentTier = "secondary";
      currentSectionStartPage = currentActivePage;
      continue;
    }

    if (PRIMARY_HEADER_RE.test(trimmed)) {
      flush();
      currentTitle = trimmed;
      currentTier = "primary";
      currentSectionStartPage = currentActivePage;
      continue;
    }

    buffer.push(line);
  }
  flush();

  if (sections.length === 0) {
    return [{ title: "Document", tier: "primary", body: text.trim(), startPage: currentSectionStartPage ?? currentActivePage }];
  }

  return sections;
}

/**
 * Char-based sub-splitting WITHIN a single section, supporting multiple punctuation
 * systems (Latin '. ', question/exclamation, and Ethiopic/Amharic '።' \u1362).
 */
function splitSectionBody(body: string, targetChunkSize = CHUNK_SIZE): string[] {
  const cleaned = body
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();

  if (cleaned.length <= targetChunkSize) {
    return cleaned.length > 0 ? [cleaned] : [];
  }

  const chunks: string[] = [];
  let start = 0;
  while (start < cleaned.length) {
    let end = start + targetChunkSize;

    if (end < cleaned.length) {
      const paragraphBreak = cleaned.lastIndexOf("\n\n", end);
      if (paragraphBreak > start + targetChunkSize * 0.4) {
        end = paragraphBreak;
      } else {
        // Support Latin sentence break ('. '), question break ('? '), exclamation ('! '),
        // and Ethiopic/Amharic sentence break ('።' \u1362)
        let sentenceBreak = cleaned.lastIndexOf(". ", end);
        if (sentenceBreak === -1 || sentenceBreak < start + targetChunkSize * 0.4) {
          const amharicBreak = cleaned.lastIndexOf("።", end);
          if (amharicBreak > start + targetChunkSize * 0.4) {
            sentenceBreak = amharicBreak;
          }
        }
        if (sentenceBreak === -1 || sentenceBreak < start + targetChunkSize * 0.4) {
          const qBreak = cleaned.lastIndexOf("? ", end);
          if (qBreak > start + targetChunkSize * 0.4) {
            sentenceBreak = qBreak;
          }
        }
        if (sentenceBreak > start + targetChunkSize * 0.4) {
          end = sentenceBreak + 1;
        }
      }
    } else {
      end = cleaned.length;
    }

    const chunk = cleaned.substring(start, end).trim();
    if (chunk.length > 50) {
      chunks.push(chunk);
    }

    start = end - CHUNK_OVERLAP;
    if (start < 0) start = 0;
    if (end >= cleaned.length) break;
  }

  return chunks;
}

/**
 * Split text into section-aware, overlapping chunks optimized for retrieval.
 * Uses adaptive chunk sizing so large documents (e.g. 50+ page PDFs) stay within
 * a safe chunk count (~30 chunks), preventing free-tier quota exhaustion.
 */
export function chunkForRetrieval(text: string, metadata?: IngestMetadata): SectionChunk[] {
  // Adaptive chunk size: If document is large, scale chunk size up so total chunk count
  // remains manageable (under 30 chunks) and completes well within serverless timeouts.
  const MAX_TARGET_CHUNKS = 30;
  const targetChunkSize = Math.max(CHUNK_SIZE, Math.min(8000, Math.ceil(text.length / MAX_TARGET_CHUNKS)));

  const PAGE_MARKER_RE = /---\s*\[Page\s*(\d+)\]\s*---/i;
  const TIMESTAMP_RE = /\[(\d{1,2}:\d{2}(?::\d{2})?(?:\s*-\s*\d{1,2}:\d{2}(?::\d{2})?)?)\]/;

  let activePage: number | null = metadata?.pageNumber ?? null;

  const sections = splitIntoSections(text);
  const result: SectionChunk[] = [];

  sections.forEach((section, sectionIndex) => {
    if (section.startPage != null) {
      activePage = section.startPage;
    }

    const subChunks = splitSectionBody(section.body, targetChunkSize);
    subChunks.forEach((content, chunkIndexInSection) => {
      const pageMatch = content.match(PAGE_MARKER_RE);
      if (pageMatch) {
        activePage = parseInt(pageMatch[1], 10);
      }

      const timeMatch = content.match(TIMESTAMP_RE);
      const timestampRange = timeMatch ? timeMatch[1] : (metadata?.timestampRange ?? null);

      result.push({
        content,
        sectionTitle: section.title,
        sectionTier: section.tier,
        sectionIndex,
        chunkIndexInSection,
        pageNumber: activePage,
        docType: metadata?.docType ?? null,
        mediaUrl: metadata?.mediaUrl ?? null,
        timestampRange,
      });
    });
  });

  return result;
}

// ── Ingest (chunk + embed + store) ───────────────────────────────────────────

/**
 * Chunk a document, embed each chunk, and store in Supabase — now with
 * section_title / section_tier / section_index, page_number, doc_type,
 * media_url, and timestamp_range columns so retrieval and generation
 * have rich source grounding.
 */
export async function ingestDocument(
  expertId: string,
  text: string,
  filename: string,
  metadata?: IngestMetadata,
): Promise<{ chunksStored: number }> {
  const supabase = await createClient();
  const effectiveDocType = metadata?.docType || inferDocType(filename);
  const chunks = chunkForRetrieval(text, { ...metadata, docType: effectiveDocType });

  console.log(
    `[RAG] Chunked "${filename}" into ${chunks.length} section-aware pieces ` +
    `(${new Set(chunks.map((c) => c.sectionTitle)).size} sections, type: ${effectiveDocType})`,
  );

  const embeddings = await embedTexts(chunks.map((c) => c.content));

  // Validate embedding count matches chunk count (partial results from quota
  // issues would cause undefined access later)
  if (embeddings.length !== chunks.length) {
    throw new Error(
      `Embedding count mismatch: got ${embeddings.length} embeddings for ${chunks.length} chunks. ` +
      `This usually means the embedding API hit quota limits. Please try again.`
    );
  }

  console.log(`[RAG] Embedded ${embeddings.length} chunks`);

  const rows = chunks.map((chunk, i) => ({
    expert_id: expertId,
    content: chunk.content,
    embedding: `[${(embeddings[i] || []).join(",")}]`,
    source_filename: filename,
    chunk_index: i,
    section_title: chunk.sectionTitle,
    section_tier: chunk.sectionTier,
    section_index: chunk.sectionIndex,
    page_number: chunk.pageNumber ?? metadata?.pageNumber ?? null,
    doc_type: chunk.docType ?? effectiveDocType,
    media_url: chunk.mediaUrl ?? metadata?.mediaUrl ?? null,
    timestamp_range: chunk.timestampRange ?? metadata?.timestampRange ?? null,
  }));

  const BATCH_SIZE = 50;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const { error } = await supabase.from("expert_chunks").insert(batch);
    if (error) {
      console.error(`[RAG] Failed to insert chunks batch ${i}:`, error);
      throw new Error(`Failed to store chunks: ${error.message}`);
    }
  }

  console.log(`[RAG] Stored ${rows.length} chunks for expert ${expertId}`);
  return { chunksStored: rows.length };
}

// ── Retrieve ─────────────────────────────────────────────────────────────────

export interface RetrievedChunk {
  id?: string;
  content: string;
  source_filename: string;
  chunk_index: number;
  similarity: number;
  section_title?: string;
  section_tier?: "primary" | "secondary";
  page_number?: number | null;
  doc_type?: string | null;
  media_url?: string | null;
  timestamp_range?: string | null;
  rrf_score?: number | null;
}

/**
 * One-shot query expansion via Groq.
 * Rewrites the user query into 2-3 search variants:
 * 1. Original user query.
 * 2. Cross-lingual translation (if non-English) or domain synonym expansion.
 * 3. Dense keyword query for Postgres full-text search.
 */
export async function expandQueryWithGroq(query: string): Promise<string[]> {
  const cleanQuery = query.trim();
  if (!cleanQuery) return [query];

  const groqKeys = getGroqApiKeys();
  if (groqKeys.length === 0) return [cleanQuery];

  const systemInstruction = `You are a search query expansion expert for a hybrid (pgvector cosine + Postgres FTS) knowledge retrieval engine.
Given the user's query, output 2 to 3 distinct search query variants to maximize retrieval recall against an internal knowledge base.

Rules:
1. Variant 1: Keep the user's original query or core intent.
2. Variant 2 (Cross-Lingual): If the query is NOT in English (e.g. Arabic, Spanish, French, Amharic), provide a precise English translation. If the query is ALREADY in English, provide an alternative phrasing focusing on technical terminology and domain synonyms.
3. Variant 3: A concise keyword-dense query suitable for exact keyword/full-text search.

Return strictly a JSON object with this format (no markdown, no other keys):
{"variants": ["variant 1", "variant 2", "variant 3"]}`;

  try {
    const groqClient = getGroqClient();
    const completion = await groqClient.chat.completions.create({
      messages: [
        { role: "system", content: systemInstruction },
        { role: "user", content: `Query: "${cleanQuery}"` },
      ],
      model: "openai/gpt-oss-120b",
      temperature: 0.1,
      max_completion_tokens: 512,
    });

    const raw = completion.choices[0]?.message?.content?.trim() || "";
    let jsonStr = raw;
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      jsonStr = jsonMatch[0];
    }
    const parsed = JSON.parse(jsonStr);
    if (Array.isArray(parsed.variants) && parsed.variants.length > 0) {
      const set = new Set<string>();
      set.add(cleanQuery);
      for (const v of parsed.variants) {
        if (typeof v === "string" && v.trim().length > 0) {
          set.add(v.trim());
        }
      }
      const variants = Array.from(set).slice(0, 3);
      console.log(`[RAG] Groq expanded query into ${variants.length} search variants:`, variants);
      return variants;
    }
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.warn(`[RAG] Groq query expansion warning (${errorMsg}), falling back to single query.`);
  }

  return [cleanQuery];
}

/**
 * Heuristic: broad/summarization-style queries need more chunks to reach
 * full coverage across sections than narrow factual lookups do.
 */
function adaptiveTopK(query: string, mode?: string): number {
  if (mode === "evaluative") return 10;

  const BROAD_QUERY_RE =
    /\b(summariz|summary|all|every|each|list|overview|entire|complete|full report)\b/i;

  const COUNT_ASSERTION_RE =
    /\b(how many|which (two|three|four|five|\d+)|name (two|three|four|five|\d+)|the (two|three|four|five|\d+))\b/i;

  if (BROAD_QUERY_RE.test(query) || COUNT_ASSERTION_RE.test(query)) {
    return 12;
  }
  return 5;
}

/**
 * Retrieve the top-K most relevant chunks using parallel multi-query hybrid search
 * (pgvector + Postgres full-text search) combined with Reciprocal Rank Fusion (RRF).
 */
export async function retrieveChunks(
  query: string,
  expertId: string,
  topK?: number,
  matchThreshold: number = 0.3,
  mode?: string,
): Promise<RetrievedChunk[]> {
  const supabase = await createClient();
  const resolvedTopK = topK ?? adaptiveTopK(query, mode);

  // 1. One-shot query expansion via Groq (2-3 variants, including translation)
  const variants = await expandQueryWithGroq(query);

  // 2. Embed all query variants in parallel
  const embeddings = await embedTexts(variants);

  // 3. Execute hybrid search RPC in parallel for all variants
  const searchPromises = variants.map(async (variant, i) => {
    const emb = embeddings[i];
    if (!emb || emb.length === 0) return [];

    const { data, error } = await supabase.rpc("match_expert_chunks", {
      query_embedding: `[${emb.join(",")}]`,
      target_expert_id: expertId,
      match_count: resolvedTopK,
      match_threshold: matchThreshold,
      query_text: variant,
      rrf_k: 60,
    });

    if (error) {
      console.warn(`[RAG] Hybrid retrieval error for variant "${variant}":`, error.message);
      return [];
    }

    return ((data || []) as unknown) as RetrievedChunk[];
  });

  const allVariantResults = await Promise.all(searchPromises);

  // 4. Merge and deduplicate using Reciprocal Rank Fusion across all variants
  const RRF_K = 60;
  const chunkMap = new Map<string, RetrievedChunk & { combinedRrf: number }>();

  allVariantResults.forEach((results) => {
    results.forEach((row: RetrievedChunk, rankIdx: number) => {
      const key = row.id || `${row.source_filename}_${row.chunk_index}`;
      const rank = rankIdx + 1;
      const rrfContribution = 1.0 / (RRF_K + rank);

      const existing = chunkMap.get(key);
      if (existing) {
        existing.combinedRrf += rrfContribution;
        if ((row.similarity ?? 0) > (existing.similarity ?? 0)) {
          existing.similarity = row.similarity;
        }
        if (!existing.page_number && row.page_number) existing.page_number = row.page_number;
        if (!existing.doc_type && row.doc_type) existing.doc_type = row.doc_type;
        if (!existing.media_url && row.media_url) existing.media_url = row.media_url;
        if (!existing.timestamp_range && row.timestamp_range) existing.timestamp_range = row.timestamp_range;
      } else {
        chunkMap.set(key, {
          id: row.id,
          content: row.content,
          source_filename: row.source_filename,
          chunk_index: row.chunk_index,
          similarity: row.similarity ?? 0,
          section_title: row.section_title,
          section_tier: row.section_tier,
          page_number: row.page_number,
          doc_type: row.doc_type,
          media_url: row.media_url,
          timestamp_range: row.timestamp_range,
          rrf_score: row.rrf_score ?? rrfContribution,
          combinedRrf: rrfContribution,
        });
      }
    });
  });

  // Sort by combined RRF score descending and take top-K
  const mergedChunks = Array.from(chunkMap.values())
    .sort((a, b) => b.combinedRrf - a.combinedRrf)
    .slice(0, resolvedTopK);

  return mergedChunks;
}

// ── Generate (retrieve + prompt + answer) ────────────────────────────────────

// Static rubric dimensions — pinned here instead of relying on retrieval,
// so the scorecard format is consistent regardless of which rubric chunks
// happen to match best for a given query.
const RUBRIC_DIMENSIONS = [
  "Market Size",
  "Problem Severity",
  "Timing",
  "Competition",
  "Business Model Clarity",
  "Technical Feasibility",
  "Defensibility",
  "Unit Economics",
  "Team-Market Fit",
  "Scalability",
] as const;

export interface GenerateRAGOptions {
  reasoningMode?: "strict" | "evaluative" | "hybrid";
  webSearchEnabled?: boolean;
  /** When present, routes generation to Gemini instead of Groq for multimodal processing. */
  mediaAttachments?: MediaAttachment[];
  /** Route Gemini calls through Vertex AI (paid) or free API keys. */
  useEnterprise?: boolean;
}

export interface RAGResponse {
  reply: string;
  sources: {
    filename: string;
    chunkIndex: number;
    similarity: number;
    sectionTitle?: string;
    sectionTier?: string;
    pageNumber?: number | null;
    docType?: string | null;
    mediaUrl?: string | null;
    timestampRange?: string | null;
    rrfScore?: number | null;
  }[];
  webSources?: WebSearchResult[];
}

/**
 * Verifier pass: checks every company name in the draft against the actual
 * retrieved chunks. If a company is mentioned but its specific claims aren't
 * supported by the sources, the verifier patches the draft to use generic
 * failure patterns instead. Runs at temperature=0 for maximum precision.
 */
async function verifyEntityClaims(
  draft: string,
  chunks: RetrievedChunk[],
  webResults: WebSearchResult[],
): Promise<string> {
  // Quick check: if the draft doesn't look like it contains company references, skip
  const hasHistoricalSection = /\b(fail|died|shut down|dissolved|wound down|acqui-?hir|absorbed|pivot)/i.test(draft)
    && /[A-Z][a-z]+\s(?:AI|Inc|Labs|Corp|Co\b)/i.test(draft);
  if (!hasHistoricalSection) return draft;

  const sourcesBlock = chunks
    .map((c, i) => `[Chunk ${i} — ${c.source_filename}]: ${c.content}`)
    .join("\n\n");

  const webBlock = webResults.length > 0
    ? webResults.map((r, i) => `[Web ${i} — ${r.title}]: ${r.snippet}`).join("\n\n")
    : "No web sources.";

  const verifierPrompt = `You are a strict fact-checker. Below is a DRAFT response and the SOURCE CHUNKS + WEB INTEL it was grounded in.

Your task: Find every real company name AND every specific numerical claim (e.g., market sizes, costs, percentages) mentioned in the DRAFT. For each one, check whether the SPECIFIC CLAIM made (what the company built, why it failed, or what label the number is attached to) is explicitly and accurately supported by the SOURCE CHUNKS or WEB INTEL below.

A company name or number simply appearing in a source is NOT enough — the specific claim about that entity or the label attached to that number must match what the source says. If a number is cited from a source (e.g., "Source 10"), verify that the source actually attributes that number to the specific industry/context claimed in the draft.

Return ONLY valid JSON with this exact structure:
{"violations": [{"claim": "the specific false or misattributed claim made", "fix": "a generic rewrite that describes the pattern without naming the company, or removes the misattributed number"}]}

If there are no violations, return: {"violations": []}

SOURCE CHUNKS:
${sourcesBlock}

WEB INTEL:
${webBlock}

DRAFT:
${draft}`;

  try {
    const result = await getGroqClient().chat.completions.create({
      messages: [{ role: "user", content: verifierPrompt }],
      model: "openai/gpt-oss-120b",
      temperature: 0,
      max_completion_tokens: 1024,
    });

    const raw = result.choices[0]?.message?.content?.trim() ?? "{}";
    // Extract JSON from potential markdown code blocks
    const jsonStr = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
    const parsed = JSON.parse(jsonStr);
    const violations = parsed?.violations;

    if (!violations?.length) {
      console.log("[RAG Verifier] No entity/numeric claim violations found.");
      return draft;
    }

    console.log(`[RAG Verifier] Found ${violations.length} violation(s):`, violations.map((v: any) => v.claim));

    // Apply fixes: replace each violating mention with the generic pattern
    const patchPrompt = `You are an editor. Rewrite the DRAFT below by applying ONLY the fixes listed. Do not change anything else — keep all formatting, tone, and structure identical.

FIXES TO APPLY:
${violations.map((v: any, i: number) => `${i + 1}. Fix the claim "${v.claim}" with: ${v.fix}`).join("\n")}

DRAFT:
${draft}`;

    const patched = await getGroqClient().chat.completions.create({
      messages: [{ role: "user", content: patchPrompt }],
      model: "openai/gpt-oss-120b",
      temperature: 0,
      max_completion_tokens: 2048,
    });

    const patchedReply = patched.choices[0]?.message?.content?.trim();
    if (patchedReply && patchedReply.length > draft.length * 0.5) {
      console.log("[RAG Verifier] Draft patched successfully.");
      return patchedReply;
    }

    // If patching produced garbage, return original draft
    console.warn("[RAG Verifier] Patch output was too short or empty, using original draft.");
    return draft;
  } catch (err: any) {
    console.warn("[RAG Verifier] Verification failed, using original draft:", err.message);
    return draft;
  }
}

/**
 * Full RAG pipeline: embed query → retrieve chunks → (optional live web search) → build dynamic prompt → generate answer → verify entity claims.
 * Adapts instructions based on reasoningMode ("strict" | "evaluative" | "hybrid") and includes live web intelligence if webSearchEnabled.
 */
export async function generateRAGResponse(
  query: string,
  expertId: string,
  systemPrompt: string,
  chatHistory: { role: string; content: string }[] = [],
  options?: GenerateRAGOptions,
): Promise<RAGResponse> {
  const hasMedia = options?.mediaAttachments && options.mediaAttachments.length > 0;
  const mode = options?.reasoningMode || "hybrid";
  const chunks = await retrieveChunks(query, expertId, undefined, 0.3, mode);

  console.log(
    `[RAG] Retrieved ${chunks.length} chunks (top similarity: ${chunks[0]?.similarity?.toFixed(3) ?? "N/A"}) | Mode: ${options?.reasoningMode || "hybrid"} | WebSearch: ${options?.webSearchEnabled ? "ON" : "OFF"} | Provider: ${hasMedia ? "Gemini (multimodal)" : "Groq (text)"}`,
  );

  const sourcesText =
    chunks.length > 0
      ? chunks
        .map((c, i) => {
          const typeLabel = c.doc_type ? ` | type: ${c.doc_type}` : "";
          const pageLabel = c.page_number ? ` | page: ${c.page_number}` : "";
          const timeLabel = c.timestamp_range ? ` | time: ${c.timestamp_range}` : "";
          const sectionLabel = c.section_title ? ` | section: "${c.section_title}"` : "";
          const tierLabel = c.section_tier ? ` | tier: ${c.section_tier}` : "";
          return `[Source ${i + 1} — ${c.source_filename}${typeLabel}${pageLabel}${timeLabel}${sectionLabel}${tierLabel}]:\n${c.content}`;
        })
        .join("\n\n")
      : "No relevant documents found in the internal knowledge base.";

  // Optional Live Web Search
  let webSourcesText = "";
  let webResults: WebSearchResult[] = [];

  if (options?.webSearchEnabled) {
    try {
      webResults = await searchWeb(query, 3);
      if (webResults.length > 0) {
        webSourcesText =
          `\n\nLive Internet Search Intelligence (Real-time Market Data & Recent News):\n` +
          webResults
            .map((r, i) => `[Live Web Intel ${i + 1} — ${r.title} (${r.link})]:\n${r.snippet}`)
            .join("\n\n");
      }
    } catch (searchErr: any) {
      console.warn("[RAG] Web search warning:", searchErr.message);
    }
  }

  // Build mode-specific instructions
  let modeInstructions = "";

  if (mode === "strict") {
    modeInstructions = `
OPERATING RULES (STRICT DOCUMENT GROUNDING):
- Answer the user's question using ONLY the facts explicitly stated in the Sources below.
- If the answer is NOT in the sources, say: "I don't have information about that in my knowledge base."
- Do NOT extrapolate, speculate, or make up facts not present in the sources.
- When possible, mention which source your answer comes from.
- Be concise, accurate, and completely faithful to the provided text.`;
  } else if (mode === "evaluative") {
    modeInstructions = `
OPERATING RULES (CRITICAL THINKER & EVALUATOR MODE):
- You are evaluating a novel, user-submitted pitch, concept, or question.
- The Sources below provide your internal evaluation frameworks, scoring rubrics, and industry benchmarks.
- APPLY these frameworks directly to the pitch using first-principles deductive reasoning, physical laws, market realities, unit economics, and sharp common sense.
- Never say "the rubric says" or "Source 4 mentions"; internalize the criteria and speak with confidence and authority in your established persona.
- If an idea is fundamentally broken or flawed, assign aggressive failing scores (0–2/10) on Feasibility, Timing, Defensibility, or Economics. Roast the fatal flaws with precision, wit, and constructive truth.
- Do not refuse to evaluate an idea just because the exact product name or concept isn't mentioned in your documents. Map it to the closest category, technical difficulty tier, and market dynamics.
- Never cite sources inline with parentheses.
  - BAD: "...the metaverse market is $450B (Source 10)."
  - GOOD: "...the metaverse market is roughly $450B."

### CRITICAL GENERATION PIPELINE (CHAIN OF THOUGHT) ###
Before generating the Scorecard or Roast, you MUST evaluate the core unit economics and logical flaws inside the "analysis_scratchpad" JSON field.
1. PRE-COMPUTE: Explicitly lock in your assumptions for Customer Acquisition Cost (CAC), Lifetime Value (LTV), wholesale margins, and regulatory reality.
2. NARRATIVE LOCK: Decide right now if the economics are viable or fatal. Write a one-sentence verdict.
3. CONSISTENCY BINDING: The Scorecard and the Roast MUST strictly reflect the assumptions established in the scratchpad.
- If you deduce in the scratchpad that margins are terrible, the Unit Economics score MUST be low (0-3) and the Scorecard explanation MUST attack the margins.
- You are strictly forbidden from praising a metric in the Scorecard and roasting that same metric in the Roast section.

OUTPUT INTEGRITY RULE:
You MUST generate all required JSON fields in full. Never close the JSON object early.
- "scorecard": Must contain all 10 dimensions.
- "total_verdict": MUST be a punchy 3-word summary verdict (e.g., "Dead on Arrival", "Cash-Flow Trap"). NEVER use asterisks or blanks.
- "roast": Minimum 4 brutal, first-principles paragraphs.
- "graveyard": 3-4 structural failure patterns.
- "pivot": Actionable, higher-margin alternative.

MANDATORY JSON OUTPUT FORMAT:
You must output a strictly valid JSON object matching this exact schema. Do NOT wrap it in markdown blockticks (\`\`\`json).
You MUST include all 6 top-level keys ("analysis_scratchpad", "scorecard", "total_verdict", "roast", "graveyard", "pivot"). Do not skip any section.

{
  "analysis_scratchpad": "Your internal chain-of-thought to lock in CAC, LTV, margins, and narrative BEFORE scoring.",
  "scorecard": [
    { "dimension": "Market Size", "score": 8, "reasoning": "Why you gave this score" },
    ... exactly 10 dimensions, in the order specified below ...
  ],
  "total_verdict": "A punchy 3-word summary verdict of the idea.",
  "roast": "The roast paragraphs ONLY. No heading, no failure patterns, no pivot. Minimum 4 paragraphs.",
  "graveyard": "The failure-pattern bullet points ONLY. No heading, no roast, no pivot. Minimum 3 bullets using markdown list syntax (- item).",
  "pivot": "The pivot content ONLY. No heading, no roast, no failure patterns."
}

CRITICAL: Each JSON field must contain ONLY its own section's content (no headings, no duplicates across fields).

You must ALWAYS score exactly these 10 dimensions, in this exact order, 0–10 each:
${RUBRIC_DIMENSIONS.map((d, i) => `${i + 1}. ${d}`).join("\n")}
Never omit a dimension, never change the dimension names.
IMPORTANT: "Team-Market Fit" MUST always be scored. If the pitch doesn't mention the team, score based on what the concept demands (e.g., "requires deep neurotech + crypto + creator-economy expertise") and note what's missing.

ABSOLUTE FACTUALITY CONSTRAINT — VIOLATION = FAILURE:
- You may deduce WHY something will fail using logic, physics, math, economics, and law. This is ENCOURAGED.
- You must NEVER fabricate, invent, or distort ANY factual claim. This includes ALL of the following:
  (a) Inventing fake company names or product names that do not exist.
  (b) Inventing fake historical events, regulatory rulings, crackdowns, fines, or lawsuits that never happened.
  (c) Using REAL company names but FABRICATING their business model, reason for failure, pivot story, or acquisition details. This is called "historical revisionism" and is the WORST form of hallucination.
- BEFORE you write any company name in your response, ask yourself: "Can I verify EVERY claim I'm about to make about this company from my Sources or Live Web Intel?" If the answer is NO, do NOT mention that company. Describe the general failure pattern instead.
- If your sources contain NO company that genuinely and accurately matches this pitch, DO NOT force unrelated companies into the analysis. Instead write: "No direct historical equivalents exist in the current database — this concept is either visionary or entirely unproven territory." This is intellectually honest and preferred over fabrication.
- It is ALWAYS better to SKIP a section entirely than to fill it with fabricated or distorted facts.`;
  } else {
    // Hybrid / Balanced
    modeInstructions = `
OPERATING RULES (BALANCED HYBRID MODE):
- Use the Sources below as your primary foundation of facts, principles, and guidelines.
- You are encouraged to extrapolate, explain, give real-world context, and reason using general world knowledge while remaining grounded in the themes and principles of your knowledge base.
- If the user asks about an idea or topic not literally in your files, use your best judgment to connect it to your knowledge base principles.
- Maintain your persona naturally without mechanically citing sources unless requested.

FACTUALITY CONSTRAINT:
- When mentioning real companies, people, or events, every claim must be factually accurate. Never distort a real entity's history to fit your narrative.
- If unsure about a specific claim, describe the general pattern instead. It is better to say "several companies in this space failed due to..." than to name a company and fabricate its story.`;
  }

  const webInstruction = webResults.length > 0
    ? `\n- Real-time Web Search Intelligence is included below. Weave in relevant current news, competitors, and market updates to ensure your analysis is up to date.`
    : "";

  // Short, punchy final reminder at recency position (last thing the model reads)
  const finalGroundingBlock = mode === "evaluative"
    ? `

FINAL CHECK (READ THIS LAST BEFORE RESPONDING):
Before you output your response, scan it for any company name. For each one, verify: Is every claim about this company (its product, its failure reason, its acquirer) explicitly stated in the Sources above or Live Web Intel? If you cannot verify it, DELETE that company from your response and describe the general failure pattern instead. Never force-fit real companies into fake narratives. Skipping a section is always better than fabricating one.`
    : "";

  const antiRepetitionRule = `
ANTI-REPETITION CONSTRAINT (CRITICAL):
- Never repeat the same word, phrase, sentence, or structure consecutively.
- Provide a progressive, varied, and naturally structured response.
- When writing in Amharic, Ge'ez, or any other script, always use rich, natural vocabulary and complete every sentence naturally.`;

  const groundedSystemPrompt = `${systemPrompt}

${modeInstructions}
${antiRepetitionRule}
${webInstruction}

Internal Knowledge Base Sources:
${sourcesText}
${webSourcesText}
${finalGroundingBlock}`;

  let draft: string;

  if (hasMedia) {
    const geminiContents: any[] = [];
    const uploadedUris: string[] = [];

    // Add chat history as alternating user/model turns
    for (const msg of chatHistory) {
      if (msg.role === "user" || msg.role === "model") {
        geminiContents.push({
          role: msg.role === "user" ? "user" : "model",
          parts: [{ text: msg.content }],
        });
      }
    }

    // Build the final user turn with text + media parts
    const userParts: any[] = [];
    for (const attachment of options!.mediaAttachments!) {
      if (attachment.url) {
        try {
          if (options?.useEnterprise) {
            console.log(`[RAG] Fetching ${attachment.filename || "file"} for Vertex AI inline processing...`);
            const res = await fetch(attachment.url);
            if (!res.ok) throw new Error(`Failed to download attachment from storage: ${res.statusText}`);
            const buffer = Buffer.from(await res.arrayBuffer());
            userParts.push({
              inlineData: { mimeType: attachment.mimeType, data: buffer.toString("base64") },
            });
          } else {
            console.log(`[RAG] Uploading ${attachment.filename || "file"} from R2 to Gemini...`);
            const { fileUri } = await uploadFileFromUrl(attachment.url, attachment.mimeType);
            uploadedUris.push(fileUri);
            userParts.push({ fileData: { fileUri, mimeType: attachment.mimeType } });
          }
        } catch (err: any) {
          console.error("[RAG] Failed to process media attachment from URL:", err);
          throw new Error(`Failed to process media attachment: ${err.message}`);
        }
      } else if (attachment.data) {
        userParts.push({
          inlineData: { mimeType: attachment.mimeType, data: attachment.data },
        });
      }
    }
    userParts.push({ text: query });
    geminiContents.push({ role: "user", parts: userParts });

    console.log(`[RAG] Using Gemini multimodal with ${options!.mediaAttachments!.length} attachment(s)`);

    try {
      const geminiResult = await generateWithModelFallback(geminiContents, {
        systemInstruction: groundedSystemPrompt,
        generationConfig: {
          maxOutputTokens: 4096,
          temperature: mode === "evaluative" ? 0.25 : 0.6,
          topP: 0.9,
          topK: 40,
          ...(mode === "evaluative" ? { responseMimeType: "application/json" } : {}),
        },
        useEnterprise: options?.useEnterprise,
      });

      draft = geminiResult.text()?.trim() ?? "I couldn't generate a response.";
    } finally {
      // Clean up uploaded files
      if (uploadedUris.length > 0) {
        Promise.all(uploadedUris.map(uri => deleteGeminiFile(uri))).catch(console.error);
      }
    }
  } else {
    // ── Groq Text-Only Path (default, free, fast) ─────────────────────────
    const groqHistory: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
      { role: "system", content: groundedSystemPrompt },
    ];

    for (const msg of chatHistory) {
      if (msg.role === "user" || msg.role === "model") {
        groqHistory.push({
          role: msg.role === "user" ? "user" : "assistant",
          content: msg.content,
        });
      }
    }

    groqHistory.push({ role: "user", content: query });

    try {
      const completion = await getGroqClient().chat.completions.create({
        messages: groqHistory,
        model: "openai/gpt-oss-120b",
        temperature: mode === "evaluative" ? 0.25 : 0.6,
        max_completion_tokens: 4096,
        top_p: 0.9,
      });

      draft = completion.choices[0]?.message?.content?.trim() ?? "I couldn't generate a response.";
    } catch (groqErr: any) {
      console.warn("[RAG] Groq generation error, checking recovery:", groqErr?.message);

      // 1. If Groq threw json_validate_failed, retrieve the failed generation
      let recoveredText: string | undefined = groqErr?.error?.failed_generation;
      if (!recoveredText && typeof groqErr?.message === "string") {
        try {
          const parsed = JSON.parse(groqErr.message.replace(/^[0-9]+\s*/, ""));
          recoveredText = parsed?.error?.failed_generation;
        } catch {}
      }

      if (recoveredText) {
        draft = recoveredText.trim();
      } else {
        // 2. Fallback to Gemini text generation
        console.log("[RAG] Falling back to Gemini for text generation...");
        try {
          const geminiFallback = await generateWithModelFallback(
            [
              {
                role: "user",
                parts: [{ text: `${groundedSystemPrompt}\n\nUser Message:\n${query}` }],
              },
            ],
            {
              generationConfig: {
              maxOutputTokens: 4096,
              temperature: mode === "evaluative" ? 0.25 : 0.6,
              topP: 0.9,
              topK: 40,
            },
            }
          );
          draft = geminiFallback.text()?.trim() ?? "I couldn't generate a response.";
        } catch (geminiErr: any) {
          console.error("[RAG] Both Groq and Gemini fallback failed:", geminiErr);
          throw groqErr;
        }
      }
    }
  }

  // Re-assemble JSON into markdown if in evaluative mode
  if (mode === "evaluative") {
    try {
      let jsonStr = draft.trim();
      const codeBlockMatch = draft.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
      if (codeBlockMatch) {
        jsonStr = codeBlockMatch[1].trim();
      } else {
        const firstBrace = draft.indexOf("{");
        const lastBrace = draft.lastIndexOf("}");
        if (firstBrace !== -1 && lastBrace > firstBrace) {
          jsonStr = draft.slice(firstBrace, lastBrace + 1).trim();
        }
      }

      const parsed = JSON.parse(jsonStr);

      if (parsed.scorecard || parsed.total_verdict || parsed.roast) {
        let totalScore = 0;
        let scorecardMd = "## 🚀 QUICK‑LOOK SCORECARD\n| Dimension | Score (0‑10) | Why you’re getting that number |\n|-----------|--------------|--------------------------------|\n";

        const scorecardData = Array.isArray(parsed.scorecard) ? parsed.scorecard : [];

        // Enforce all 10 dimensions are present, even if LLM missed one
        for (const dim of RUBRIC_DIMENSIONS) {
          const row = scorecardData.find((r: any) => r.dimension === dim) || {
            score: 3,
            reasoning: "No specific details provided; scored conservatively based on concept requirements.",
          };
          const score = typeof row.score === "number" ? row.score : parseInt(String(row.score), 10) || 0;
          totalScore += score;
          scorecardMd += `| ${dim} | ${score} | ${String(row.reasoning || "").replace(/\n/g, " ")} |\n`;
        }

        const totalVerdict = parsed.total_verdict ? String(parsed.total_verdict).replace(/\n/g, " ") : "";
        scorecardMd += `| **Total** | **${totalScore} / 100** | **${totalVerdict}** |\n---\n`;

        // Strip any headings the LLM may have snuck into content fields
        const stripHeadings = (text: string) => text.replace(/^##\s*[🔥📉🛠️].*\n?/gm, "").trim();
        const roastContent = stripHeadings(parsed.roast || "");
        const graveyardContent = stripHeadings(parsed.graveyard || "");
        const pivotContent = stripHeadings(parsed.pivot || "");

        draft = `${scorecardMd}\n## 🔥 ROAST\n${roastContent}\n\n---\n\n## 📉 WHY SIMILAR STARTUPS HAVE DIED\n${graveyardContent}\n\n---\n\n## 🛠️ CONSTRUCTIVE PIVOT\n${pivotContent}`.trim();

        // Clean up any duplicate horizontal rules
        draft = draft.replace(/(?:\n\s*---\s*){2,}/g, "\n\n---");
      }
    } catch {
      // Natural conversational text remains intact as clean markdown/text
    }
  }

  // ── Repetition loop guard ────────────────────────────────────────────────
  // Detect and cleanly truncate any degenerate token loops before verification
  draft = cleanRepetitionLoop(draft);

  // Fix 1: Verifier pass — check every company name against actual retrieved chunks
  // This catches the "sticky name" hallucination where the model uses real company
  // names but fabricates their business models/failure reasons to fit the pitch.
  const verifiedReply = await verifyEntityClaims(draft, chunks, webResults);
  const reply = cleanRepetitionLoop(verifiedReply);

  return {
    reply,
    sources: chunks.map((c) => ({
      filename: c.source_filename,
      chunkIndex: c.chunk_index,
      similarity: c.similarity,
      sectionTitle: c.section_title,
      sectionTier: c.section_tier,
      pageNumber: c.page_number,
      docType: c.doc_type,
      mediaUrl: c.media_url,
      timestampRange: c.timestamp_range,
      rrfScore: c.rrf_score,
    })),
    webSources: webResults,
  };
}

export { EMBEDDING_DIMENSIONS };