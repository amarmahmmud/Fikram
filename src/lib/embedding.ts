// ─────────────────────────────────────────────
// Embedding & Retrieval Library for RAG
// ─────────────────────────────────────────────
// Uses Gemini text-embedding-004 (free, 768 dimensions) for embeddings
// and Supabase pgvector for storage + similarity search.
//
// CHANGELOG (this version):
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

import { GoogleGenerativeAI } from "@google/generative-ai";
import Groq from "groq-sdk";
import { createClient } from "@/lib/supabase/server";
import { searchWeb, WebSearchResult } from "@/lib/web-search";

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GEMINI_API_KEY!);
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY! });

// ── Embedding ────────────────────────────────────────────────────────────────

const EMBEDDING_MODEL = "gemini-embedding-2";
const EMBEDDING_DIMENSIONS = 768;

/**
 * Helper to pause execution.
 */
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Generate an embedding vector for a single text string with retry on 429 quota.
 */
export async function embedText(text: string): Promise<number[]> {
  const model = genAI.getGenerativeModel({ model: EMBEDDING_MODEL });
  let attempts = 0;
  while (attempts < 5) {
    attempts++;
    try {
      const result = await model.embedContent({
        content: { role: "user" as const, parts: [{ text }] },
        outputDimensionality: EMBEDDING_DIMENSIONS,
      } as any);
      return result.embedding.values;
    } catch (err: any) {
      const isQuota = err.status === 429 || err.message?.includes("429") || err.message?.includes("Quota");
      if (isQuota && attempts < 5) {
        console.warn(`[Embedding] Gemini quota hit on embedText, retrying in 8s (attempt ${attempts}/5)...`);
        await delay(8000);
      } else {
        throw err;
      }
    }
  }
  throw new Error("Failed to embed text after retries");
}

/**
 * Generate embeddings for multiple texts in batch with sub-batching and retry on 429 quota.
 * Google Gemini batchEmbedContents accepts at most 100 requests per batch and 100 req/min on free tier.
 */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  const model = genAI.getGenerativeModel({ model: EMBEDDING_MODEL });
  const BATCH_SIZE = 50;
  const allEmbeddings: number[][] = [];

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const slice = texts.slice(i, i + BATCH_SIZE);
    let attempts = 0;
    let success = false;

    while (!success && attempts < 5) {
      attempts++;
      try {
        const result = await model.batchEmbedContents({
          requests: slice.map((text) => ({
            content: { role: "user" as const, parts: [{ text }] },
            outputDimensionality: EMBEDDING_DIMENSIONS,
          } as any)),
        });
        allEmbeddings.push(...result.embeddings.map((e) => e.values));
        success = true;
      } catch (err: any) {
        const isQuota = err.status === 429 || err.message?.includes("429") || err.message?.includes("Quota");
        if (isQuota && attempts < 5) {
          console.warn(`[Embedding] Gemini quota hit on batch ${i / BATCH_SIZE + 1}, retrying in 8s (attempt ${attempts}/5)...`);
          await delay(8000);
        } else {
          throw err;
        }
      }
    }
  }

  return allEmbeddings;
}

// ── Section-aware chunking ────────────────────────────────────────────────────

const CHUNK_SIZE = 800;     // char soft-cap within a section
const CHUNK_OVERLAP = 100;  // overlap between sub-chunks of the same section

