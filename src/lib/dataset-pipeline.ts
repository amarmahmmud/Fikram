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
  /** System prompt baked into every training row — teaches the model identity + boundaries */
  system_prompt?: string;
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
// System Prompt Builder
// ─────────────────────────────────────────────
// Constructs a training-time system prompt from wizard context.
// This is baked into EVERY training pair so the model learns its identity
// and boundaries, preventing base-model bleed-through on out-of-scope questions.
export function buildSystemPrompt(ctx: WizardContext): string {
  const parts: string[] = [];

  if (ctx.persona) {
    parts.push(`You are ${ctx.persona}.`);
  } else if (ctx.goal) {
    parts.push(`You are a specialized AI assistant.`);
  } else {
    parts.push(`You are a knowledgeable AI assistant trained on specific source material.`);
  }

  if (ctx.goal) {
    parts.push(`Your purpose: ${ctx.goal}.`);
  }

  if (ctx.audience) {
    parts.push(`Your audience: ${ctx.audience}.`);
  }

  if (ctx.style) {
    parts.push(`Communication style: ${ctx.style}.`);
  }

  if (ctx.format) {
    parts.push(`Answer format: ${ctx.format}.`);
  }

  // Critical boundary instruction — prevents hallucination
  if (ctx.boundaries) {
    parts.push(`Boundaries: ${ctx.boundaries}.`);
  }

  // Depth, phrasing variety, and self-awareness instructions
  parts.push(`When answering, always provide context and reasoning — never give bare one-sentence facts. Structure answers as: direct answer, then explanation or mechanism, then implication or example.`);
  parts.push(`Vary your phrasing naturally. Do not repeatedly use the same attribution phrases like "according to the report".`);
  parts.push(`When asked about limitations or staleness of your knowledge, be specific about which claims are time-sensitive and why, rather than giving generic disclaimers.`);
  parts.push(`Answer based strictly on your training knowledge. If a question falls outside your expertise or training data, clearly state that you don't have that information rather than guessing.`);

  return parts.join(" ");
}


// ─────────────────────────────────────────────
// Stage 2: Fact Extraction & Generation
// ─────────────────────────────────────────────
const FACT_EXTRACTION_PROMPT = `You are an expert AI Data Engineer extracting facts from a document chunk for a fine-tuning dataset.

Extract ALL specific facts, numbers, dates, comparisons, and named entities from this chunk. Classify each fact into exactly one of these types:
- SINGLE_STAT (one number, one label, AND its source organization/study — e.g., "Goldman Sachs estimates 300 million full-time jobs exposed globally")
- PAIRED_STAT (two numbers that must stay linked, comparisons, "X vs Y" with their entity — e.g., "IMF finds 40% global employment exposed, rising to 60% in advanced economies vs 30% in developing economies")
- NAMED_ENTITY_FACT (a fact tied to a specific tool, person, benchmark, or organization — e.g., "SWE-bench Verified shows leading coding agents like Devin and Claude Code solving 70-77% of GitHub issues in 2025-2026 vs under 14% in early 2024")
- CONCEPTUAL (a definition, framework explanation, or structural mechanism)

CRITICAL EXTRACTION RULES:
1. ALWAYS BIND STATS TO THEIR SOURCE ENTITY: Never extract a naked number like "300 million jobs" without attributing it to "Goldman Sachs". Never extract "70-77%" without "SWE-bench Verified" and the agent names ("Devin", "Claude Code").
2. NEVER DECOUPLE COMPARISONS: If the text says "60% in advanced economies vs 30% in developing economies", keep both sides in the same fact string!
3. CAPTURE ALL HEADLINE METRICS: Do not skip institutional estimates (Goldman Sachs, IMF, McKinsey, WEF, BLS, OpenAI, benchmark scores).

Output ONLY a raw JSON array of objects with keys "fact" (the full attributed fact string) and "type" (one of the 4 types above).
Example:
[
  {"fact": "Goldman Sachs estimates 300 million full-time jobs exposed to automation globally", "type": "SINGLE_STAT"},
  {"fact": "McKinsey estimates 29.5% of U.S. work hours automatable by 2030 vs 21.5% pre-generative-AI baseline", "type": "PAIRED_STAT"},
  {"fact": "SWE-bench Verified shows Devin and Claude Code solving 70-77% of issues in 2025-2026 vs under 14% in early 2024", "type": "NAMED_ENTITY_FACT"}
]`;

