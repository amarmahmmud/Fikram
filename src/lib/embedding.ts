// ─────────────────────────────────────────────
// Embedding & Retrieval Library for RAG
// ─────────────────────────────────────────────
// Uses Gemini text-embedding-004 (free, 768 dimensions) for embeddings
// and Supabase pgvector for storage + similarity search.

import { GoogleGenerativeAI } from "@google/generative-ai";
import Groq from "groq-sdk";

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GEMINI_API_KEY!);
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY! });

// ── Embedding ────────────────────────────────────────────────────────────────

const EMBEDDING_MODEL = "gemini-embedding-2";
const EMBEDDING_DIMENSIONS = 768;

/**
 * Generate an embedding vector for a single text string.
 * Uses Gemini text-embedding-004 (768 dimensions, free tier).
 */
export async function embedText(text: string): Promise<number[]> {
  const model = genAI.getGenerativeModel({ model: EMBEDDING_MODEL });
  const result = await model.embedContent({
    content: { role: "user" as const, parts: [{ text }] },
    outputDimensionality: EMBEDDING_DIMENSIONS,
  });
  return result.embedding.values;
}

/**
 * Generate embeddings for multiple texts in batch.
 * Gemini supports batch embedding for efficiency.
 */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  const model = genAI.getGenerativeModel({ model: EMBEDDING_MODEL });
  const result = await model.batchEmbedContents({
    requests: texts.map((text) => ({
      content: { role: "user" as const, parts: [{ text }] },
      outputDimensionality: EMBEDDING_DIMENSIONS,
    })),
  });
  return result.embeddings.map((e) => e.values);
}

// ── Chunking ─────────────────────────────────────────────────────────────────

const CHUNK_SIZE = 800;     // chars per chunk — smaller than fine-tuning chunks for precise retrieval
const CHUNK_OVERLAP = 100;  // overlap between chunks for context continuity

/**
 * Split text into overlapping chunks optimized for retrieval.
 * Smaller chunks than the fine-tuning pipeline (800 vs 4000 chars)
 * because retrieval needs precision — a 4000-char chunk dilutes the
 * signal for similarity search.
 */
export function chunkForRetrieval(text: string): string[] {
  const chunks: string[] = [];

  // Clean up the text
  const cleaned = text
    .replace(/\n{3,}/g, "\n\n")     // collapse excessive newlines
    .replace(/[ \t]{2,}/g, " ")      // collapse excessive spaces
    .trim();

  if (cleaned.length <= CHUNK_SIZE) {
    return [cleaned];
  }

  let start = 0;
  while (start < cleaned.length) {
    let end = start + CHUNK_SIZE;

    if (end < cleaned.length) {
      // Try to break at a paragraph boundary
      const paragraphBreak = cleaned.lastIndexOf("\n\n", end);
      if (paragraphBreak > start + CHUNK_SIZE * 0.4) {
        end = paragraphBreak;
      } else {
        // Fall back to sentence boundary
        const sentenceBreak = cleaned.lastIndexOf(". ", end);
        if (sentenceBreak > start + CHUNK_SIZE * 0.4) {
          end = sentenceBreak + 1;
        }
      }
    } else {
      end = cleaned.length;
    }

    const chunk = cleaned.substring(start, end).trim();
    if (chunk.length > 50) {  // drop tiny chunks
      chunks.push(chunk);
    }

    // Move forward with overlap
    start = end - CHUNK_OVERLAP;
    if (start < 0) start = 0;
    if (end >= cleaned.length) break;
  }

  return chunks;
}

// ── Ingest (chunk + embed + store) ───────────────────────────────────────────

import { createClient } from "@/lib/supabase/server";

/**
 * Chunk a document, embed each chunk, and store in Supabase.
 * Returns the number of chunks stored.
 */