export interface SectionChunk {
  content: string;
  sectionTitle: string;   // e.g. "3. Enzyme-Converted 'Universal' Kidney"
  sectionTier: "primary" | "secondary"; // primary = numbered major section, secondary = catch-all/bulleted
  sectionIndex: number;   // order of the section in the doc
  chunkIndexInSection: number;
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
}[] {
  const lines = text.split("\n");

  // Headers that mark the start of a "secondary" (catch-all / minor) block,
  // even though they aren't numbered like the primary sections.
  const SECONDARY_HEADER_RE =
    /^(?:\d+\.\s+)?(additional notable advances|other science highlights|notes for|disclaimer)/i;
  const PRIMARY_HEADER_RE = /^\d+\.\s+\S/;

  const sections: { title: string; tier: "primary" | "secondary"; body: string }[] = [];
  let currentTitle = "Preamble";
  let currentTier: "primary" | "secondary" = "primary";
  let buffer: string[] = [];

  const flush = () => {
    const body = buffer.join("\n").trim();
    if (body.length > 0) {
      sections.push({ title: currentTitle, tier: currentTier, body });
    }
    buffer = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();

    if (SECONDARY_HEADER_RE.test(trimmed)) {
      flush();
      currentTitle = trimmed;
      currentTier = "secondary";
      continue;
    }

    if (PRIMARY_HEADER_RE.test(trimmed)) {
      flush();
      currentTitle = trimmed;
      currentTier = "primary";
      continue;
    }

    buffer.push(line);
  }
  flush();

  // If nothing matched (no numbered headers at all), treat the whole
  // document as one primary section rather than losing content.
  if (sections.length === 0) {
    return [{ title: "Document", tier: "primary", body: text.trim() }];
  }

  return sections;
}

/**
 * Char-based sub-splitting WITHIN a single section, same logic as before
 * but scoped so a chunk can never cross a section boundary.
 */
