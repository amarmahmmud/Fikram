// ─────────────────────────────────────────────
// Advanced Multi-Stage Dataset Generation Pipeline
// ─────────────────────────────────────────────
import { GoogleGenerativeAI } from "@google/generative-ai";
import { WizardContext, buildContextBlock, EMPTY_WIZARD_CONTEXT } from "@/lib/wizard-types";

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
const GENERATION_PROMPT = (contextBlock: string, chunkIndex: number, totalChunks: number) => `You are an expert AI Data Engineer creating a fine-tuning dataset.

${contextBlock}

You are processing chunk ${chunkIndex + 1} of ${totalChunks} from a document. Generate diverse, high-quality Question & Answer pairs based STRICTLY on the content provided.

Generate 4 TYPES of pairs:
1. **Factual Recall** — "What is...?", "Who...?", "When...?" (direct knowledge)
2. **Application** — "How would you apply...?", "What steps...?" (practical usage)
3. **Comparison/Analysis** — "What's the difference between...?", "Why is X better than Y?" (deeper understanding)
4. **Scenario-Based** — "If a user wanted to..., what should they...?" (contextual advice)

IMPORTANT: Match the persona, audience level, style, and format specified above when writing completions.

Generate between 15 and 25 pairs for this chunk. Each pair must be a JSON object with "prompt" and "completion" keys.

Output ONLY a raw JSON array. No markdown, no code fences, no explanation.

Example:
[
  {"prompt": "What is habit stacking?", "completion": "Habit stacking is linking a new habit to an existing one using the formula: After I [CURRENT HABIT], I will [NEW HABIT]."},
  {"prompt": "How would you apply the Two-Minute Rule to start exercising?", "completion": "Scale the habit down: instead of 'run 5 miles', start with 'put on running shoes'. The goal is to make starting effortless."}
]`;

// Second-pass prompt focused specifically on direct fact/number/name recall
const RECALL_PROMPT = (contextBlock: string, chunkIndex: number, totalChunks: number) => `You are an expert AI Data Engineer creating a FACTUAL RECALL dataset for fine-tuning.

${contextBlock}

You are processing chunk ${chunkIndex + 1} of ${totalChunks} from a document. Generate direct, blunt Q&A pairs for EVERY specific number, name, date, percentage, proper noun, measurement, and concrete fact in this text.

Rules:
- Keep questions SHORT and LITERAL: "Who...?", "What...?", "How much...?", "When...?", "How many...?"
- Answers must match the target audience level and style specified above
- Cover EVERY specific fact, even minor ones — names of people, organizations, places, exact numbers, dates, technical terms
- If the same fact can be asked about from different angles (e.g. "Who did X?" and "What did Person do?"), include BOTH
- Do NOT generate scenario-based or application questions — those are handled separately

Generate between 10 and 20 pairs. Each pair must be a JSON object with "prompt" and "completion" keys.

Output ONLY a raw JSON array. No markdown, no code fences, no explanation.

Example:
[
  {"prompt": "What percentage efficiency did the new solar cells achieve?", "completion": "The new perovskite solar cells achieved 33.7% efficiency in laboratory tests."},
  {"prompt": "Who led the research team at MIT?", "completion": "Dr. Sarah Chen led the research team at MIT's Department of Materials Science."}
]`;

// Third-pass prompt: rephrase key facts for reinforcement (repeated exposure)
const REINFORCEMENT_PROMPT = (contextBlock: string, chunkIndex: number, totalChunks: number) => `You are an expert AI Data Engineer creating REINFORCEMENT pairs for a fine-tuning dataset.

${contextBlock}

You are processing chunk ${chunkIndex + 1} of ${totalChunks}. Your job is to take EVERY specific number, date, name, measurement, and key fact in this text and create 2-3 DIFFERENTLY WORDED question-answer pairs for each one.

The goal is repetition through rephrasing — the model needs to see the same fact asked about in multiple ways to memorize it.

Rules:
- For each key fact, generate at least 2 variants with DIFFERENT question phrasing but the SAME factual answer
- Vary question structure: "What was...", "How much...", "According to the text, what...", "What number/date/amount..."
- Answers should be concise, match the style/format specified above, and directly state the fact
- Focus especially on: exact numbers, dates, timelines, percentages, names, and technical terms
- Do NOT add interpretation — just restate the fact

Generate between 10 and 20 pairs. Each pair must be a JSON object with "prompt" and "completion" keys.

Output ONLY a raw JSON array. No markdown, no code fences, no explanation.

Example:
[
  {"prompt": "What efficiency did the solar cells achieve?", "completion": "The perovskite solar cells achieved 33.7% efficiency."},
  {"prompt": "According to the text, what was the efficiency percentage of the new solar cells?", "completion": "33.7% efficiency in laboratory tests."},
  {"prompt": "How efficient were the perovskite cells in lab testing?", "completion": "They achieved 33.7% efficiency in laboratory tests."}
]`;