export async function ingestDocument(
  expertId: string,
  text: string,
  filename: string,
): Promise<{ chunksStored: number }> {
  const supabase = await createClient();
  const chunks = chunkForRetrieval(text);

  console.log(`[RAG] Chunked "${filename}" into ${chunks.length} pieces`);

  // Batch embed all chunks
  const embeddings = await embedTexts(chunks);

  console.log(`[RAG] Embedded ${embeddings.length} chunks`);

  // Store in Supabase — batch insert
  const rows = chunks.map((content, i) => ({
    expert_id: expertId,
    content,
    embedding: `[${embeddings[i].join(",")}]`,  // pgvector expects string format
    source_filename: filename,
    chunk_index: i,
  }));

  // Insert in batches of 50 to avoid payload limits
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
  content: string;
  source_filename: string;
  chunk_index: number;
  similarity: number;
}

/**
 * Retrieve the top-K most relevant chunks for a query from an expert's knowledge base.
 * Uses pgvector cosine similarity search via an RPC function.
 */
export async function retrieveChunks(
  query: string,
  expertId: string,
  topK: number = 5,
): Promise<RetrievedChunk[]> {
  const supabase = await createClient();

  // Embed the query
  const queryEmbedding = await embedText(query);

  // Call the Supabase RPC function for vector similarity search
  const { data, error } = await supabase.rpc("match_expert_chunks", {
    query_embedding: `[${queryEmbedding.join(",")}]`,
    target_expert_id: expertId,
    match_count: topK,
    match_threshold: 0.3,  // minimum similarity score
  });

  if (error) {
    console.error("[RAG] Retrieval error:", error);
    throw new Error(`Retrieval failed: ${error.message}`);
  }

  return (data || []).map((row: any) => ({
    content: row.content,
    source_filename: row.source_filename,
    chunk_index: row.chunk_index,
    similarity: row.similarity,
  }));
}

// ── Generate (retrieve + prompt + answer) ────────────────────────────────────

export interface RAGResponse {
  reply: string;
  sources: { filename: string; chunkIndex: number; similarity: number }[];
}

/**
 * Full RAG pipeline: embed query → retrieve chunks → build grounded prompt → generate answer.
 */
export async function generateRAGResponse(
  query: string,
  expertId: string,
  systemPrompt: string,
  chatHistory: { role: string; content: string }[] = [],
): Promise<RAGResponse> {
  // 1. Retrieve relevant chunks
  const chunks = await retrieveChunks(query, expertId, 5);

  console.log(`[RAG] Retrieved ${chunks.length} chunks (top similarity: ${chunks[0]?.similarity?.toFixed(3) ?? "N/A"})`);

  // 2. Build grounded prompt
  const sourcesText = chunks.length > 0
    ? chunks.map((c, i) => `[Source ${i + 1} — ${c.source_filename}]:\n${c.content}`).join("\n\n")
    : "No relevant sources found in the knowledge base.";

  const groundedSystemPrompt = `${systemPrompt}

IMPORTANT RULES:
- Answer the user's question using ONLY the information from the Sources below.
- If the answer is NOT in the sources, say "I don't have information about that in my knowledge base."
- Do NOT make up facts, names, numbers, or details that aren't in the sources.
- When possible, mention which source your answer comes from.
- Be concise and direct.

Sources:
${sourcesText}`;

  // 3. Build message history for Groq
  const groqHistory: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    { role: "system", content: groundedSystemPrompt }
  ];

  for (const msg of chatHistory) {
    if (msg.role === "user" || msg.role === "model") {
      groqHistory.push({
        role: msg.role === "user" ? "user" : "assistant",
        content: msg.content
      });
    }
  }

  // Add the current query
  groqHistory.push({ role: "user", content: query });

  const completion = await groq.chat.completions.create({
    messages: groqHistory,
    model: "openai/gpt-oss-120b",
    temperature: 0.3,
    max_completion_tokens: 2048,
  });

  const reply = completion.choices[0]?.message?.content?.trim() ?? "I couldn't generate a response.";

  return {
    reply,
    sources: chunks.map((c) => ({
      filename: c.source_filename,
      chunkIndex: c.chunk_index,
      similarity: c.similarity,
    })),
  };
}

export { EMBEDDING_DIMENSIONS };