function splitSectionBody(body: string): string[] {
  const cleaned = body
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();

  if (cleaned.length <= CHUNK_SIZE) {
    return cleaned.length > 0 ? [cleaned] : [];
  }

  const chunks: string[] = [];
  let start = 0;
  while (start < cleaned.length) {
    let end = start + CHUNK_SIZE;

    if (end < cleaned.length) {
      const paragraphBreak = cleaned.lastIndexOf("\n\n", end);
      if (paragraphBreak > start + CHUNK_SIZE * 0.4) {
        end = paragraphBreak;
      } else {
        const sentenceBreak = cleaned.lastIndexOf(". ", end);
        if (sentenceBreak > start + CHUNK_SIZE * 0.4) {
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
 * Each chunk carries section metadata (title + tier) so retrieval/generation
 * can distinguish numbered "major" sections from catch-all "minor" ones,
 * instead of relying on embedding similarity alone.
 */
export function chunkForRetrieval(text: string): SectionChunk[] {
  const sections = splitIntoSections(text);
  const result: SectionChunk[] = [];

  sections.forEach((section, sectionIndex) => {
    const subChunks = splitSectionBody(section.body);
    subChunks.forEach((content, chunkIndexInSection) => {
      result.push({
        content,
        sectionTitle: section.title,
        sectionTier: section.tier,
        sectionIndex,
        chunkIndexInSection,
      });
    });
  });

  return result;
}

// ── Ingest (chunk + embed + store) ───────────────────────────────────────────

/**
 * Chunk a document, embed each chunk, and store in Supabase — now with
 * section_title / section_tier / section_index columns so retrieval and
 * generation can reason about document structure, not just raw similarity.
 *
 * NOTE: requires the `expert_chunks` table to have `section_title` (text),
 * `section_tier` (text), and `section_index` (int) columns. Existing rows
 * without these columns will still work; add the columns via migration:
 *   ALTER TABLE expert_chunks
 *     ADD COLUMN section_title text,
 *     ADD COLUMN section_tier text,
 *     ADD COLUMN section_index int;
 */
export async function ingestDocument(
  expertId: string,
  text: string,
  filename: string,
): Promise<{ chunksStored: number }> {
  const supabase = await createClient();
  const chunks = chunkForRetrieval(text);

  console.log(
    `[RAG] Chunked "${filename}" into ${chunks.length} section-aware pieces ` +
    `(${new Set(chunks.map((c) => c.sectionTitle)).size} sections)`,
  );

  const embeddings = await embedTexts(chunks.map((c) => c.content));

  console.log(`[RAG] Embedded ${embeddings.length} chunks`);

  const rows = chunks.map((chunk, i) => ({
    expert_id: expertId,
    content: chunk.content,
    embedding: `[${embeddings[i].join(",")}]`,
    source_filename: filename,
    chunk_index: i,
    section_title: chunk.sectionTitle,
    section_tier: chunk.sectionTier,
    section_index: chunk.sectionIndex,
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
  content: string;
  source_filename: string;
  chunk_index: number;
  similarity: number;
  section_title?: string;
  section_tier?: "primary" | "secondary";
}

/**
 * Heuristic: broad/summarization-style queries need more chunks to reach
 * full coverage across sections than narrow factual lookups do.
 * Keeps the fix simple (no extra LLM call) while fixing the top-5-starves-
 * coverage problem that caused the "summarize the five breakthroughs" miss.
 */
function adaptiveTopK(query: string): number {
  const BROAD_QUERY_RE =
    /\b(summariz|summary|all|every|each|list|overview|entire|complete|full report)\b/i;

  // Questions that assert a specific count ("two", "3", "the five", "how many")
  // need MORE chunks, not fewer — the model can only catch a mismatched count
  // if it actually sees every matching item, not just enough to fill the
  // asserted number.
  const COUNT_ASSERTION_RE =
    /\b(how many|which (two|three|four|five|\d+)|name (two|three|four|five|\d+)|the (two|three|four|five|\d+))\b/i;

  if (BROAD_QUERY_RE.test(query) || COUNT_ASSERTION_RE.test(query)) {
    return 12;
  }
  return 5;
}

/**
 * Retrieve the top-K most relevant chunks for a query from an expert's
 * knowledge base. topK now adapts to query breadth by default, but can
 * still be overridden explicitly.
 */
export async function retrieveChunks(
  query: string,
  expertId: string,
  topK?: number,
  matchThreshold: number = 0.3,
): Promise<RetrievedChunk[]> {
  const supabase = await createClient();
  const resolvedTopK = topK ?? adaptiveTopK(query);

  const queryEmbedding = await embedText(query);

  const { data, error } = await supabase.rpc("match_expert_chunks", {
    query_embedding: `[${queryEmbedding.join(",")}]`,
    target_expert_id: expertId,
    match_count: resolvedTopK,
    match_threshold: matchThreshold,
  });

  if (error) {
    console.error("[RAG] Retrieval error:", error);
    throw new Error(`Retrieval failed: ${error.message}`);
  }

  let rows = data || [];

  if (rows.length > 0 && rows[0].section_tier === undefined) {
    // The RPC might not return the new columns. Fallback to fetching them by ID.
    const ids = rows.map((r: any) => r.id).filter(Boolean);
    if (ids.length > 0) {
      const { data: chunksData } = await supabase
        .from("expert_chunks")
        .select("id, section_title, section_tier")
        .in("id", ids);

      if (chunksData) {
        const chunksMap = new Map(chunksData.map((c) => [c.id, c]));
        rows = rows.map((r: any) => ({
          ...r,
          section_title: chunksMap.get(r.id)?.section_title,
          section_tier: chunksMap.get(r.id)?.section_tier,
        }));
      }
    }
  }

  return rows.map((row: any) => ({
    content: row.content,
    source_filename: row.source_filename,
    chunk_index: row.chunk_index,
    similarity: row.similarity,
    section_title: row.section_title,
    section_tier: row.section_tier,
  }));
}

// ── Generate (retrieve + prompt + answer) ────────────────────────────────────

export interface GenerateRAGOptions {
  reasoningMode?: "strict" | "evaluative" | "hybrid";
  webSearchEnabled?: boolean;
}

export interface RAGResponse {
  reply: string;
  sources: {
    filename: string;
    chunkIndex: number;
    similarity: number;
    sectionTitle?: string;
    sectionTier?: string;
  }[];
  webSources?: WebSearchResult[];
}

/**
 * Full RAG pipeline: embed query → retrieve chunks → (optional live web search) → build dynamic prompt → generate answer.
 * Adapts instructions based on reasoningMode ("strict" | "evaluative" | "hybrid") and includes live web intelligence if webSearchEnabled.
 */
export async function generateRAGResponse(
  query: string,
  expertId: string,
  systemPrompt: string,
  chatHistory: { role: string; content: string }[] = [],
  options?: GenerateRAGOptions,
): Promise<RAGResponse> {
  const chunks = await retrieveChunks(query, expertId);

  console.log(
    `[RAG] Retrieved ${chunks.length} chunks (top similarity: ${chunks[0]?.similarity?.toFixed(3) ?? "N/A"}) | Mode: ${options?.reasoningMode || "hybrid"} | WebSearch: ${options?.webSearchEnabled ? "ON" : "OFF"}`,
  );

  const sourcesText =
    chunks.length > 0
      ? chunks
        .map((c, i) => {
          const tierLabel = c.section_tier
            ? ` | tier: ${c.section_tier}`
            : "";
          const sectionLabel = c.section_title
            ? ` | section: "${c.section_title}"`
            : "";
          return `[Source ${i + 1} — ${c.source_filename}${sectionLabel}${tierLabel}]:\n${c.content}`;
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
  const mode = options?.reasoningMode || "hybrid";
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
- The Sources below provide your internal evaluation frameworks, scoring rubrics, benchmark data, and historical failure patterns.
- APPLY these frameworks and rubrics directly to the pitch using first-principles deductive reasoning, physical laws, market realities, unit economics, and sharp common sense.
- Never say "the rubric says" or "Source 4 mentions"; internalize the criteria and speak with confidence and authority in your established persona.
- If an idea is fundamentally broken or flawed, assign aggressive failing scores (0–2/10) on Feasibility, Timing, Defensibility, or Economics. Roast the fatal flaws with precision, wit, and constructive truth.
- Do not refuse to evaluate an idea just because the exact product name or concept isn't mentioned in your documents. Map it to the closest category, technical difficulty tier, and market dynamics.`;
  } else {
    // Hybrid / Balanced
    modeInstructions = `
OPERATING RULES (BALANCED HYBRID MODE):
- Use the Sources below as your primary foundation of facts, principles, and guidelines.
- You are encouraged to extrapolate, explain, give real-world context, and reason using general world knowledge while remaining grounded in the themes and principles of your knowledge base.
- If the user asks about an idea or topic not literally in your files, use your best judgment to connect it to your knowledge base principles.
- Maintain your persona naturally without mechanically citing sources unless requested.`;
  }

  const webInstruction = webResults.length > 0
    ? `\n- Real-time Web Search Intelligence is included below. Weave in relevant current news, competitors, and market updates to ensure your analysis is up to date.`
    : "";

  const finalGroundingBlock = mode === "evaluative"
    ? `\nGROUNDING & FACTUALITY RULES (CRITICAL — NEVER VIOLATE):
1. You may use first-principles logic (physics, math, unit economics) to deduce why an idea will fail.
2. DO NOT invent, fabricate, or hallucinate specific historical events, regulatory rulings, agency directives (e.g. fake FAA warnings/crackdowns), lawsuits, or startup post-mortems to make your point sound stronger.
3. If a pitch violates common sense or general law (e.g., flying drones into houses), point out the general legal barrier (e.g., FAA Part 107 BVLOS restrictions) WITHOUT inventing a specific year, warning, or fine that didn't happen.
4. When citing specific companies or post-mortems, rely ONLY on exact names present in your provided sources or live web intel. If not present, describe the failure pattern generically instead of inventing a name.`
    : "";

  const groundedSystemPrompt = `${systemPrompt}

${modeInstructions}
${webInstruction}

Internal Knowledge Base Sources:
${sourcesText}
${webSourcesText}
${finalGroundingBlock}`;

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

  const completion = await groq.chat.completions.create({
    messages: groqHistory,
    model: "openai/gpt-oss-120b",
    temperature: mode === "evaluative" ? 0.4 : 0.3,
    max_completion_tokens: 2048,
  });

  const reply = completion.choices[0]?.message?.content?.trim() ?? "I couldn't generate a response.";

  return {
    reply,
    sources: chunks.map((c) => ({
      filename: c.source_filename,
      chunkIndex: c.chunk_index,
      similarity: c.similarity,
      sectionTitle: c.section_title,
      sectionTier: c.section_tier,
    })),
    webSources: webResults,
  };
}

export { EMBEDDING_DIMENSIONS };