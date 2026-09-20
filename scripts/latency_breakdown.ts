import { readFileSync } from "fs";
import { GoogleGenAI } from "@google/genai";
import {
  scorecardResponseSchema,
  computeTokenBudget,
  detectResponseLanguage,
  getGlossaryForLanguage,
  validateScorecardJson,
  isFollowUpInquiry,
  RUBRIC_DIMENSIONS,
} from "../src/lib/scorecard-config";
import { generateWithModelFallback, generateStreamWithModelFallback } from "../src/lib/gemini";
import { retrieveChunks } from "../src/lib/embedding";

// Load .env.local
const envContent = readFileSync(".env.local", "utf-8");
for (const line of envContent.split("\n")) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const eqIdx = trimmed.indexOf("=");
  if (eqIdx > 0) {
    const key = trimmed.slice(0, eqIdx);
    const val = trimmed.slice(eqIdx + 1);
    if (!process.env[key]) process.env[key] = val;
  }
}

async function measurePipeline(query: string, langName: string) {
  console.log(`\n============================================================`);
  console.log(`⏱️ MEASURING PIPELINE LATENCY: ${langName}`);
  console.log(`Query: "${query}"`);
  console.log(`============================================================`);

  const tStart = Date.now();

  // Stage 1: Retrieval / DB
  const t0 = Date.now();
  const responseLang = detectResponseLanguage(query, []);
  const isFollowUp = isFollowUpInquiry(query, false, null);
  const glossary = getGlossaryForLanguage(responseLang);
  const tokenBudget = computeTokenBudget(responseLang, isFollowUp, 0);

  // Try retrieving chunks for an expert
  try {
    const tRetrievalStart = Date.now();
    await retrieveChunks(query, "dummy", undefined, 0.3, "evaluative");
    console.log(`Stage 1: Retrieval / DB -> ${Date.now() - tRetrievalStart}ms`);
  } catch (e: any) {
    console.log(`Stage 1: Retrieval / DB (dummy fallback) -> ${Date.now() - t0}ms`);
  }

  // Stage 2: Prompt / Context construction
  const tPromptStart = Date.now();
  const systemInstruction = `
OPERATING RULES (CRITICAL THINKER & STARTUP EVALUATOR MODE):
- You are evaluating a pitch, concept, business model, or answering follow-up questions about a previous evaluation scorecard.
- APPLY rigorous first-principles deductive reasoning, physical laws, market realities, and unit economics.

${glossary}

### OPERATING MODES & STRICT SCHEMA BEHAVIOR ###
>>> CURRENT MODE: "New evaluation" <<<
- Triggered because a new startup pitch, concept, or screenshot is submitted for initial review.
- Before generating the Scorecard or Roast, you MUST evaluate the core unit economics and logical flaws inside the "analysis_scratchpad" JSON field.
- In your JSON output:
  * "analysis_scratchpad": Lock in CAC, LTV, margins, and narrative BEFORE scoring.
  * "scorecard": Must contain all 10 dimensions in exact order (${RUBRIC_DIMENSIONS.join(", ")}), scored 0-10 each with first-principles reasoning.
  * "total_verdict": MUST be a punchy 3-word summary verdict (e.g., "Dead on Arrival", "Cash-Flow Trap"). NEVER use asterisks or blanks.
  * "roast": Minimum 4 brutal, first-principles paragraphs.
  * "graveyard": 3-4 structural failure patterns using markdown bullet list syntax (- item).
  * "pivot": Actionable, higher-margin alternative.
  * "follow_up_response": MUST be an empty string "".

OUTPUT INTEGRITY RULE:
You MUST output a valid JSON object matching the enforced schema. Every key must be present in the JSON output. Never truncate mid-generation.
`;
  const geminiContents = [{ role: "user", parts: [{ text: query }] }];
  console.log(`Stage 2: Context & Prompt Assembly -> ${Date.now() - tPromptStart}ms`);

  // Stage 3: Direct API call test on gemini-3.5-flash vs gemini-3.6-flash
  const apiKey = (process.env.GOOGLE_GEMINI_API_KEYS || process.env.GOOGLE_GEMINI_API_KEY || "").split(",")[0].trim();
  const ai = new GoogleGenAI({ apiKey });

  console.log(`\nTesting individual models directly with schema & budget (${tokenBudget} tokens)...`);
  for (const m of ["gemini-3.5-flash", "gemini-3.6-flash"]) {
    const tDirect = Date.now();
    try {
      const res = await ai.models.generateContent({
        model: m,
        contents: geminiContents,
        config: {
          systemInstruction,
          responseMimeType: "application/json",
          responseSchema: scorecardResponseSchema,
          maxOutputTokens: tokenBudget,
          temperature: 0.25,
        },
      });
      const dur = Date.now() - tDirect;
      console.log(`  Direct [${m}] -> SUCCESS in ${dur}ms | output len: ${res.text?.length} chars`);
    } catch (err: any) {
      const dur = Date.now() - tDirect;
      console.log(`  Direct [${m}] -> FAILED in ${dur}ms: ${err.message || err.status}`);
    }
  }

  // Stage 4: Test Streaming API on gemini-3.6-flash to measure Time-To-First-Token (TTFT)
  console.log(`\nTesting STREAMING on gemini-3.6-flash (measuring TTFT vs Total Time)...`);
  const tStreamStart = Date.now();
  let ttft = 0;
  let chunkCount = 0;
  let fullStreamText = "";
  try {
    const stream = await ai.models.generateContentStream({
      model: "gemini-3.6-flash",
      contents: geminiContents,
      config: {
        systemInstruction,
        responseMimeType: "application/json",
        responseSchema: scorecardResponseSchema,
        maxOutputTokens: tokenBudget,
        temperature: 0.25,
      },
    });

    for await (const chunk of stream) {
      if (chunkCount === 0) {
        ttft = Date.now() - tStreamStart;
      }
      chunkCount++;
      fullStreamText += chunk.text || "";
    }
    const streamTotal = Date.now() - tStreamStart;
    console.log(`  Streaming [gemini-3.6-flash] -> TTFT (First Token): ${ttft}ms | Total Time: ${streamTotal}ms | Chunks: ${chunkCount} | Len: ${fullStreamText.length}`);
    const validation = validateScorecardJson(fullStreamText, false);
    console.log(`  Stream output valid JSON? ${validation.isValid} (error: ${validation.error || "none"})`);
  } catch (err: any) {
    console.log(`  Streaming FAILED: ${err.message}`);
  }

  // Stage 5: Test generateStreamWithModelFallback
  console.log(`\nTesting generateStreamWithModelFallback() with onChunk (new streaming pipeline):`);
  const tFallbackStart = Date.now();
  let streamTTFT = 0;
  let chunkN = 0;
  try {
    const fallbackRes = await generateStreamWithModelFallback(geminiContents, {
      systemInstruction,
      generationConfig: {
        maxOutputTokens: tokenBudget,
        temperature: 0.25,
        responseMimeType: "application/json",
        responseSchema: scorecardResponseSchema,
      },
    }, (chunk) => {
      if (chunkN === 0) {
        streamTTFT = Date.now() - tFallbackStart;
      }
      chunkN++;
    });
    const fallbackTotal = Date.now() - tFallbackStart;
    console.log(`  generateStreamWithModelFallback -> TTFT: ${streamTTFT}ms | Total: ${fallbackTotal}ms | Chunks: ${chunkN} | Output len: ${fallbackRes.text()?.length}`);
    const validation = validateScorecardJson(fallbackRes.text(), false);
    console.log(`  Output valid JSON? ${validation.isValid} (error: ${validation.error || "none"})`);
  } catch (err: any) {
    console.log(`  generateStreamWithModelFallback FAILED: ${err.message}`);
  }

  console.log(`\nOverall test duration: ${Date.now() - tStart}ms`);
}

async function run() {
  await measurePipeline(
    "Pitch: An autonomous drone subscription that delivers fresh ice cream cones to people in public parks.",
    "English"
  );
  await measurePipeline(
    "የቢዝነስ ሀሳብ፡ በአዲስ አበባ ውስጥ በየቀኑ ጠዋት ትኩስ እንጀራና ወጥ በሞተር ሳይክል የሚያደርስ የሞባይል መተግበሪያ።",
    "Amharic"
  );
}

run().catch(console.error);
