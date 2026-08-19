// ─────────────────────────────────────────────
// Advanced Multi-Stage Dataset Generation Pipeline
// ─────────────────────────────────────────────
import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GEMINI_API_KEY!);

export interface DatasetPair {
  prompt: string;
  completion: string;
}

export interface PipelineProgress {
  stage: "chunking" | "generating" | "validating" | "deduplicating" | "complete";
  message: string;
  chunksTotal: number;
  chunksProcessed: number;
  pairsGenerated: number;
}

// ─────────────────────────────────────────────
// Stage 1: Smart Chunking
// ─────────────────────────────────────────────
const CHUNK_SIZE = 4000;    // chars per chunk
const CHUNK_OVERLAP = 400;  // overlap between chunks for context continuity

export function smartChunk(text: string): string[] {
  const chunks: string[] = [];

  // Clean up the text first
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
      if (paragraphBreak > start + CHUNK_SIZE * 0.5) {
        end = paragraphBreak;
      } else {
        // Fall back to sentence boundary
        const sentenceBreak = cleaned.lastIndexOf(". ", end);
        if (sentenceBreak > start + CHUNK_SIZE * 0.5) {
          end = sentenceBreak + 1; // include the period
        }
      }
    } else {
      end = cleaned.length;
    }

    chunks.push(cleaned.substring(start, end).trim());

    // Move forward with overlap
    start = end - CHUNK_OVERLAP;
    if (start < 0) start = 0;
    // Prevent infinite loop
    if (end >= cleaned.length) break;
  }

  return chunks.filter((c) => c.length > 100); // drop tiny chunks
}


// ─────────────────────────────────────────────
// Stage 2: Parallel Generation (per chunk)
// ─────────────────────────────────────────────
const GENERATION_PROMPT = (goal: string, chunkIndex: number, totalChunks: number) => `You are an expert AI Data Engineer creating a fine-tuning dataset.

User's Goal: ${goal || "Extract knowledge into Q&A format."}

You are processing chunk ${chunkIndex + 1} of ${totalChunks} from a document. Generate diverse, high-quality Question & Answer pairs based STRICTLY on the content provided.

Generate 4 TYPES of pairs:
1. **Factual Recall** — "What is...?", "Who...?", "When...?" (direct knowledge)
2. **Application** — "How would you apply...?", "What steps...?" (practical usage)
3. **Comparison/Analysis** — "What's the difference between...?", "Why is X better than Y?" (deeper understanding)
4. **Scenario-Based** — "If a user wanted to..., what should they...?" (contextual advice)

Generate between 8 and 15 pairs for this chunk. Each pair must be a JSON object with "prompt" and "completion" keys.

Output ONLY a raw JSON array. No markdown, no code fences, no explanation.

Example:
[
  {"prompt": "What is habit stacking?", "completion": "Habit stacking is linking a new habit to an existing one using the formula: After I [CURRENT HABIT], I will [NEW HABIT]."},
  {"prompt": "How would you apply the Two-Minute Rule to start exercising?", "completion": "Scale the habit down: instead of 'run 5 miles', start with 'put on running shoes'. The goal is to make starting effortless."}
]`;

async function generateForChunk(
  text: string,
  goal: string,
  chunkIndex: number,
  totalChunks: number
): Promise<DatasetPair[]> {
  const model = genAI.getGenerativeModel({ model: "gemini-3.6-flash" });

  const result = await model.generateContent({
    contents: [{
      role: "user",
      parts: [{
        text: `${GENERATION_PROMPT(goal, chunkIndex, totalChunks)}\n\nDocument chunk:\n\n${text}`
      }]
    }],
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens: 4096,
    },
  });

  const raw = result.response.text() || "[]";
  return parseJsonArray(raw);
}


// ─────────────────────────────────────────────
// Stage 3: Quality Validation
// ─────────────────────────────────────────────
async function validateAndScore(pairs: DatasetPair[], goal: string): Promise<DatasetPair[]> {
  if (pairs.length === 0) return [];

  const model = genAI.getGenerativeModel({ model: "gemini-3.6-flash" });

  // Process in batches to stay within token limits
  const BATCH_SIZE = 50;
  const validatedPairs: DatasetPair[] = [];

  for (let i = 0; i < pairs.length; i += BATCH_SIZE) {
    const batch = pairs.slice(i, i + BATCH_SIZE);

    const validationPrompt = `You are a dataset quality reviewer. Review these Q&A pairs for a fine-tuning dataset.

User's training goal: ${goal || "Knowledge Q&A"}

For each pair, evaluate:
1. Is the question clear and well-formed?
2. Is the answer accurate and complete (not hallucinated)?
3. Is the pair useful for fine-tuning?

Return ONLY the pairs that score 7/10 or higher. Remove:
- Duplicate or near-duplicate questions
- Vague or generic questions ("What is important?")
- Answers that are too short (< 10 words) or too long (> 300 words)
- Hallucinated or fabricated content

Output ONLY a raw JSON array of the surviving pairs. No markdown, no explanation.

Pairs to review:
${JSON.stringify(batch, null, 2)}`;

    try {
      const result = await model.generateContent({
        contents: [{ role: "user", parts: [{ text: validationPrompt }] }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 8192,
        },
      });

      const validated = parseJsonArray(result.response.text() || "[]");
      validatedPairs.push(...validated);
    } catch {
      // If validation fails for a batch, keep the originals
      validatedPairs.push(...batch);
    }
  }

  return validatedPairs;
}


