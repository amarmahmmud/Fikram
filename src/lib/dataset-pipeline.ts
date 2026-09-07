// ─────────────────────────────────────────────
// Advanced Multi-Stage Dataset Generation Pipeline
// ─────────────────────────────────────────────
// CHANGELOG:
// - Fix 1: Context-preserving chunking — headings/attributions carry forward
// - Fix 2: Verbatim number enforcement in all generation prompts
// - Fix 3: Answer-aware deduplication with conflict detection
// - Fix 4: Provenance metadata (source_chunk, pass_type) on every pair
// - Fix 5: Reinforcement pass constrained to verbatim-only answers
// - Fix 6: Post-generation number verification + comparative guardrail
// ─────────────────────────────────────────────
import { WizardContext, buildContextBlock, EMPTY_WIZARD_CONTEXT } from "@/lib/wizard-types";
import { generateWithModelFallback } from "@/lib/gemini";
import crypto from "crypto";

export interface DatasetPair {
  prompt: string;
  completion: string;
  /** Provenance metadata — stripped before SFTTrainer, retained in R2 for audit */
  _meta?: {
    source_chunk_index: number;
    pass_type: string;
    source_hash: string;
  };
}

export interface PipelineProgress {
  stage: "chunking" | "generating" | "validating" | "deduplicating" | "complete";
  message: string;
  chunksTotal: number;
  chunksProcessed: number;
  pairsGenerated: number;
}

// ─────────────────────────────────────────────
// Stage 1: Smart Chunking (Context-Preserving)
// ─────────────────────────────────────────────
// FIX 1: Headings and attribution sentences ("According to McKinsey...") are
// carried forward into each chunk so numbers are never separated from their
// labels. This prevents the LLM from guessing what a naked "30%" refers to.
const CHUNK_SIZE = 4000;    // chars per chunk
const CHUNK_OVERLAP = 400;  // overlap between chunks for context continuity

// Regex to detect headings / section titles
const HEADING_RE = /^(?:#{1,4}\s+.+|\d+\.\s+\S.+|[A-Z][A-Z\s]{3,}[A-Z]\s*$)/m;
// Regex to detect attribution sentences ("According to X", "X reports that", etc.)
const ATTRIBUTION_RE = /(?:according to|reported by|published by|data from|research by|estimates? (?:by|from)|study by|analysis by|survey by)\s+[A-Z][\w\s&',.-]+/gi;

/**
 * Extract the last heading visible before `position` in the text.
 */
function findLastHeading(text: string, position: number): string | null {
  const region = text.substring(0, position);
  const lines = region.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const trimmed = lines[i].trim();
    if (HEADING_RE.test(trimmed)) {
      return trimmed;
    }
  }
  return null;
}

/**
 * Extract any attribution sentence ("According to McKinsey...") from the
 * first 500 chars of a text region — used to carry context into the next chunk.
 */
function findAttribution(text: string): string | null {
  const match = text.match(ATTRIBUTION_RE);
  return match ? match[0] : null;
}

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

    let chunkText = cleaned.substring(start, end).trim();

    // FIX 1: Carry forward context from preceding text into this chunk
    if (start > 0) {
      const contextParts: string[] = [];

      // Carry forward the last heading visible before this chunk
      const heading = findLastHeading(cleaned, start);
      if (heading && !chunkText.startsWith(heading)) {
        contextParts.push(`[Section: ${heading}]`);
      }

      // Carry forward any attribution sentence from the overlap region
      const overlapRegion = cleaned.substring(Math.max(0, start - CHUNK_OVERLAP), start);
      const attribution = findAttribution(overlapRegion);
      if (attribution) {
        contextParts.push(`[Context: ${attribution}]`);
      }

      if (contextParts.length > 0) {
        chunkText = contextParts.join("\n") + "\n\n" + chunkText;
      }
    }

    chunks.push(chunkText);

    // Move forward with overlap
    start = end - CHUNK_OVERLAP;
    if (start < 0) start = 0;
    // Prevent infinite loop
    if (end >= cleaned.length) break;
  }

  return chunks.filter((c) => c.length > 100); // drop tiny chunks
}


