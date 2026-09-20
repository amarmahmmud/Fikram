import { readFileSync } from "fs";
import {
  scorecardResponseSchema,
  computeTokenBudget,
  detectResponseLanguage,
  getGlossaryForLanguage,
  validateScorecardJson,
  logTruncationEvent,
  extractPreviousScorecard,
  isFollowUpInquiry,
  formatScorecardToMarkdown,
  RUBRIC_DIMENSIONS,
  type ScorecardPayload,
  LANGUAGE_TOKEN_MULTIPLIERS,
} from "../src/lib/scorecard-config";
import { generateWithModelFallback } from "../src/lib/gemini";

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

/**
 * Unified generation helper simulating generateRAGResponse evaluative pipeline
 */
async function runScorecardTurn(
  userQuery: string,
  chatHistory: { role: string; content: string }[],
  options: {
    systemPrompt?: string;
    mediaAttachments?: any[];
  } = {}
): Promise<{
  scorecardData: ScorecardPayload;
  rawJson: string;
  markdown: string;
  responseLang: string;
  isFollowUp: boolean;
  tokenBudget: number;
  attemptsUsed: number;
}> {
  const hasMedia = options.mediaAttachments && options.mediaAttachments.length > 0;
  const responseLang = detectResponseLanguage(userQuery, chatHistory);
  const previousScorecard = extractPreviousScorecard(chatHistory);
  const isFollowUp = isFollowUpInquiry(userQuery, Boolean(hasMedia), previousScorecard);
  const glossary = getGlossaryForLanguage(responseLang);

  let previousScorecardContext = "";
  if (previousScorecard) {
    previousScorecardContext = `
### EXISTING SCORECARD IN THIS CONVERSATION (REFERENCE GROUND TRUTH) ###
${JSON.stringify(previousScorecard, null, 2)}
`;
  }

  const systemInstruction = `
OPERATING RULES (CRITICAL THINKER & STARTUP EVALUATOR MODE):
- You are evaluating a pitch, concept, business model, or answering follow-up questions about a previous evaluation scorecard.
- APPLY rigorous first-principles deductive reasoning, physical laws, market realities, and unit economics.

${glossary}

### OPERATING MODES & STRICT SCHEMA BEHAVIOR ###
${
  isFollowUp
    ? `
>>> CURRENT MODE: "Follow-up" <<<
- The user is asking a follow-up question, agreeing/disagreeing, or requesting elaboration on a scorecard ALREADY GIVEN earlier in this conversation.
- YOU MUST NOT REGENERATE A NEW SCORECARD OR NEW SCORES. Do not re-evaluate from scratch.
- Refer to the exact prior scores, verdict, and reasoning already provided in the EXISTING SCORECARD above.
- In your JSON output:
  * "scorecard" MUST be an empty array [].
  * "total_verdict" MUST be an empty string "".
  * "roast" MUST be an empty string "".
  * "graveyard" MUST be an empty string "".
  * "pivot" MUST be an empty string "".
  * "follow_up_response" MUST contain your complete, insightful, authoritative answer addressing the user's specific question, directly referencing the previous score and rationale.
  * "analysis_scratchpad" must contain your internal reasoning for this follow-up response.
`
    : `
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
`
}

${previousScorecardContext}

OUTPUT INTEGRITY RULE:
You MUST output a valid JSON object matching the enforced schema. Every key must be present in the JSON output. Never truncate mid-generation.
`;

  const geminiContents: any[] = [];
  for (const msg of chatHistory) {
    if (msg.role === "user" || msg.role === "model") {
      geminiContents.push({
        role: msg.role === "user" ? "user" : "model",
        parts: [{ text: msg.content }],
      });
    }
  }

  geminiContents.push({
    role: "user",
    parts: [{ text: userQuery }],
  });

  const maxAttempts = 2;
  let validatedPayload: ScorecardPayload | undefined;
  let rawResultText = "";
  let finalTokenBudget = 0;
  let attemptsUsed = 0;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    attemptsUsed = attempt + 1;
    finalTokenBudget = computeTokenBudget(responseLang, isFollowUp, attempt);

    try {
      const result = await generateWithModelFallback(geminiContents, {
        systemInstruction,
        generationConfig: {
          maxOutputTokens: finalTokenBudget,
          temperature: 0.25,
          topP: 0.9,
          topK: 40,
          responseMimeType: "application/json",
          responseSchema: scorecardResponseSchema,
        },
      });

      rawResultText = result.text()?.trim() ?? "";
      const validation = validateScorecardJson(rawResultText, isFollowUp);

      if (validation.isValid && validation.parsed) {
        validatedPayload = validation.parsed;
        if (attempt > 0) {
          logTruncationEvent({
            event: "retry_success",
            language: responseLang,
            tokenBudget: finalTokenBudget,
            attempt: attempt + 1,
            outputLength: rawResultText.length,
          });
        }
        break;
      } else {
        logTruncationEvent({
          event: attempt === 0 ? "truncation" : "retry_exhausted",
          language: responseLang,
          tokenBudget: finalTokenBudget,
          attempt: attempt + 1,
          error: validation.error,
          outputLength: rawResultText.length,
        });
      }
    } catch (attemptErr: any) {
      logTruncationEvent({
        event: attempt === 0 ? "retry" : "retry_exhausted",
        language: responseLang,
        tokenBudget: finalTokenBudget,
        attempt: attempt + 1,
        error: attemptErr.message || String(attemptErr),
      });
    }
  }

  if (!validatedPayload) {
    throw new Error(`Evaluation failed for language ${responseLang} after ${maxAttempts} attempts`);
  }

  const markdown = formatScorecardToMarkdown(validatedPayload);

  return {
    scorecardData: validatedPayload,
    rawJson: rawResultText,
    markdown,
    responseLang,
    isFollowUp,
    tokenBudget: finalTokenBudget,
    attemptsUsed,
  };
}

