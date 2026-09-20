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
      description: "Internal chain-of-thought to lock in CAC, LTV, margins, and narrative BEFORE scoring.",
    },
    scorecard: {
      type: Type.ARRAY,
      description: "Array of exactly 10 dimensions for a new evaluation, or empty array [] for follow-up.",
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
      description: "Direct response for follow-up questions, or empty string '' for new evaluation.",
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

const AMHARIC_GLOSSARY = `
GLOSSARY OF TECHNICAL TERMS (AMHARIC):
Always use these exact terms and spellings when writing in Amharic:
- Customer Acquisition Cost (CAC) -> የደንበኛ ማግኛ ወጪ (CAC)
- Lifetime Value (LTV) -> የደንበኛ የህይወት ዘመን ዋጋ (LTV)
- Moat / Defensibility -> የመከላከያ አቅም (Moat)
- Churn Rate -> የደንበኞች ማጣት መጠን (Churn Rate)
- Unit Economics -> የአንድ ክፍል ኢኮኖሚክስ (Unit Economics)
- Total Addressable Market (TAM) -> አጠቃላይ ሊደረስበት የሚችል ገበያ (TAM)
- Product-Market Fit -> የምርትና የገበያ መጣጣም (Product-Market Fit)
- Burn Rate -> የወጪ ፍጥነት (Burn Rate)
- Margin -> የትርፍ ህዳግ (Margin)
- Scalability -> የመለጠጥ/የማደግ አቅም (Scalability)
`;

async function testAmharicEvaluation() {
  const sysInstruction = `You are a critical startup evaluator and product analyst responding in Amharic (አማርኛ).

${AMHARIC_GLOSSARY}

OPERATING MODES:
1. "New evaluation" — Triggered when a new startup pitch is submitted.
   - You MUST generate all 6 evaluation sections: "analysis_scratchpad", "scorecard" (all 10 dimensions), "total_verdict", "roast", "graveyard", "pivot".
   - "follow_up_response" MUST be set to an empty string "".

You must score exactly these 10 dimensions in order:
1. Market Size
2. Problem Severity
3. Timing
4. Competition
5. Business Model Clarity
6. Technical Feasibility
7. Defensibility
8. Unit Economics
9. Team-Market Fit
10. Scalability
`;

  console.log("Testing full Amharic scorecard generation with 8192 token budget...");
  const prompt = "ሀሳብ፡ በአዲስ አበባ ውስጥ በሞተር ሳይክል የሚቀርብ ትኩስ የዶሮ ወጥ መላኪያ መተግበሪያ።";
  const start = Date.now();
  const res = await ai.models.generateContent({
    model: "gemini-3.6-flash",
    contents: prompt,
    config: {
      systemInstruction: sysInstruction,
      responseMimeType: "application/json",
      responseSchema: scorecardResponseSchema,
      maxOutputTokens: 8192,
      temperature: 0.25,
    },
  });

  const duration = (Date.now() - start) / 1000;
  console.log(`Generated in ${duration.toFixed(1)}s`);
  console.log("Raw output character length:", res.text.length);
  
  try {
    const parsed = JSON.parse(res.text);
    console.log("Parsed keys:", Object.keys(parsed));
    console.log("Scorecard items count:", parsed.scorecard.length);
    console.log("Verdict:", parsed.total_verdict);
    console.log("Roast sample:", parsed.roast.slice(0, 100));
    console.log("Graveyard sample:", parsed.graveyard.slice(0, 100));
    console.log("Pivot sample:", parsed.pivot.slice(0, 100));
    console.log("✅ Amharic evaluation JSON is completely valid and untruncated!");
  } catch (err) {
    console.error("❌ JSON parse error:", err.message);
    console.log("End of text:", res.text.slice(-200));
  }
}

testAmharicEvaluation().catch(console.error);