// ─────────────────────────────────────────────
// Stage 2: Fact Extraction & Generation
// ─────────────────────────────────────────────
const FACT_EXTRACTION_PROMPT = `You are an expert AI Data Engineer extracting facts from a document chunk for a fine-tuning dataset.

Extract ALL specific facts, numbers, dates, comparisons, and named entities from this chunk. Classify each fact into exactly one of these types:
- SINGLE_STAT (one number, one label — e.g., "300 million jobs")
- PAIRED_STAT (two numbers that must stay linked, comparisons, "X vs Y")
- NAMED_ENTITY_FACT (a fact tied to a specific proper noun, person, or organization)
- CONCEPTUAL (a definition or framework explanation, not a raw number)

Output ONLY a raw JSON array of objects with keys "fact" (the exact text/concept) and "type" (one of the 4 types above).
Example:
[
  {"fact": "The new solar cells achieved 33.7% efficiency", "type": "SINGLE_STAT"},
  {"fact": "21.5% without AI vs 29.5% with AI", "type": "PAIRED_STAT"},
  {"fact": "Dr. Sarah Chen led the research team at MIT", "type": "NAMED_ENTITY_FACT"}
]`;

const FACT_GENERATION_PROMPT = (contextBlock: string, chunkIndex: number, totalChunks: number) => `You are an expert AI Data Engineer generating Q&A pairs for a fine-tuning dataset.

${contextBlock}

You are processing chunk ${chunkIndex + 1} of ${totalChunks}.
I will provide a list of facts extracted from this chunk. Generate diverse Question & Answer pairs for EVERY fact based on its type.

DYNAMIC RECORD COUNT AND RULES BY FACT TYPE:
- CONCEPTUAL: Generate 2-3 pairs. Vary the structural wording (e.g. "What is...", "How does...").
- SINGLE_STAT: Generate 3-4 pairs. Vary question structure, but strict verbatim number enforcement in answers.
- PAIRED_STAT: Generate 5-8 pairs. You MUST explicitly include at least 1 direct comparison question ("What is the difference between X and Y?", "Compare..."). Never swap the subjects in the answer.
- NAMED_ENTITY_FACT: Generate 4-6 pairs. You MUST explicitly include at least 1 contrastive negative question ("Is it true that [wrong entity] did this?" -> "No, actually [correct entity] did.").

CRITICAL NUMBER ACCURACY RULES:
- NEVER round, approximate, or restate any number, percentage, date, or measurement. Use the EXACT value.
- In comparative statements, NEVER swap the subjects.

Output ONLY a raw JSON array where each object represents a fact and its generated pairs:
[
  {
    "fact": "the extracted fact string",
    "type": "the fact type",
    "pairs": [
      {"prompt": "...", "completion": "..."},
      {"prompt": "...", "completion": "..."}
    ]
  }
]
No markdown. No explanation.`;

export interface ExtractedFact {
  fact: string;
  type: "SINGLE_STAT" | "PAIRED_STAT" | "NAMED_ENTITY_FACT" | "CONCEPTUAL";
}

export interface ValidationReport {
  fact: string;
  type: string;
  issue: string;
}