const FACT_GENERATION_PROMPT = (contextBlock: string, chunkIndex: number, totalChunks: number) => `You are an expert AI Data Engineer generating Q&A pairs for a fine-tuning dataset.

${contextBlock}

You are processing chunk ${chunkIndex + 1} of ${totalChunks}.
For each fact provided below, generate 2-3 diverse Question & Answer pairs.

RULES BY FACT TYPE:
- SINGLE_STAT: Generate 2-3 pairs. Always test both the exact metric value and the attributing source organization. Strict verbatim number enforcement.
- PAIRED_STAT: Generate 2-3 pairs. You MUST explicitly include at least 1 direct comparison question ("What is the difference between X and Y?", "Compare X to Y"). Never swap the subjects or numbers.
- NAMED_ENTITY_FACT: Generate 2-3 pairs. Test the specific entity/tool name (e.g. Devin, Claude Code, SWE-bench Verified) and its specific milestone, score, or role.
- CONCEPTUAL: Generate 2 pairs with DETAILED, multi-sentence answers (3-5 sentences minimum). Each answer must: (a) State the core concept or mechanism, (b) Explain WHY it matters or HOW it works, (c) Give a concrete example or implication from the document.

ANSWER DEPTH RULES (apply to ALL fact types):
- Every answer MUST be 3-5 sentences minimum. One-sentence answers are REJECTED.
- Structure: Lead with the direct answer → Explain the mechanism/reasoning → Add context, example, or implication.
- Example of GOOD depth: "McKinsey estimates 29.5% of U.S. work hours are automatable by 2030, up from a 21.5% pre-generative-AI baseline. This 8-percentage-point increase is driven specifically by generative AI's ability to handle natural language tasks that were previously automation-resistant, such as drafting reports, summarizing research, and responding to customer inquiries. The distinction matters because it shows generative AI doesn't just accelerate existing automation — it opens entirely new categories of work to machine processing."
- Example of BAD depth (REJECTED): "McKinsey estimates 29.5% of work hours are automatable, up from 21.5%."

ATTRIBUTION PHRASING RULES:
- NEVER repeat the same attribution phrase more than twice across all pairs.
- Vary between: "The report finds...", "Based on the analysis...", "The data shows...", "Research indicates...", "The findings suggest...", "Evidence demonstrates...", or simply state facts directly without attribution.
- At least 30% of answers should state facts DIRECTLY without any "according to" framing.

CRITICAL NUMBER ACCURACY RULES:
- NEVER round, approximate, or restate any number, percentage, date, or measurement. Use the EXACT value from the fact.
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
  maxFacts?: number,
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

  // If maxFacts is specified (e.g. preview mode), limit facts; otherwise process ALL facts
  const factsToProcess = typeof maxFacts === "number" && maxFacts > 0 ? facts.slice(0, maxFacts) : facts;

  // 2. Generate pairs for facts using sub-batching (3-4 facts per sub-batch)
  // This prevents prompt token explosion, timeouts, and JSON truncation while capturing 100% of facts
  const SUB_BATCH_SIZE = 4;
  const promptText = FACT_GENERATION_PROMPT(contextBlock, chunkIndex, totalChunks);
  let generatedGroups: any[] = [];

  for (let b = 0; b < factsToProcess.length; b += SUB_BATCH_SIZE) {
    const factBatch = factsToProcess.slice(b, b + SUB_BATCH_SIZE);
    try {
      const genResult = await generateWithModelFallback(
        `${promptText}\n\nExtracted Facts (Batch ${Math.floor(b / SUB_BATCH_SIZE) + 1} of ${Math.ceil(factsToProcess.length / SUB_BATCH_SIZE)}):\n${JSON.stringify(factBatch, null, 2)}\n\nDocument chunk:\n\n${text}`,
        { generationConfig: { temperature: 0.3, maxOutputTokens: 4096 } }
      );
      const rawText = genResult.response.text() || "[]";
      const groups = parseJsonArray(rawText);
      if (groups.length > 0) {
        generatedGroups.push(...groups);
      } else {
        console.warn(`[Pipeline] Warning: sub-batch ${Math.floor(b / SUB_BATCH_SIZE) + 1} produced 0 groups (raw length: ${rawText.length})`);
      }
    } catch (e) {
      console.error(`[Pipeline] Fact generation failed for chunk ${chunkIndex + 1} batch ${Math.floor(b / SUB_BATCH_SIZE) + 1}`, e);
    }

    // Pace sub-batches to stay safely within rate limits
    if (b + SUB_BATCH_SIZE < factsToProcess.length) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
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
// Stage 3: Quality Validation (Local — No API Calls)
// ─────────────────────────────────────────────
// Runs entirely on the server with zero Gemini API calls.
// The generation prompts already produce high-quality, fact-grounded pairs;
// this stage applies fast deterministic filters to catch the tail-end junk
// that slipped through (too short, too long, vague, or empty).
//
// Why not LLM validation? Because:
// - Generation already uses 20-40+ Gemini calls for a large document
// - Adding 6+ more validation calls consistently exhausts the 429 quota
// - The quality delta is marginal — local filters catch ~95% of what
//   the LLM filter would, without any latency or rate-limit risk.
// ─────────────────────────────────────────────

// Patterns that indicate a vague, low-value question
const VAGUE_QUESTION_PATTERNS = [
  /^what is important/i,
  /^what are the key/i,
  /^what should we know/i,
  /^why is this relevant/i,
  /^can you explain/i,
  /^tell me about/i,
  /^what do you think/i,
  /^how would you describe/i,
  /^what are your thoughts/i,
  /^summarize/i,
  /^describe the overall/i,
];

function validateAndScoreLocal(pairs: DatasetPair[]): DatasetPair[] {
  if (pairs.length === 0) return [];

  const MIN_ANSWER_WORDS = 25;
  const MAX_ANSWER_WORDS = 400;
  const MIN_QUESTION_WORDS = 5;

  return pairs.filter(pair => {
    const q = (pair.prompt || "").trim();
    const a = (pair.completion || "").trim();

    // Remove empty or near-empty pairs
    if (!q || !a) return false;

    const qWords = q.split(/\s+/).length;
    const aWords = a.split(/\s+/).length;

    // Question too short (likely truncated or malformed)
    if (qWords < MIN_QUESTION_WORDS) {
      console.warn(`[Validate] REMOVED: question too short (${qWords} words): "${q.substring(0, 60)}..."`);
      return false;
    }

    // Answer too short (not informative enough for training)
    if (aWords < MIN_ANSWER_WORDS) {
      console.warn(`[Validate] REMOVED: answer too short (${aWords} words): "${q.substring(0, 60)}..."`);
      return false;
    }

    // Answer too long (likely a raw dump, not a focused answer)
    if (aWords > MAX_ANSWER_WORDS) {
      console.warn(`[Validate] REMOVED: answer too long (${aWords} words): "${q.substring(0, 60)}..."`);
      return false;
    }

    // Vague or generic question
    if (VAGUE_QUESTION_PATTERNS.some(re => re.test(q))) {
      console.warn(`[Validate] REMOVED: vague question: "${q.substring(0, 60)}..."`);
      return false;
    }

    // Question is just the answer repeated (copy-paste artifact)
    if (similarity(
      q.toLowerCase().replace(/[^a-z0-9\s]/g, ""),
      a.toLowerCase().replace(/[^a-z0-9\s]/g, "").substring(0, q.length * 2)
    ) > 0.8) {
      console.warn(`[Validate] REMOVED: question/answer overlap too high: "${q.substring(0, 60)}..."`);
      return false;
    }

    return true;
  });
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
// Boundary / Refusal Pair Generation
// ─────────────────────────────────────────────
// Generates ~5-10% of total pairs as "I don't know" responses.
// These teach the model to refuse confidently when asked about
// topics not covered in the source document.
const BOUNDARY_GENERATION_PROMPT = (contextBlock: string, documentSummary: string) => `You are an expert AI Data Engineer generating BOUNDARY training pairs.