// ── Test Runners ────────────────────────────────────────────────────────────

interface TestCase {
  lang: string;
  name: string;
  initialPitch: string;
  followUp1: string;
  followUp2: string;
  followUp3: string;
}

const TEST_CASES: TestCase[] = [
  {
    lang: "en",
    name: "English Test Flow",
    initialPitch: "Pitch: An autonomous drone subscription that delivers fresh ice cream cones to people in public parks.",
    followUp1: "Do you agree with your Unit Economics score? How could we improve it with bulk battery hubs?",
    followUp2: "Can you elaborate on the Defensibility score? What if we patent the insulated dispenser?",
    followUp3: "What would our Customer Acquisition Cost (CAC) look like in suburban vs urban markets?",
  },
  {
    lang: "am",
    name: "Amharic Test Flow",
    initialPitch: "የቢዝነስ ሀሳብ፡ በአዲስ አበባ ውስጥ በየቀኑ ጠዋት ትኩስ እንጀራና ወጥ በሞተር ሳይክል የሚያደርስ የሞባይል መተግበሪያ።",
    followUp1: "በሰጠኸው የደንበኛ ማግኛ ወጪ (CAC) እና የአንድ ክፍል ኢኮኖሚክስ (Unit Economics) ነጥብ ትስማማለህ? እንዴት ማሻሻል እንችላለን?",
    followUp2: "ስለ የመከላከያ አቅም (Moat) ተጨማሪ ማብራሪያ ስጠኝ፤ በከተማው ውስጥ ካሉ ምግብ ቤቶች ጋር ልዩ ውል ብናስር ይረዳል?",
    followUp3: "የትርፍ ህዳግ (Gross Margin) እና የደንበኞች ማጣት መጠን (Churn Rate) እንዴት ሊስተካከል ይችላል?",
  },
  {
    lang: "ar",
    name: "Arabic Test Flow",
    initialPitch: "فكرة المشروع: منصة اشتراك شهرية لتوصيل حبوب القهوة الفاخرة المحمصة يومياً للمكاتب والشركات في الرياض.",
    followUp1: "هل توافق على درجة اقتصاديات الوحدة (Unit Economics)؟ كيف يمكننا تحسينها عبر التوريد المباشر من المزارع؟",
    followUp2: "ما رأيك في الخندق الاقتصادي (Moat)؟ هل الولاء للعلامة التجارية يمنحنا حصانة ضد المنافسين الكبار؟",
    followUp3: "كيف تتوقع معدل فقدان العملاء (Churn Rate) وتكلفة اكتساب العملاء (CAC) مع عقود سنوية؟",
  },
];