export async function generatePairsForChunk(
  text: string,
  contextBlock: string,
  chunkIndex: number,
  totalChunks: number,
): Promise<{ pairs: DatasetPair[], report: ValidationReport[] }> {
  // 1. Extract facts
  let facts: ExtractedFact[] = [];
  try {
    const extResult = await generateWithModelFallback(
      `${FACT_EXTRACTION_PROMPT}\n\nDocument chunk:\n\n${text}`,
      { generationConfig: { temperature: 0.1 } }
    );
    facts = parseJsonArray(extResult.response.text() || "[]") as ExtractedFact[];
  } catch (e) {
    console.error(`[Pipeline] Fact extraction failed for chunk ${chunkIndex + 1}`, e);
    return { pairs: [], report: [] };
  }
  
  if (facts.length === 0) return { pairs: [], report: [] };

  // 2. Generate pairs for facts
  // Cap to top 5 key facts per chunk to prevent 60s+ timeouts and JSON token truncation
  const targetFacts = facts.slice(0, 5);
  const promptText = FACT_GENERATION_PROMPT(contextBlock, chunkIndex, totalChunks);
  let generatedGroups: any[] = [];
  try {
    const genResult = await generateWithModelFallback(
      `${promptText}\n\nExtracted Facts:\n${JSON.stringify(targetFacts, null, 2)}\n\nDocument chunk:\n\n${text}`,
      { generationConfig: { temperature: 0.3, maxOutputTokens: 4096 } }
    );
    const rawText = genResult.response.text() || "[]";
    generatedGroups = parseJsonArray(rawText);
    if (generatedGroups.length === 0) {
      console.warn(`[Pipeline] Warning: parseJsonArray returned 0 groups from raw text length ${rawText.length}`);
    }
  } catch (e) {
    console.error(`[Pipeline] Fact generation failed for chunk ${chunkIndex + 1}`, e);
    return { pairs: [], report: [] };
  }

  // 3. Flatten and Validate
  const allPairs: DatasetPair[] = [];
  const validationReport: ValidationReport[] = [];
  const sourceHash = crypto.createHash("md5").update(text.substring(0, 500)).digest("hex").substring(0, 12);

  for (const group of generatedGroups) {
    const type = group.type || "UNKNOWN";
    const pairs: DatasetPair[] = group.pairs || [];
    
    // Check minimum counts
    let minExpected = 0;
    if (type === "CONCEPTUAL") minExpected = 2;
    if (type === "SINGLE_STAT") minExpected = 3;
    if (type === "NAMED_ENTITY_FACT") minExpected = 4;
    if (type === "PAIRED_STAT") minExpected = 5;

    if (pairs.length < minExpected) {
       validationReport.push({ fact: group.fact, type, issue: `Generated ${pairs.length} pairs, expected >= ${minExpected}` });
    }

    // Check specific structures
    if (type === "PAIRED_STAT") {
       const hasComparison = pairs.some(p => {
         const q = p.prompt.toLowerCase();
         return q.includes("difference") || q.includes("compare") || q.includes("vs") || q.includes("versus");
       });
       if (!hasComparison) validationReport.push({ fact: group.fact, type, issue: "Missing direct comparison prompt" });
    }
    if (type === "NAMED_ENTITY_FACT") {
       const hasContrastive = pairs.some(p => {
         const q = p.prompt.toLowerCase();
         const a = p.completion.toLowerCase();
         return q.includes("not") || q.includes("true that") || a.includes("actually") || a.includes("no,") || a.includes("incorrect");
       });
       if (!hasContrastive) validationReport.push({ fact: group.fact, type, issue: "Missing contrastive negative pair" });
    }

    // Assign provenance
    for (const p of pairs) {
      if (p.prompt && p.completion) {
        p._meta = { source_chunk_index: chunkIndex, pass_type: type, source_hash: sourceHash };
        allPairs.push(p);
      }
    }
  }

  let finalPairs = verifyNumbersAgainstSource(allPairs, text, "fact-aware");
  finalPairs = checkComparativeSwaps(finalPairs, text, "fact-aware");

  console.log(`[Pipeline] Chunk ${chunkIndex + 1}/${totalChunks}: extracted ${facts.length} facts, generated ${finalPairs.length} valid pairs`);
  return { pairs: finalPairs, report: validationReport };
}


