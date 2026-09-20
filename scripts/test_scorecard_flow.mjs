import { GoogleGenAI, Type } from "@google/genai";
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

const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_GEMINI_API_KEY });

const scorecardResponseSchema = {
  type: Type.OBJECT,
  properties: {
    analysis_scratchpad: {
      type: Type.STRING,
      description: "Internal chain-of-thought to lock in CAC, LTV, margins, and narrative BEFORE scoring or answering.",
    },
    scorecard: {
      type: Type.ARRAY,
      description: "Array of exactly 10 dimensions for a new evaluation, or an empty array [] if this is a follow-up response.",
      items: {
        type: Type.OBJECT,
        properties: {
          dimension: { type: Type.STRING },
          score: { type: Type.INTEGER },
          reasoning: { type: Type.STRING },
        },
        required: ["dimension", "score", "reasoning"],
      },
    },
    total_verdict: {
      type: Type.STRING,
      description: "A punchy 3-word summary verdict for new evaluation, or empty string '' for follow-up response.",
    },
    roast: {
      type: Type.STRING,
      description: "Roast paragraphs for new evaluation, or empty string '' for follow-up response.",
    },
    graveyard: {
      type: Type.STRING,
      description: "Failure-pattern bullet points for new evaluation, or empty string '' for follow-up response.",
    },
    pivot: {
      type: Type.STRING,
      description: "Actionable pivot recommendation for new evaluation, or empty string '' for follow-up response.",
    },
    follow_up_response: {
      type: Type.STRING,
      description: "Direct, insightful response to the user's follow-up question or comment. Refer to the existing scorecard already given earlier in the conversation. Empty string '' for a new evaluation.",
    },
  },
  required: [
    "analysis_scratchpad",
    "scorecard",
    "total_verdict",
    "roast",
    "graveyard",
    "pivot",
    "follow_up_response",
  ],
};

async function run() {
  const sysInstruction = `You are a critical startup evaluator and product analyst.

OPERATING MODES:
1. "New evaluation" — Triggered when a new startup pitch, concept, or screenshot is submitted for initial review.
   - You MUST generate all 6 evaluation sections: "analysis_scratchpad", "scorecard" (all 10 dimensions), "total_verdict", "roast", "graveyard", "pivot".
   - "follow_up_response" MUST be set to an empty string "".

2. "Follow-up" — Triggered when the user asks a question, agrees, disagrees, requests elaboration, or comments on a scorecard ALREADY GIVEN earlier in the conversation.
   - In this mode, you must NOT regenerate a new scorecard from scratch.
   - Refer to the exact prior scores, verdict, and reasoning already provided earlier in the conversation.
   - "scorecard" MUST be an empty array [].
   - "total_verdict", "roast", "graveyard", and "pivot" MUST be empty strings "".
   - "follow_up_response" MUST contain your complete, in-depth, authoritative response answering the user's question, directly referencing the previous score and rationale.`;

  const contents = [
    { role: "user", parts: [{ text: "Pitch: AI toaster that burns your morning calendar on toast" }] },
    {
      role: "model",
      parts: [
        {
          text: JSON.stringify({
            analysis_scratchpad: "Gimmick hardware with extreme churn and zero moat.",
            scorecard: [
              { dimension: "Market Size", score: 1, reasoning: "Tiny novelty market with zero recurring revenue." },
              { dimension: "Problem Severity", score: 1, reasoning: "Nobody needs calendar toast." },
              { dimension: "Timing", score: 2, reasoning: "Pointless use of AI." },
              { dimension: "Competition", score: 5, reasoning: "Traditional toasters are $20." },
              { dimension: "Business Model Clarity", score: 2, reasoning: "One-time hardware sale with high warranty risk." },
              { dimension: "Technical Feasibility", score: 7, reasoning: "Laser burning toast is technically possible." },
              { dimension: "Defensibility", score: 0, reasoning: "Zero patentability or network effects." },
              { dimension: "Unit Economics", score: 2, reasoning: "High BOM and shipping costs for a heavy appliance." },
              { dimension: "Team-Market Fit", score: 3, reasoning: "Needs hardware manufacturing pedigree." },
              { dimension: "Scalability", score: 1, reasoning: "Physical distribution margin nightmare." }
            ],
            total_verdict: "Dead On Arrival",
            roast: "This is peak hardware delusion. Burning pixels onto carbohydrates solves nothing.",
            graveyard: "- Juicero (overengineered single-purpose kitchen appliance)\n- Tefal smart toaster flops",
            pivot: "Build an ambient kitchen dashboard or calendar projection app instead.",
            follow_up_response: "",
          }),
        },
      ],
    },
    { role: "user", parts: [{ text: "Do you agree with giving Market Size only a 1? What if we target luxury hotels?" }] },
  ];

  console.log("Sending follow-up query to Gemini...");
  const res = await ai.models.generateContent({
    model: "gemini-3.6-flash",
    contents,
    config: {
      systemInstruction: sysInstruction,
      responseMimeType: "application/json",
      responseSchema: scorecardResponseSchema,
      maxOutputTokens: 4096,
      temperature: 0.25,
    },
  });

  console.log("Result:");
  console.log(res.text);
  const parsed = JSON.parse(res.text);
  console.log("\nParsed successfully!");
  console.log("Scorecard length:", parsed.scorecard.length);
  console.log("Follow-up response length:", parsed.follow_up_response.length);
  console.log("Follow-up preview:", parsed.follow_up_response.slice(0, 150));
}

run().catch((e) => console.error(e));
