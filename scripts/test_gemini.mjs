import { GoogleGenAI } from "@google/genai";
import { readFileSync } from "fs";

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

const apiKey = process.env.GOOGLE_GEMINI_API_KEY;
if (!apiKey) {
  console.error("No GOOGLE_GEMINI_API_KEY found");
  process.exit(1);
}

const ai = new GoogleGenAI({ apiKey });

async function test() {
  // Test 1: Basic generation
  console.log("--- Test 1: Basic generation ---");
  const res1 = await ai.models.generateContent({
    model: "gemini-3.6-flash",
    contents: "Reply with just: OK",
  });
  console.log("Result:", res1.text);

  // Test 2: JSON mode (used by evaluator judge)
  console.log("\n--- Test 2: JSON judge mode ---");
  const judgePrompt = `You are a judge evaluating a model's answer.
Question: What is the capital of France?
Reference answer: Paris is the capital of France.
Model answer: Paris is the capital city of France, located in northern France along the Seine River.

Reply as JSON with this exact schema:
{"source_quote": "exact quote from reference", "reasoning": "why you gave this score", "score": 0-5}`;

  const res2 = await ai.models.generateContent({
    model: "gemini-3.6-flash",
    contents: judgePrompt,
    config: {
      temperature: 0.0,
      maxOutputTokens: 2048,
      responseMimeType: "application/json",
    },
  });
  console.log("Result:", res2.text);

  // Test 3: Verify JSON is parseable
  try {
    const parsed = JSON.parse(res2.text);
    console.log("\nParsed score:", parsed.score);
    console.log("Parsed reasoning:", parsed.reasoning?.slice(0, 100));
    console.log("\n✅ All tests passed!");
  } catch (e) {
    console.error("❌ JSON parse failed:", e.message);
  }
}

test().catch((e) => console.error("ERROR:", e.message));