// ─────────────────────────────────────────────
// Stage 3: Quality Validation
// ─────────────────────────────────────────────
async function validateAndScore(pairs: DatasetPair[], goal: string): Promise<DatasetPair[]> {
  if (pairs.length === 0) return [];

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
      const result = await generateWithModelFallback(
        validationPrompt,
        {
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 8192,
          },
        }
      );

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
// Stage 4: Deduplication (Answer-Aware)
// ─────────────────────────────────────────────
// FIX 3: Dedup now also checks for conflicting answers about the same fact.
// When two pairs have similar questions but contradicting numerical answers,
// the pair from the earlier (more reliable) pass wins.
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
    let duplicateKey: string | null = null;
    for (const [existingKey] of seen) {
      if (similarity(normalized, existingKey) > 0.85) {
        isDuplicate = true;
        duplicateKey = existingKey;
        break;
      }
    }

    if (isDuplicate && duplicateKey) {
      // FIX 3: Answer conflict detection — if both pairs contain numbers,
      // check whether the numbers match. Keep the one from the earlier pass.
      const existing = seen.get(duplicateKey)!;
      const existingNumbers = extractNumbers(existing.completion);
      const newNumbers = extractNumbers(pair.completion);

      if (existingNumbers.length > 0 && newNumbers.length > 0) {
        const hasConflict = !arraysOverlap(existingNumbers, newNumbers);
        if (hasConflict) {
          // Prefer the pair from the earlier/more reliable pass
          const existingPassPriority = getPassPriority(existing._meta?.pass_type);
          const newPassPriority = getPassPriority(pair._meta?.pass_type);
          if (newPassPriority < existingPassPriority) {
            // New pair is from a more reliable pass — replace
            console.log(`[Pipeline Dedup] Conflicting answers for similar questions, keeping ${pair._meta?.pass_type} over ${existing._meta?.pass_type}`);
            seen.set(duplicateKey, pair);
          } else {
            console.log(`[Pipeline Dedup] Conflicting answers detected, keeping existing ${existing._meta?.pass_type} pair`);
          }
        }
      }
      // If no number conflict or no numbers at all, just skip (keep existing)
    } else if (!isDuplicate && normalized.length > 10) {
      seen.set(normalized, pair);
    }
  }

  return Array.from(seen.values());
}

/** Pass priority: lower = more reliable / earlier in pipeline */
function getPassPriority(passType?: string): number {
  switch (passType) {
    case "recall": return 0;         // most reliable — blunt factual recall
    case "general": return 1;        // diverse Q&A
    case "reinforcement": return 2;  // rephrased variants — highest corruption risk
    case "negative": return 3;       // "I don't know" pairs
    default: return 1;
  }
}

/** Extract all numbers (integers, decimals, percentages) from text */
function extractNumbers(text: string): string[] {
  const matches = text.match(/\d+(?:\.\d+)?%?/g);
  return matches ? matches.map(m => m.replace(/%$/, "")) : [];
}