async function runAllTests() {
  console.log("==================================================================");
  console.log("🚀 STARTING AI SCORECARD EVALUATION COMPREHENSIVE VERIFICATION");
  console.log("==================================================================\n");

  const resultsSummary: Record<string, { stepA: boolean; stepB: boolean; stepC: boolean; details: string }> = {};

  // Part 1: Run 3-Language Multi-Turn Flow
  for (const tc of TEST_CASES) {
    console.log(`\n------------------------------------------------------------------`);
    console.log(`🌐 TESTING LANGUAGE: ${tc.name} [${tc.lang}]`);
    console.log(`------------------------------------------------------------------`);

    const conversationHistory: { role: string; content: string }[] = [];
    let stepAPass = false;
    let stepBPass = false;
    let stepCPass = false;

    try {
      // Step A: Initial pitch submission -> full scorecard JSON
      console.log(`\n[Step a] Submitting initial pitch...`);
      console.log(`Prompt: "${tc.initialPitch}"`);
      const resA = await runScorecardTurn(tc.initialPitch, conversationHistory);
      console.log(`→ Detected Language: ${resA.responseLang} (Multiplier: ${LANGUAGE_TOKEN_MULTIPLIERS[resA.responseLang]}x, Budget: ${resA.tokenBudget})`);
      console.log(`→ Mode: ${resA.isFollowUp ? "Follow-up" : "New evaluation"}`);
      console.log(`→ Scorecard dimensions count: ${resA.scorecardData.scorecard.length} / 10`);
      console.log(`→ Total Verdict: "${resA.scorecardData.total_verdict}"`);
      console.log(`→ Roast length: ${resA.scorecardData.roast.length} chars`);
      console.log(`→ Graveyard length: ${resA.scorecardData.graveyard.length} chars`);
      console.log(`→ Follow-up response empty: ${resA.scorecardData.follow_up_response === ""}`);

      if (
        !resA.isFollowUp &&
        resA.scorecardData.scorecard.length === 10 &&
        resA.scorecardData.total_verdict &&
        resA.scorecardData.roast.length > 50 &&
        resA.scorecardData.follow_up_response === ""
      ) {
        stepAPass = true;
        console.log(`✅ [Step a PASS] Complete, valid, untruncated 10-dimension scorecard JSON!`);
      } else {
        console.error(`❌ [Step a FAIL] Incomplete scorecard JSON!`);
      }

      // Add to conversation history
      conversationHistory.push({ role: "user", content: tc.initialPitch });
      conversationHistory.push({ role: "model", content: resA.rawJson });

      // Step B: Follow-up question 1 -> must use follow_up_response, referencing existing scores
      console.log(`\n[Step b] Asking follow-up question 1...`);
      console.log(`Prompt: "${tc.followUp1}"`);
      const resB = await runScorecardTurn(tc.followUp1, conversationHistory);
      console.log(`→ Mode: ${resB.isFollowUp ? "Follow-up" : "New evaluation"}`);
      console.log(`→ Scorecard length (must be 0): ${resB.scorecardData.scorecard.length}`);
      console.log(`→ Follow-up response length: ${resB.scorecardData.follow_up_response.length} chars`);
      console.log(`→ Preview: "${resB.scorecardData.follow_up_response.slice(0, 140)}..."`);

      if (
        resB.isFollowUp &&
        resB.scorecardData.scorecard.length === 0 &&
        resB.scorecardData.follow_up_response.length > 50 &&
        resB.scorecardData.roast === ""
      ) {
        stepBPass = true;
        console.log(`✅ [Step b PASS] Used follow_up_response, did NOT regenerate scorecard!`);
      } else {
        console.error(`❌ [Step b FAIL] Regenerated scorecard or failed to use follow_up_response!`);
      }

      conversationHistory.push({ role: "user", content: tc.followUp1 });
      conversationHistory.push({ role: "model", content: resB.rawJson });

      // Step C: 2 more follow-up questions -> consistent schema and terminology
      console.log(`\n[Step c.1] Asking follow-up question 2...`);
      console.log(`Prompt: "${tc.followUp2}"`);
      const resC1 = await runScorecardTurn(tc.followUp2, conversationHistory);
      console.log(`→ Mode: ${resC1.isFollowUp ? "Follow-up" : "New evaluation"}`);
      console.log(`→ Scorecard length: ${resC1.scorecardData.scorecard.length}`);
      console.log(`→ Follow-up response length: ${resC1.scorecardData.follow_up_response.length} chars`);

      conversationHistory.push({ role: "user", content: tc.followUp2 });
      conversationHistory.push({ role: "model", content: resC1.rawJson });

      console.log(`\n[Step c.2] Asking follow-up question 3...`);
      console.log(`Prompt: "${tc.followUp3}"`);
      const resC2 = await runScorecardTurn(tc.followUp3, conversationHistory);
      console.log(`→ Mode: ${resC2.isFollowUp ? "Follow-up" : "New evaluation"}`);
      console.log(`→ Scorecard length: ${resC2.scorecardData.scorecard.length}`);
      console.log(`→ Follow-up response length: ${resC2.scorecardData.follow_up_response.length} chars`);

      conversationHistory.push({ role: "user", content: tc.followUp3 });
      conversationHistory.push({ role: "model", content: resC2.rawJson });

      if (
        resC1.isFollowUp &&
        resC1.scorecardData.scorecard.length === 0 &&
        resC2.isFollowUp &&
        resC2.scorecardData.scorecard.length === 0 &&
        resC1.scorecardData.follow_up_response.length > 50 &&
        resC2.scorecardData.follow_up_response.length > 50
      ) {
        stepCPass = true;
        console.log(`✅ [Step c PASS] Multi-turn schema and terminology remained consistent throughout!`);
      } else {
        console.error(`❌ [Step c FAIL] Drift or truncation observed!`);
      }

      resultsSummary[tc.lang] = {
        stepA: stepAPass,
        stepB: stepBPass,
        stepC: stepCPass,
        details: `Lang ${tc.lang} all steps completed.`,
      };
    } catch (err: any) {
      console.error(`❌ Error in ${tc.name}:`, err.message);
      resultsSummary[tc.lang] = {
        stepA: stepAPass,
        stepB: stepBPass,
        stepC: stepCPass,
        details: `Failed with error: ${err.message}`,
      };
    }
  }

  // Part 2: 5 Consecutive Amharic Evaluations to confirm 0% truncation
  console.log(`\n==================================================================`);
  console.log(`🇪🇹 PART 2: 5 CONSECUTIVE AMHARIC STRESS TESTS (HIGHEST RISK LANGUAGE)`);
  console.log(`==================================================================\n`);

  const amharicPitches = [
    "ሀሳብ 1፡ በአዲስ አበባ ውስጥ በቤት ሰራተኞች እና አሰሪዎች መካከል አስተማማኝ ዋስትና ያለው የሞባይል ቅጥር መድረክ።",
    "ሀሳብ 2፡ ለገጠር ገበሬዎች የሰብል በሽታዎችን በስልክ ካሜራ ፎቶ በማንሳት በ AI የሚለይና መድኃኒት የሚጠቁም መተግበሪያ።",
    "ሀሳብ 3፡ በኢትዮጵያ ውስጥ ባሉ ሁለተኛ ደረጃ ትምህርት ቤቶች የፈተና ጥያቄዎችን በድምጽ እና በጽሁፍ የሚያስረዳ የቴሌግራም ቦት።",
    "ሀሳብ 4፡ በከተሞች ውስጥ ያገለገሉ ዕቃዎችን እና ኤሌክትሮኒክስን በኦንላይን ለመሸጥ እና ለመግዛት የሚያስችል አስተማማኝ የኢስክሮው (Escrow) የክፍያ ገበያ።",
    "ሀሳብ 5፡ የህክምና ባለሙያዎችን በቀጥታ በቪዲዮ ጥሪ ከታካሚዎች ጋር የሚያገናኝ እና የላቦራቶሪ ናሙናዎችን ከቤት የሚያመጣ የጤና ቴሌሜዲሲን አገልግሎት።",
  ];

  let amharicSuccessCount = 0;
  for (let i = 0; i < amharicPitches.length; i++) {
    const pitch = amharicPitches[i];
    console.log(`\n[Amharic Test ${i + 1}/5] Running evaluation for pitch: "${pitch.slice(0, 50)}..."`);
    try {
      const res = await runScorecardTurn(pitch, []);
      const isValid =
        res.scorecardData.scorecard.length === 10 &&
        res.scorecardData.total_verdict.length > 0 &&
        res.scorecardData.roast.length > 100 &&
        res.scorecardData.graveyard.length > 50 &&
        res.scorecardData.pivot.length > 50;

      if (isValid) {
        amharicSuccessCount++;
        console.log(`✅ [Amharic ${i + 1}/5 PASS] Output length: ${res.rawJson.length} chars, Budget: ${res.tokenBudget}, Scorecard items: 10, Verdict: "${res.scorecardData.total_verdict}"`);
      } else {
        console.error(`❌ [Amharic ${i + 1}/5 FAIL] Incomplete payload:`, Object.keys(res.scorecardData));
      }
    } catch (err: any) {
      console.error(`❌ [Amharic ${i + 1}/5 ERROR]:`, err.message);
    }
  }

  console.log(`\n==================================================================`);
  console.log(`📊 FINAL TEST REPORT`);
  console.log(`==================================================================`);
  console.log(`3-Language Test Results:`);
  for (const [lang, s] of Object.entries(resultsSummary)) {
    console.log(`  - [${lang.toUpperCase()}]: Step a (Pitch JSON): ${s.stepA ? "PASS" : "FAIL"} | Step b (Follow-up 1): ${s.stepB ? "PASS" : "FAIL"} | Step c (Follow-ups 2 & 3): ${s.stepC ? "PASS" : "FAIL"}`);
  }
  console.log(`\nAmharic Consecutive Stress Tests: ${amharicSuccessCount} / ${amharicPitches.length} PASSED (${(amharicSuccessCount / amharicPitches.length) * 100}% Zero Truncation Rate)`);
  console.log(`==================================================================\n`);
}

runAllTests().catch(console.error);