// ─────────────────────────────────────────────
// Stage 4: Deduplication
// ─────────────────────────────────────────────
function deduplicatePairs(pairs: DatasetPair[]): DatasetPair[] {
  const seen = new Map<string, DatasetPair>();

  for (const pair of pairs) {
    // Normalize prompt for comparison
    const normalized = pair.prompt
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, "")
      .replace(/\s+/g, " ")
      .trim();

    // Check for exact or near-duplicate prompts
    let isDuplicate = false;
    for (const [existingKey] of seen) {
      if (similarity(normalized, existingKey) > 0.85) {
        isDuplicate = true;
        break;
      }
    }

    if (!isDuplicate && normalized.length > 10) {
      seen.set(normalized, pair);
    }
  }

  return Array.from(seen.values());
}

/** Simple Jaccard similarity for deduplication */
function similarity(a: string, b: string): number {
  const wordsA = new Set(a.split(" "));
  const wordsB = new Set(b.split(" "));
  const intersection = new Set([...wordsA].filter((x) => wordsB.has(x)));
  const union = new Set([...wordsA, ...wordsB]);
  return union.size === 0 ? 0 : intersection.size / union.size;
}


// ─────────────────────────────────────────────
// JSON Parsing Helper
// ─────────────────────────────────────────────
function parseJsonArray(raw: string): DatasetPair[] {
  // Strip markdown fences and think tags
  let cleaned = raw
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/```json/gi, "")
    .replace(/```/gi, "")
    .trim();

  // Extract JSON array
  const startIdx = cleaned.indexOf("[");
  const endIdx = cleaned.lastIndexOf("]");
  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
    return [];
  }
  cleaned = cleaned.substring(startIdx, endIdx + 1);

  try {
    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed)) return [];
    // Validate each pair has required fields
    return parsed.filter(
      (p: any) =>
        typeof p.prompt === "string" &&
        typeof p.completion === "string" &&
        p.prompt.trim().length > 5 &&
        p.completion.trim().length > 5
    );
  } catch {
    return [];
  }
}


// ─────────────────────────────────────────────
// Main Pipeline Entry Point
// ─────────────────────────────────────────────
export async function generateDataset(
  text: string,
  goal: string,
  onProgress?: (progress: PipelineProgress) => void
): Promise<{ pairs: DatasetPair[]; jsonl: string; stats: PipelineStats }> {

  // ── Stage 1: Chunk ──
  onProgress?.({
    stage: "chunking",
    message: "Splitting document into chunks...",
    chunksTotal: 0,
    chunksProcessed: 0,
    pairsGenerated: 0,
  });

  const chunks = smartChunk(text);
  const totalChunks = chunks.length;

  onProgress?.({
    stage: "chunking",
    message: `Split into ${totalChunks} chunks`,
    chunksTotal: totalChunks,
    chunksProcessed: 0,
    pairsGenerated: 0,
  });

  // ── Stage 2: Generate in parallel batches ──
  const allPairs: DatasetPair[] = [];
  const PARALLEL_LIMIT = 3; // max concurrent Gemini calls

  for (let i = 0; i < chunks.length; i += PARALLEL_LIMIT) {
    const batch = chunks.slice(i, i + PARALLEL_LIMIT);
    const promises = batch.map((chunk, batchIdx) =>
      generateForChunk(chunk, goal, i + batchIdx, totalChunks)
        .catch(() => [] as DatasetPair[]) // don't fail the whole pipeline for one chunk
    );

    const results = await Promise.all(promises);
    for (const pairs of results) {
      allPairs.push(...pairs);
    }

    onProgress?.({
      stage: "generating",
      message: `Processing chunks... (${Math.min(i + PARALLEL_LIMIT, totalChunks)}/${totalChunks})`,
      chunksTotal: totalChunks,
      chunksProcessed: Math.min(i + PARALLEL_LIMIT, totalChunks),
      pairsGenerated: allPairs.length,
    });
  }

  // ── Stage 3: Validate ──
  onProgress?.({
    stage: "validating",
    message: `Validating ${allPairs.length} pairs for quality...`,
    chunksTotal: totalChunks,
    chunksProcessed: totalChunks,
    pairsGenerated: allPairs.length,
  });

  const validated = await validateAndScore(allPairs, goal);

  // ── Stage 4: Deduplicate ──
  onProgress?.({
    stage: "deduplicating",
    message: `Removing duplicates from ${validated.length} pairs...`,
    chunksTotal: totalChunks,
    chunksProcessed: totalChunks,
    pairsGenerated: validated.length,
  });

  const final = deduplicatePairs(validated);

  // ── Build JSONL ──
  const jsonl = final.map((p) => JSON.stringify(p)).join("\n");

  const stats: PipelineStats = {
    chunksProcessed: totalChunks,
    rawPairsGenerated: allPairs.length,
    afterValidation: validated.length,
    afterDedup: final.length,
    documentLength: text.length,
  };

  onProgress?.({
    stage: "complete",
    message: `Done! Generated ${final.length} high-quality pairs`,
    chunksTotal: totalChunks,
    chunksProcessed: totalChunks,
    pairsGenerated: final.length,
  });

  return { pairs: final, jsonl, stats };
}

export interface PipelineStats {
  chunksProcessed: number;
  rawPairsGenerated: number;
  afterValidation: number;
  afterDedup: number;
  documentLength: number;
}