/** Check if two number arrays have any overlap */
function arraysOverlap(a: string[], b: string[]): boolean {
  const setB = new Set(b);
  return a.some(n => setB.has(n));
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
// FIX 6: Post-Generation Verification
// ─────────────────────────────────────────────

/**
 * Verify that every number in a completion also appears in the source chunk.
 * Pairs with numbers NOT found in the source are flagged and removed —
 * they indicate the LLM fabricated or rounded a value.
 */
function verifyNumbersAgainstSource(pairs: DatasetPair[], sourceChunk: string, passLabel: string): DatasetPair[] {
  const sourceNumbers = new Set(extractNumbers(sourceChunk));
  if (sourceNumbers.size === 0) return pairs; // No numbers in source — nothing to verify

  return pairs.filter(pair => {
    const completionNumbers = extractNumbers(pair.completion);
    if (completionNumbers.length === 0) return true; // No numbers in completion — keep

    // Check each number in completion against source
    const fabricated = completionNumbers.filter(n => !sourceNumbers.has(n));

    // Allow small numbers (< 10) that are likely structural ("2 types", "3 steps")
    // rather than factual claims
    const significantFabricated = fabricated.filter(n => {
      const val = parseFloat(n);
      return val >= 10 || n.includes("."); // significant numbers or decimals
    });

    if (significantFabricated.length > 0) {
      console.warn(
        `[Pipeline Verify] REMOVED (${passLabel}): completion contains numbers [${significantFabricated.join(", ")}] ` +
        `not found in source chunk. Q: "${pair.prompt.substring(0, 60)}..."`
      );
      return false;
    }
    return true;
  });
}

/**
 * Detect comparative statement swaps — if a completion says "X% in A" but
 * the source says "X% in B" (where A and B are swapped subjects), remove it.
 * This catches the "advanced economies" ↔ "developing economies" inversion.
 */
function checkComparativeSwaps(pairs: DatasetPair[], sourceChunk: string, passLabel: string): DatasetPair[] {
  // Common comparative subject pairs that tend to get swapped
  const SUBJECT_PAIRS = [
    ["advanced economies", "developing economies"],
    ["developed countries", "developing countries"],
    ["high-income", "low-income"],
    ["urban", "rural"],
    ["men", "women"],
    ["male", "female"],
  ];

  const sourceLower = sourceChunk.toLowerCase();

  return pairs.filter(pair => {
    const completionLower = pair.completion.toLowerCase();

    for (const [subjectA, subjectB] of SUBJECT_PAIRS) {
      // Check if completion mentions either subject
      const completionHasA = completionLower.includes(subjectA);
      const completionHasB = completionLower.includes(subjectB);
      if (!completionHasA && !completionHasB) continue;

      // Extract "number + subject" patterns from both
      const numberSubjectRE = new RegExp(
        `(\\d+(?:\\.\\d+)?%?)\\s*(?:of\\s+|in\\s+|for\\s+|among\\s+)?(?:${subjectA}|${subjectB})`,
        "gi"
      );

      const sourceMatches = [...sourceLower.matchAll(numberSubjectRE)];
      const completionMatches = [...completionLower.matchAll(numberSubjectRE)];

      if (sourceMatches.length > 0 && completionMatches.length > 0) {
        // Check if the number-to-subject mapping is consistent
        for (const cm of completionMatches) {
          const cmNum = cm[1];
          const cmFull = cm[0].toLowerCase();

          // Find the same number in source
          const sourceMatch = sourceMatches.find(sm => sm[1] === cmNum);
          if (sourceMatch) {
            const smFull = sourceMatch[0].toLowerCase();
            // Same number but different subject = swap detected
            const cmHasA = cmFull.includes(subjectA);
            const smHasA = smFull.includes(subjectA);
            if (cmHasA !== smHasA) {
              console.warn(
                `[Pipeline Guardrail] REMOVED (${passLabel}): comparative swap detected. ` +
                `Source: "${sourceMatch[0]}" vs Completion: "${cm[0]}". ` +
                `Q: "${pair.prompt.substring(0, 60)}..."`
              );
              return false;
            }
          }
        }
      }
    }

    return true;
  });
}


// ─────────────────────────────────────────────
// JSON Parsing Helper
// ─────────────────────────────────────────────
function extractObjectsFromText(text: string): any[] {
  const results: any[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escape = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (char === "\\") {
      escape = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (!inString) {
      if (char === "{") {
        if (depth === 0) start = i;
        depth++;
      } else if (char === "}") {
        depth--;
        if (depth === 0 && start !== -1) {
          const candidate = text.substring(start, i + 1);
          try {
            results.push(JSON.parse(candidate));
          } catch {}
          start = -1;
        }
      }
    }
  }
  return results;
}

function parseJsonArray(raw: string): any[] {
  // Strip markdown fences and think tags
  let cleaned = raw
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/```json/gi, "")
    .replace(/```/gi, "")
    .trim();

  const startIdx = cleaned.indexOf("[");
  if (startIdx === -1) {
    return extractObjectsFromText(cleaned);
  }

  const arraySubstring = cleaned.substring(startIdx);
  const endIdx = arraySubstring.lastIndexOf("]");

  if (endIdx !== -1) {
    const candidate = arraySubstring.substring(0, endIdx + 1);
    try {
      const parsed = JSON.parse(candidate);
      if (Array.isArray(parsed)) return parsed;
    } catch {}
  }

  // Attempt to salvage truncated array by closing it at the last complete object
  const lastBrace = arraySubstring.lastIndexOf("}");
  if (lastBrace !== -1) {
    const truncatedCandidate = arraySubstring.substring(0, lastBrace + 1) + "]";
    try {
      const fixed = truncatedCandidate.replace(/,\s*\]$/, "]");
      const parsed = JSON.parse(fixed);
      if (Array.isArray(parsed)) return parsed;
    } catch {}
  }

  return extractObjectsFromText(cleaned);
}