// Fourth-pass prompt: teach "I don't know" behavior (anti-hallucination)
const NEGATIVE_PROMPT = (contextBlock: string, chunkIndex: number, totalChunks: number) => `You are an expert AI Data Engineer creating NEGATIVE KNOWLEDGE pairs for a fine-tuning dataset.

${contextBlock}

You are processing chunk ${chunkIndex + 1} of ${totalChunks}. Your job is to generate questions about PLAUSIBLE details that someone might ask about this text but which are NOT actually stated or answerable from the text.

This teaches the model to refuse fabrication and stay within its boundaries.

Rules:
- Ask about details a reader would REASONABLY expect to find (names of people not mentioned, exact dates not given, specific numbers not stated, locations not specified)
- Answers must reflect the model's persona and boundaries specified above. Use natural variations like:
  - "Based on the information I have, this is not specified..."
  - "I don't have specific information about that in my training material."
  - "That detail is not covered in my knowledge base."
  - "I can't provide that specific information — it's not in the materials I was trained on."
- Questions should sound natural and specific, not vague
- Do NOT ask about things that ARE in the text

Generate between 5 and 10 pairs. Each pair must be a JSON object with "prompt" and "completion" keys.

Output ONLY a raw JSON array. No markdown, no code fences, no explanation.

Example:
[
  {"prompt": "Who was the lead surgeon for the procedure?", "completion": "I don't have that specific information — the materials I was trained on don't name a lead surgeon for the procedure."},
  {"prompt": "What was the exact date of the clinical trial?", "completion": "That detail isn't covered in my training material. I'd recommend checking the original research publication for exact dates."},
  {"prompt": "How much did the research cost?", "completion": "I can't provide the cost of the research — that information isn't in the materials I have access to."}
]`;