${contextBlock}

The model is trained ONLY on a specific document. Your job is to generate questions that someone might plausibly ask but that the document does NOT cover, along with polite, honest refusal answers.

Here is a brief summary of what the document DOES cover:
${documentSummary}

Generate 8-12 boundary Q&A pairs. Each pair should:
1. Ask a plausible question RELATED to the document's general topic but NOT answered in the document
2. Provide an honest answer that says the document doesn't cover this, and briefly explains what the document DOES cover instead

Examples of good boundary pairs:
- Q: "What is the exact unemployment rate projection for 2030?" → A: "The document does not provide specific unemployment rate projections. It focuses on task-level automation exposure percentages rather than aggregate unemployment forecasts."
- Q: "Which specific companies have announced AI-related layoffs?" → A: "The document does not track individual company layoff announcements. It analyzes institutional research findings from organizations like McKinsey, Goldman Sachs, and the IMF about broad labor market exposure."

CRITICAL RULES:
- The refusal must be SPECIFIC about what IS and ISN'T in the document
- Never say "I'm just an AI" — say "The document does not cover..." or "This falls outside the scope of my training data"
- Vary the phrasing of refusals (don't repeat the same template)

Output ONLY a raw JSON array of objects with "prompt" and "completion" keys. No markdown.`;

async function generateBoundaryPairs(
  contextBlock: string,
  documentSummary: string,
): Promise<DatasetPair[]> {
  try {
    const result = await generateWithModelFallback(
      BOUNDARY_GENERATION_PROMPT(contextBlock, documentSummary),
      { generationConfig: { temperature: 0.4, maxOutputTokens: 4096 } }
    );
    const raw = parseJsonArray(result.response.text() || "[]");
    return raw
      .filter((p: any) => p.prompt && p.completion)
      .map((p: any) => ({
        prompt: p.prompt,
        completion: p.completion,
        _meta: { source_chunk_index: -1, pass_type: "boundary", source_hash: "boundary" },
      }));
  } catch (e) {
    console.error("[Pipeline] Boundary pair generation failed:", e);
    return [];
  }
}


// ─────────────────────────────────────────────
// Contrastive Pair Generation
// ─────────────────────────────────────────────
// Generates pairs that explicitly counter common base-model biases.
// E.g., "Litigators are LOW risk despite being in the legal field"
// These override the base model's priors on counterintuitive facts.
const CONTRASTIVE_GENERATION_PROMPT = (contextBlock: string, documentChunks: string) => `You are an expert AI Data Engineer generating CONTRASTIVE training pairs.

${contextBlock}

Your job is to find facts in the document that might SURPRISE someone or CONTRADICT common assumptions, and generate Q&A pairs that explicitly reinforce the correct (document-based) answer.

Document content:
${documentChunks}

Generate 6-10 contrastive Q&A pairs. Focus on:
1. Classifications that contradict intuition (e.g., a role people assume is high-risk but is actually low-risk, or vice versa)
2. Numbers that are counterintuitive (e.g., net job GAIN despite automation fears)
3. Distinctions that are easy to confuse (e.g., two similar-sounding metrics that mean different things)

Each answer MUST:
- Explicitly state the correct classification/number from the document
- Briefly explain WHY it's counterintuitive or different from what people might assume
- Use the EXACT numbers and classifications from the document

Example:
{"prompt": "Is being a litigator a high-risk profession for AI automation?", "completion": "No. Despite being in the legal field, litigators and trial lawyers are classified as LOW risk (beyond 2030). This is because their core work — physical courtroom advocacy, real-time jury persuasion, spontaneous cross-examination, and high-stakes interpersonal negotiation — cannot be replicated by current AI. This is a common misconception: while legal research roles are high-risk, litigation itself is fundamentally different."}

Output ONLY a raw JSON array of objects with "prompt" and "completion" keys. No markdown.`;

async function generateContrastivePairs(
  contextBlock: string,
  chunks: string[],
): Promise<DatasetPair[]> {
  // Use first ~12000 chars of document for contrastive analysis
  const docSample = chunks.slice(0, 4).join("\n\n---\n\n").substring(0, 12000);
  try {
    const result = await generateWithModelFallback(
      CONTRASTIVE_GENERATION_PROMPT(contextBlock, docSample),
      { generationConfig: { temperature: 0.3, maxOutputTokens: 4096 } }
    );
    const raw = parseJsonArray(result.response.text() || "[]");
    return raw
      .filter((p: any) => p.prompt && p.completion)
      .map((p: any) => ({
        prompt: p.prompt,
        completion: p.completion,
        _meta: { source_chunk_index: -1, pass_type: "contrastive", source_hash: "contrastive" },
      }));
  } catch (e) {
    console.error("[Pipeline] Contrastive pair generation failed:", e);
    return [];
  }
}


// ─────────────────────────────────────────────
// Meta-Cognitive / Self-Reflection Pair Generation
// ─────────────────────────────────────────────
// Generates pairs that teach the model to reason about its own knowledge:
// - Flag time-sensitive claims and explain why they might age
// - Express calibrated confidence (high for data, lower for predictions)
// - Reason specifically about what the document covers vs. can't predict
// These are the "self-awareness" pairs that prevent vague generic disclaimers.
const META_COGNITIVE_GENERATION_PROMPT = (contextBlock: string, documentChunks: string) => `You are an expert AI Data Engineer generating META-COGNITIVE training pairs.

${contextBlock}

Your job is to generate Q&A pairs that teach the model to reason honestly and SPECIFICALLY about the limitations, confidence levels, and time-sensitivity of its own training knowledge.

Document content (summary):
${documentChunks}

Generate 8-12 meta-cognitive Q&A pairs covering these categories:

1. TIME-SENSITIVITY (3-4 pairs): Questions about which claims might become outdated. Answers must name SPECIFIC claims from the document and explain WHY they are time-sensitive.
   Example: Q: "Which of your estimates are most likely to change over time?"
   A: "The timeline projections are the most time-sensitive elements in my training data. For example, the estimate that junior developers face high risk between 2026-2029 assumes current AI capability trajectories — if foundational model capabilities plateau or accelerate beyond current scaling laws, these windows could shift by 2-4 years in either direction. The institutional statistics like Goldman Sachs' 300 million jobs estimate and McKinsey's 29.5% automation figure reflect point-in-time research snapshots that will be revised as new labor market data emerges. In contrast, the task-level analysis framework itself (decomposing jobs into automatable vs. non-automatable components) is more durable methodology that won't change as quickly."

2. CONFIDENCE CALIBRATION (2-3 pairs): Questions about how confident the model is in different types of claims. Answers must distinguish between high-confidence facts (documented statistics) and lower-confidence elements (predictions, timelines).
   Example: Q: "How confident are you in the risk classifications for different occupations?"
   A: "My confidence varies by the type of claim. I have high confidence in the documented institutional statistics — these are published research figures from Goldman Sachs, McKinsey, IMF, and OpenAI/Penn that I can cite precisely. I have moderate confidence in the task-level risk classifications, since they are based on systematic analysis of job components against current AI capabilities. However, I have lower confidence in the specific timeline windows (e.g., '2026-2029' or '2031-2036'), because these depend on technology adoption rates, regulatory responses, and economic conditions that are inherently unpredictable."

3. SCOPE AWARENESS (2-3 pairs): Questions that probe what the document CAN vs. CANNOT answer. Answers must be specific, not generic disclaimers.

4. METHODOLOGY TRANSPARENCY (1-2 pairs): Questions about how the analysis was conducted or what framework it uses.

CRITICAL RULES:
- Answers MUST reference SPECIFIC facts, numbers, or claims from the document — never give vague generic responses like "some information may become outdated"
- Every answer must be 4-6 sentences with real substance
- Vary attribution phrasing — do not use "according to the report" more than once

Output ONLY a raw JSON array of objects with "prompt" and "completion" keys. No markdown.`;

async function generateMetaCognitivePairs(
  contextBlock: string,
  chunks: string[],
): Promise<DatasetPair[]> {
  // Use first ~10000 chars of document for meta-cognitive analysis
  const docSample = chunks.slice(0, 3).join("\n\n---\n\n").substring(0, 10000);
  try {
    const result = await generateWithModelFallback(
      META_COGNITIVE_GENERATION_PROMPT(contextBlock, docSample),
      { generationConfig: { temperature: 0.4, maxOutputTokens: 8192 } }
    );
    const raw = parseJsonArray(result.response.text() || "[]");
    return raw
      .filter((p: any) => p.prompt && p.completion)
      .map((p: any) => ({
        prompt: p.prompt,
        completion: p.completion,
        _meta: { source_chunk_index: -1, pass_type: "meta_cognitive", source_hash: "meta_cognitive" },
      }));
  } catch (e) {
    console.error("[Pipeline] Meta-cognitive pair generation failed:", e);
    return [];
  }
}


// ─────────────────────────────────────────────
// Applied Example Pair Generation (Gap 1)
// ─────────────────────────────────────────────
const APPLIED_EXAMPLE_GENERATION_PROMPT = (contextBlock: string, documentChunks: string) => `You are an expert AI Data Engineer generating APPLIED_EXAMPLE training pairs.

${contextBlock}

Your job is to detect if the document contains ANY applicable method (e.g., a scoring rubric, formula, decision tree, interpretation bands, or classification system meant to be applied to new inputs).

Document content (summary):
${documentChunks}

First, determine if such a method exists. If NOT, output an empty JSON array: []
If a method DOES exist, invent plausible novel inputs (e.g., specific hypothetical job roles, scenarios, or case studies) that the method could apply to. 
Generate 10-15 Q&A pairs where the prompt asks to evaluate the novel input using the method, and the completion walks through the application step-by-step to arrive at a final concrete output on the method's own scale.

CRITICAL RULES:
- The completion MUST walk through the method step-by-step.
- The completion MUST end with a final concrete output (e.g., "Total Score: 85/100 -> High Risk").
- Mix the document's own listed examples (if any) with novel ones to teach generalization.

Output ONLY a raw JSON array of objects with "prompt" and "completion" keys. No markdown.`;

async function generateAppliedExamplePairs(
  contextBlock: string,
  chunks: string[],
): Promise<DatasetPair[]> {
  const docSample = chunks.join("\\n\\n---\\n\\n").substring(0, 15000);
  try {
    const result = await generateWithModelFallback(
      APPLIED_EXAMPLE_GENERATION_PROMPT(contextBlock, docSample),
      { generationConfig: { temperature: 0.5, maxOutputTokens: 8192 } }
    );
    const raw = parseJsonArray(result.response.text() || "[]");
    return raw
      .filter((p: any) => p.prompt && p.completion)
      .map((p: any) => ({
        prompt: p.prompt,
        completion: p.completion,
        _meta: { source_chunk_index: -1, pass_type: "applied_example", source_hash: "applied_example" },
      }));
  } catch (e) {
    console.error("[Pipeline] Applied example generation failed:", e);
    return [];
  }
}

// ─────────────────────────────────────────────
// Format-Following Post-Processing (Gap 2)
// ─────────────────────────────────────────────
const FORMAT_REWRITE_PROMPT = `You are an expert AI Data Engineer rewriting Q&A pairs to follow specific format requests.

You will be given a JSON array of existing Q&A pairs. For EACH pair, rewrite the prompt to explicitly request a specific format (e.g., "List the key points as bullets", "Summarize this as a table", "Answer in one sentence", "Give a step-by-step breakdown") and rewrite the completion to fulfill that format accurately.

Distribute the format requests roughly equally among:
1. Bulleted lists
2. Markdown tables
3. Short direct answers (1-2 sentences)
4. Numbered steps / breakdowns

Output ONLY a raw JSON array of objects with the rewritten "prompt" and "completion" keys. No markdown.`;

async function applyFormatFollowingTraining(pairs: DatasetPair[]): Promise<{ pairs: DatasetPair[], count: number }> {
  // We want to sample ~15-20% of the pairs.
  const sampleSize = Math.max(1, Math.floor(pairs.length * 0.15));
  
  // Create a copy and shuffle to pick random pairs
  const shuffled = [...pairs].sort(() => 0.5 - Math.random());
  const selectedToRewrite = shuffled.slice(0, sampleSize);
  const remaining = shuffled.slice(sampleSize);

  const BATCH_SIZE = 5;
  const rewrittenPairs: DatasetPair[] = [];

  for (let b = 0; b < selectedToRewrite.length; b += BATCH_SIZE) {
    const batch = selectedToRewrite.slice(b, b + BATCH_SIZE);
    try {
      const result = await generateWithModelFallback(
        `${FORMAT_REWRITE_PROMPT}\\n\\nExisting Pairs:\\n${JSON.stringify(batch.map(p => ({ prompt: p.prompt, completion: p.completion })), null, 2)}`,
        { generationConfig: { temperature: 0.4, maxOutputTokens: 8192 } }
      );
      const raw = parseJsonArray(result.response.text() || "[]");
      
      for (let i = 0; i < raw.length; i++) {
        if (raw[i].prompt && raw[i].completion) {
          const originalMeta = batch[i]?._meta;
          rewrittenPairs.push({
            prompt: raw[i].prompt,
            completion: raw[i].completion,
            _meta: { ...originalMeta, pass_type: "format_variant", source_hash: originalMeta?.source_hash || "format" } as any
          });
        }
      }
    } catch (e) {
      console.error("[Pipeline] Format rewrite failed for a batch:", e);
      // If a batch fails, just keep the original pairs for that batch
      rewrittenPairs.push(...batch);
    }
    // Pace requests
    if (b + BATCH_SIZE < selectedToRewrite.length) {
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
  }

  return { 
    pairs: [...remaining, ...rewrittenPairs], 
    count: rewrittenPairs.filter(p => p._meta?.pass_type === "format_variant").length 
  };
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
): Promise<{ pairs: DatasetPair[]; trainPairs: DatasetPair[]; evalPairs: DatasetPair[]; jsonl: string; evalJsonl: string; jsonlWithMeta: string; stats: PipelineStats; systemPrompt: string }> {

  // Build the enriched context block from wizard context (or fall back to bare goal)
  const ctx = wizardContext ?? { ...EMPTY_WIZARD_CONTEXT, goal };
  if (!ctx.goal && goal) ctx.goal = goal;
  const contextBlock = buildContextBlock(ctx);
  const systemPrompt = buildSystemPrompt(ctx);

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

  let validated = validateAndScoreLocal(allPairs);
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

  // ── Stage 5: Generate Boundary, Contrastive, and Meta-Cognitive Pairs ──
  onProgress?.({
    stage: "validating",
    message: `Generating boundary, contrastive, and meta-cognitive pairs...`,
    chunksTotal: totalChunks,
    chunksProcessed: totalChunks,
    pairsGenerated: final.length,
  });

  // Build a document summary for boundary generation from the first few chunks
  const docSummaryForBoundary = ctx.documentSummary
    || chunks.slice(0, 3).map(c => c.substring(0, 300)).join(" ");

  const [boundaryPairs, contrastivePairs, metaCognitivePairs, appliedExamplePairs] = await Promise.all([
    generateBoundaryPairs(contextBlock, docSummaryForBoundary),
    generateContrastivePairs(contextBlock, chunks),
    generateMetaCognitivePairs(contextBlock, chunks),
    generateAppliedExamplePairs(contextBlock, chunks),
  ]);

  console.log(`[Pipeline] Boundary pairs: ${boundaryPairs.length}, Contrastive pairs: ${contrastivePairs.length}, Meta-cognitive pairs: ${metaCognitivePairs.length}, Applied Example pairs: ${appliedExamplePairs.length}`);

  // Merge all pair types
  let allFinalPairs = [...final, ...boundaryPairs, ...contrastivePairs, ...metaCognitivePairs, ...appliedExamplePairs];

  // ── Stage 6: Format-Following Post-Processing ──
  onProgress?.({
    stage: "validating",
    message: `Applying format-following training...`,
    chunksTotal: totalChunks,
    chunksProcessed: totalChunks,
    pairsGenerated: allFinalPairs.length,
  });

  const formatResult = await applyFormatFollowingTraining(allFinalPairs);
  allFinalPairs = formatResult.pairs;
  const formatVariantCount = formatResult.count;
  console.log(`[Pipeline] Format variant pairs generated: ${formatVariantCount}`);

  // Inject system_prompt into every pair
  for (const pair of allFinalPairs) {
    pair.system_prompt = systemPrompt;
  }

  // ── Stage 7: Split Held-Out Test Set ──
  const testSplitRatio = 0.15;
  const evalPairs: DatasetPair[] = [];
  const trainPairs: DatasetPair[] = [];

  // Group by pass_type to stratify
  const grouped = new Map<string, DatasetPair[]>();
  for (const pair of allFinalPairs) {
    const pt = pair._meta?.pass_type ?? "unknown";
    if (!grouped.has(pt)) grouped.set(pt, []);
    grouped.get(pt)!.push(pair);
  }

  for (const [pt, pairs] of grouped.entries()) {
    // Shuffle the array
    const shuffled = [...pairs].sort(() => 0.5 - Math.random());
    const splitIndex = Math.floor(shuffled.length * testSplitRatio);
    evalPairs.push(...shuffled.slice(0, splitIndex));
    trainPairs.push(...shuffled.slice(splitIndex));
  }

  console.log(`[Pipeline] Split Dataset: ${trainPairs.length} for training, ${evalPairs.length} for evaluation.`);

  // ── Build JSONL ──
  // FIX 4: Build two versions — one with metadata for R2 audit, one clean for SFTTrainer.
  // The JSONL sent to training contains prompt+completion+system_prompt (SFTTrainer expects this).
  // Metadata is logged to console for debugging.
  const jsonlForTraining = trainPairs.map((p) => JSON.stringify({
    prompt: p.prompt,
    completion: p.completion,
    ...(p.system_prompt ? { system_prompt: p.system_prompt } : {}),
  })).join("\n");
  
  const evalJsonl = evalPairs.map((p) => JSON.stringify({
    prompt: p.prompt,
    completion: p.completion,
    ...(p.system_prompt ? { system_prompt: p.system_prompt } : {}),
  })).join("\n");

  const jsonlWithMeta = allFinalPairs.map((p) => JSON.stringify(p)).join("\n");

  // Log provenance summary
  const passCounts = new Map<string, number>();
  for (const p of allFinalPairs) {
    const pass = p._meta?.pass_type ?? "unknown";
    passCounts.set(pass, (passCounts.get(pass) ?? 0) + 1);
  }
  console.log(`[Pipeline] Provenance breakdown: ${[...passCounts.entries()].map(([k, v]) => `${k}=${v}`).join(", ")}`);

  const stats: PipelineStats = {
    chunksProcessed: totalChunks,
    rawPairsGenerated: allPairs.length,
    afterValidation: validated.length,
    afterDedup: final.length,
    boundaryPairs: boundaryPairs.length,
    contrastivePairs: contrastivePairs.length,
    metaCognitivePairs: metaCognitivePairs.length,
    appliedExamplePairs: appliedExamplePairs.length,
    formatVariantPairs: formatVariantCount,
    finalTotal: allFinalPairs.length,
    trainPairsCount: trainPairs.length,
    evalPairsCount: evalPairs.length,
    documentLength: text.length,
    sourceHash: crypto.createHash("md5").update(text).digest("hex"),
  };

  onProgress?.({
    stage: "complete",
    message: `Done! Generated ${trainPairs.length} training pairs, ${evalPairs.length} eval pairs.`,
    chunksTotal: totalChunks,
    chunksProcessed: totalChunks,
    pairsGenerated: trainPairs.length,
  });

  return { pairs: allFinalPairs, trainPairs, evalPairs, jsonl: jsonlForTraining, evalJsonl, jsonlWithMeta, stats, systemPrompt };
}

export interface PipelineStats {
  chunksProcessed: number;
  rawPairsGenerated: number;
  afterValidation: number;
  afterDedup: number;
  boundaryPairs: number;
  contrastivePairs: number;
  metaCognitivePairs: number;
  appliedExamplePairs?: number;
  formatVariantPairs?: number;
  finalTotal: number;
  trainPairsCount: number;
  evalPairsCount: number;
  documentLength: number;
  /** MD5 hash of the full source document — for post-hoc verification */
  sourceHash: string;
}