// ─────────────────────────────────────────────
// Main Pipeline Entry Point
// ─────────────────────────────────────────────
export async function generateDataset(
  text: string,
  goal: string,
  onProgress?: (progress: PipelineProgress) => void,
  wizardContext?: WizardContext
): Promise<{ pairs: DatasetPair[]; jsonl: string; jsonlWithMeta: string; stats: PipelineStats }> {

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

  // ── Stage 2: Fact Extraction & Generation ──
  const allPairs: DatasetPair[] = [];
  const fullValidationReport: ValidationReport[] = [];
  
  // Process ONE chunk at a time to avoid Gemini rate limits
  const PARALLEL_LIMIT = 1;

  for (let i = 0; i < chunks.length; i += PARALLEL_LIMIT) {
    const batch = chunks.slice(i, i + PARALLEL_LIMIT);
    const promises = batch.map((chunk, batchIdx) =>
      generatePairsForChunk(chunk, contextBlock, i + batchIdx, totalChunks)
    );

    const results = await Promise.all(promises);
    for (const res of results) {
      allPairs.push(...res.pairs);
      fullValidationReport.push(...res.report);
    }

    console.log(`[Pipeline] Generation pass: chunk ${i + 1}/${totalChunks} done, total pairs: ${allPairs.length}`);

    // 4-second delay between requests to stay well under Gemini's 15 RPM limit
    if (i + PARALLEL_LIMIT < totalChunks) {
      await new Promise(resolve => setTimeout(resolve, 4000));
    }

    onProgress?.({
      stage: "generating",
      message: `Generating from extracted facts... (${Math.min(i + PARALLEL_LIMIT, totalChunks)}/${totalChunks})`,
      chunksTotal: totalChunks,
      chunksProcessed: Math.min(i + PARALLEL_LIMIT, totalChunks),
      pairsGenerated: allPairs.length,
    });
  }

  console.log(`\n[Pipeline] === PRE-TRAINING VALIDATION REPORT ===`);
  if (fullValidationReport.length === 0) {
    console.log(`[Pipeline] ✅ All facts successfully met density and structural requirements.`);
  } else {
    console.warn(`[Pipeline] ⚠️ ${fullValidationReport.length} facts failed constraints:`);
    for (const rep of fullValidationReport) {
      console.warn(`  - [${rep.type}] "${rep.fact.substring(0, 50)}...": ${rep.issue}`);
    }
  }
  console.log(`=================================================\n`);

  console.log(`[Pipeline] Fact-Aware Generation complete. Raw pairs: ${allPairs.length}`);

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
  // FIX 4: Build two versions — one with metadata for R2 audit, one clean for SFTTrainer.
  // The JSONL sent to training contains only prompt+completion (SFTTrainer expects this).
  // Metadata is logged to console for debugging.
  const jsonlForTraining = final.map((p) => JSON.stringify({ prompt: p.prompt, completion: p.completion })).join("\n");
  const jsonlWithMeta = final.map((p) => JSON.stringify(p)).join("\n");

  // Log provenance summary
  const passCounts = new Map<string, number>();
  for (const p of final) {
    const pass = p._meta?.pass_type ?? "unknown";
    passCounts.set(pass, (passCounts.get(pass) ?? 0) + 1);
  }
  console.log(`[Pipeline] Provenance breakdown: ${[...passCounts.entries()].map(([k, v]) => `${k}=${v}`).join(", ")}`);

  const stats: PipelineStats = {
    chunksProcessed: totalChunks,
    rawPairsGenerated: allPairs.length,
    afterValidation: validated.length,
    afterDedup: final.length,
    documentLength: text.length,
    sourceHash: crypto.createHash("md5").update(text).digest("hex"),
  };

  onProgress?.({
    stage: "complete",
    message: `Done! Generated ${final.length} high-quality pairs`,
    chunksTotal: totalChunks,
    chunksProcessed: totalChunks,
    pairsGenerated: final.length,
  });

  return { pairs: final, jsonl: jsonlForTraining, jsonlWithMeta, stats };
}

export interface PipelineStats {
  chunksProcessed: number;
  rawPairsGenerated: number;
  afterValidation: number;
  afterDedup: number;
  documentLength: number;
  /** MD5 hash of the full source document — for post-hoc verification */
  sourceHash: string;
}