export async function generateForChunk(
  text: string,
  goal: string,
  chunkIndex: number,
  totalChunks: number,
  promptTemplateOrContextBlock: ((contextBlock: string, chunkIndex: number, totalChunks: number) => string) | string = GENERATION_PROMPT as any,
  label: string = "general",
): Promise<DatasetPair[]> {
  const model = genAI.getGenerativeModel({ model: "gemini-3.6-flash" });

  // Support both: a prompt template function (internal pipeline use) or a raw context block string (preview-pairs API)
  let promptText: string;
  if (typeof promptTemplateOrContextBlock === "string") {
    // Raw context block passed directly — wrap in the general generation prompt format
    promptText = GENERATION_PROMPT(promptTemplateOrContextBlock, chunkIndex, totalChunks);
  } else {
    promptText = promptTemplateOrContextBlock(goal, chunkIndex, totalChunks);
  }

  try {
    const result = await model.generateContent({
      contents: [{
        role: "user",
        parts: [{
          text: `${promptText}\n\nDocument chunk:\n\n${text}`
        }]
      }],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 8192,
      },
    });

    const raw = result.response.text() || "[]";
    const pairs = parseJsonArray(raw);
    console.log(`[Pipeline] Chunk ${chunkIndex + 1}/${totalChunks} (${label}): generated ${pairs.length} pairs`);
    return pairs;
  } catch (error: any) {
    console.error(`[Pipeline] Error generating chunk ${chunkIndex + 1} (${label}):`, error?.message || error);
    return [];
  }
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
  onProgress?: (progress: PipelineProgress) => void,
  wizardContext?: WizardContext
): Promise<{ pairs: DatasetPair[]; jsonl: string; stats: PipelineStats }> {

  // Build the enriched context block from wizard context (or fall back to bare goal)
  const ctx = wizardContext ?? { ...EMPTY_WIZARD_CONTEXT, goal };
  if (!ctx.goal && goal) ctx.goal = goal;
  const contextBlock = buildContextBlock(ctx);

  // ── Stage 1: Chunk ──
  onProgress?.({
    stage: "chunking",
    message: "Splitting document into chunks...",
    chunksTotal: 0,
    chunksProcessed: 0,
    pairsGenerated: 0,
  });

  // Cap chunks at 20 to keep generation time reasonable while ensuring
  // enough data volume for effective LoRA fine-tuning (target: 100+ pairs).
  let chunks = smartChunk(text);
  if (chunks.length > 20) {
    console.log(`[Pipeline] Document has ${chunks.length} chunks. Capping to 20.`);
    chunks = chunks.slice(0, 20);
  }
  const totalChunks = chunks.length;

  onProgress?.({
    stage: "chunking",
    message: `Split into ${totalChunks} chunks`,
    chunksTotal: totalChunks,
    chunksProcessed: 0,
    pairsGenerated: 0,
  });

  // ── Stage 2a: General generation pass (diverse Q&A types) ──
  const allPairs: DatasetPair[] = [];
  // Process ONE chunk at a time to avoid Gemini rate limits on free tier
  const PARALLEL_LIMIT = 1;

  for (let i = 0; i < chunks.length; i += PARALLEL_LIMIT) {
    const batch = chunks.slice(i, i + PARALLEL_LIMIT);
    const promises = batch.map((chunk, batchIdx) =>
      generateForChunk(chunk, contextBlock, i + batchIdx, totalChunks, GENERATION_PROMPT, "general")
    );

    const results = await Promise.all(promises);
    for (const pairs of results) {
      allPairs.push(...pairs);
    }

    console.log(`[Pipeline] General pass: chunk ${i+1}/${totalChunks} done, total pairs: ${allPairs.length}`);

    // 4-second delay between requests to stay well under Gemini's 15 RPM limit
    if (i + PARALLEL_LIMIT < totalChunks) {
      await new Promise(resolve => setTimeout(resolve, 4000));
    }

    onProgress?.({
      stage: "generating",
      message: `General pass: processing chunks... (${Math.min(i + PARALLEL_LIMIT, totalChunks)}/${totalChunks})`,
      chunksTotal: totalChunks,
      chunksProcessed: Math.min(i + PARALLEL_LIMIT, totalChunks),
      pairsGenerated: allPairs.length,
    });
  }

  console.log(`[Pipeline] General pass complete. Pairs so far: ${allPairs.length}`);

  // ── Stage 2b: Recall-focused generation pass (names, numbers, dates) ──
  // Uses a different prompt to generate blunt factual-recall pairs that
  // complement the general pass's reasoning/scenario pairs.
  for (let i = 0; i < chunks.length; i += PARALLEL_LIMIT) {
    const batch = chunks.slice(i, i + PARALLEL_LIMIT);
    const promises = batch.map((chunk, batchIdx) =>
      generateForChunk(chunk, contextBlock, i + batchIdx, totalChunks, RECALL_PROMPT, "recall")
    );

    const results = await Promise.all(promises);
    for (const pairs of results) {
      allPairs.push(...pairs);
    }

    console.log(`[Pipeline] Recall pass: chunk ${i+1}/${totalChunks} done, total pairs: ${allPairs.length}`);

    // 4-second delay between requests
    if (i + PARALLEL_LIMIT < totalChunks) {
      await new Promise(resolve => setTimeout(resolve, 4000));
    }

    onProgress?.({
      stage: "generating",
      message: `Recall pass: processing chunks... (${Math.min(i + PARALLEL_LIMIT, totalChunks)}/${totalChunks})`,
      chunksTotal: totalChunks,
      chunksProcessed: totalChunks + Math.min(i + PARALLEL_LIMIT, totalChunks),
      pairsGenerated: allPairs.length,
    });
  }

  console.log(`[Pipeline] Recall pass complete. Pairs so far: ${allPairs.length}`);

  // ── Stage 2c: Reinforcement pass (rephrased variants of key facts) ──
  // Generates 2-3 differently worded Q&A pairs for each key fact, so
  // single-mention numbers/dates get repeated exposure during training.
  for (let i = 0; i < chunks.length; i += PARALLEL_LIMIT) {
    const batch = chunks.slice(i, i + PARALLEL_LIMIT);
    const promises = batch.map((chunk, batchIdx) =>
      generateForChunk(chunk, contextBlock, i + batchIdx, totalChunks, REINFORCEMENT_PROMPT, "reinforcement")
    );

    const results = await Promise.all(promises);
    for (const pairs of results) {
      allPairs.push(...pairs);
    }

    console.log(`[Pipeline] Reinforcement pass: chunk ${i+1}/${totalChunks} done, total pairs: ${allPairs.length}`);

    if (i + PARALLEL_LIMIT < totalChunks) {
      await new Promise(resolve => setTimeout(resolve, 4000));
    }

    onProgress?.({
      stage: "generating",
      message: `Reinforcement pass: processing chunks... (${Math.min(i + PARALLEL_LIMIT, totalChunks)}/${totalChunks})`,
      chunksTotal: totalChunks,
      chunksProcessed: totalChunks * 2 + Math.min(i + PARALLEL_LIMIT, totalChunks),
      pairsGenerated: allPairs.length,
    });
  }

  console.log(`[Pipeline] Reinforcement pass complete. Pairs so far: ${allPairs.length}`);

  // ── Stage 2d: Negative knowledge pass ("I don't know" training) ──
  // Generates questions about plausible details NOT in the text, with answers
  // that explicitly say the document doesn't specify. Teaches the model to
  // refuse fabrication.
  for (let i = 0; i < chunks.length; i += PARALLEL_LIMIT) {
    const batch = chunks.slice(i, i + PARALLEL_LIMIT);
    const promises = batch.map((chunk, batchIdx) =>
      generateForChunk(chunk, contextBlock, i + batchIdx, totalChunks, NEGATIVE_PROMPT, "negative")
    );

    const results = await Promise.all(promises);
    for (const pairs of results) {
      allPairs.push(...pairs);
    }

    console.log(`[Pipeline] Negative pass: chunk ${i+1}/${totalChunks} done, total pairs: ${allPairs.length}`);

    if (i + PARALLEL_LIMIT < totalChunks) {
      await new Promise(resolve => setTimeout(resolve, 4000));
    }

    onProgress?.({
      stage: "generating",
      message: `Negative knowledge pass: processing chunks... (${Math.min(i + PARALLEL_LIMIT, totalChunks)}/${totalChunks})`,
      chunksTotal: totalChunks,
      chunksProcessed: totalChunks * 3 + Math.min(i + PARALLEL_LIMIT, totalChunks),
      pairsGenerated: allPairs.length,
    });
  }

  console.log(`[Pipeline] All generation passes complete. Total raw pairs: ${allPairs.length}`);

  console.log(`[Pipeline] Generation complete. Raw pairs: ${allPairs.length}`);

  // If we got 0 raw pairs, something is fundamentally wrong (rate limits, API key, etc.)
  if (allPairs.length === 0) {
    console.error(`[Pipeline] FAILED: Generated 0 pairs from ${totalChunks} chunks. Check Gemini API key and rate limits.`);
  }

  // ── Stage 3: Validate ──
  onProgress?.({
    stage: "validating",
    message: `Validating ${allPairs.length} pairs for quality...`,
    chunksTotal: totalChunks,
    chunksProcessed: totalChunks,
    pairsGenerated: allPairs.length,
  });

  let validated = await validateAndScore(allPairs, ctx.goal || goal);
  console.log(`[Pipeline] After validation: ${validated.length} pairs (was ${allPairs.length})`);

  // Safety: if validation removed everything, keep the raw pairs
  if (validated.length === 0 && allPairs.length > 0) {
    console.warn(`[Pipeline] Validation removed ALL pairs. Keeping raw pairs as fallback.`);
    validated = allPairs;
  }

  // ── Stage 4: Deduplicate ──
  onProgress?.({
    stage: "deduplicating",
    message: `Removing duplicates from ${validated.length} pairs...`,
    chunksTotal: totalChunks,
    chunksProcessed: totalChunks,
    pairsGenerated: validated.length,
  });

  const final = deduplicatePairs(validated);
  console.log(`[Pipeline] After dedup: ${final.length} pairs`);

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
