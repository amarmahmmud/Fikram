/**
 * Wizard Field-Mapping Tests
 *
 * These tests verify that the wizard's interview → identity pipeline
 * maps each answer to the correct field by explicit key (question ID),
 * never by array position or message index.
 *
 * Root cause context:
 * - Bug 1: "Persona" showed the user's first chat message ("lets go")
 *   because answers were accessed by array index (answers[0] = goal text).
 * - Bug 2: "Audience" showed the AI role answer because of the off-by-one
 *   shift caused by the goal message at index 0.
 * - Bug 3: Style === Format because both read from answers[2].
 */

import {
  validateWizardContext,
  WIZARD_QUESTION_IDS,
  EMPTY_WIZARD_CONTEXT,
  type WizardContext,
  type InterviewAnswerMap,
} from "@/lib/wizard-types";

// ─── Replicate the server-side buildFallbackIdentity logic for testing ───
// This is extracted from route.ts so tests can verify the mapping independently.
function buildFallbackIdentity(answeredQuestions: InterviewAnswerMap) {
  const persona = answeredQuestions[WIZARD_QUESTION_IDS.PERSONA];
  const audience = answeredQuestions[WIZARD_QUESTION_IDS.AUDIENCE];
  const style = answeredQuestions[WIZARD_QUESTION_IDS.STYLE];
  const format = answeredQuestions[WIZARD_QUESTION_IDS.FORMAT];

  return {
    type: "identity" as const,
    persona: persona ? `A ${persona.toLowerCase()}` : "A knowledgeable and helpful AI assistant",
    audience: audience || "General users",
    style: style || "Clear and professional responses",
    format: format || "Well-structured paragraphs with examples",
    boundaries: "Always base answers on provided source material. If the answer is not in the source, state: 'I don't have enough information to answer this.' Never fabricate facts or cite sources that don't exist.",
    reasoning: "Based on your answers, this identity best matches your needs.",
  };
}

// ─── Test Suite ───

describe("Wizard Field Mapping — buildFallbackIdentity", () => {
  test("maps persona answer to persona field by key, not by position", () => {
    const answers: InterviewAnswerMap = {
      [WIZARD_QUESTION_IDS.PERSONA]: "Expert analyst",
      [WIZARD_QUESTION_IDS.AUDIENCE]: "Working professionals",
      [WIZARD_QUESTION_IDS.STYLE]: "Professional & formal",
    };

    const identity = buildFallbackIdentity(answers);

    expect(identity.persona).toBe("A expert analyst");
    expect(identity.audience).toBe("Working professionals");
    expect(identity.style).toBe("Professional & formal");
  });

  test("goal text ('lets go') does NOT leak into persona", () => {
    // Simulate the OLD bug: if we had used positional access, answers[0]
    // would be the goal text. With keyed access, the goal is never stored
    // in the answer map.
    const answers: InterviewAnswerMap = {
      // Notice: no PERSONA key — simulates user skipping the persona question
      [WIZARD_QUESTION_IDS.AUDIENCE]: "Domain experts",
      [WIZARD_QUESTION_IDS.STYLE]: "Academic & precise",
    };

    const identity = buildFallbackIdentity(answers);

    // Persona should fall back to default, NOT to "lets go"
    expect(identity.persona).toBe("A knowledgeable and helpful AI assistant");
    expect(identity.persona).not.toContain("lets go");
    expect(identity.audience).toBe("Domain experts");
  });

  test("audience gets audience answer, not persona answer (no swap)", () => {
    const answers: InterviewAnswerMap = {
      [WIZARD_QUESTION_IDS.PERSONA]: "Workforce Risk Analyst",
      [WIZARD_QUESTION_IDS.AUDIENCE]: "HR teams and compliance officers",
    };

    const identity = buildFallbackIdentity(answers);

    // The OLD bug: audience would show "Workforce Risk Analyst" (the persona answer)
    expect(identity.audience).toBe("HR teams and compliance officers");
    expect(identity.audience).not.toBe("Workforce Risk Analyst");
    expect(identity.persona).toContain("workforce risk analyst"); // lowercase
  });

  test("style and format are distinct when given distinct answers", () => {
    const answers: InterviewAnswerMap = {
      [WIZARD_QUESTION_IDS.PERSONA]: "Patient teacher",
      [WIZARD_QUESTION_IDS.AUDIENCE]: "Complete beginners",
      [WIZARD_QUESTION_IDS.STYLE]: "Friendly & conversational",
      [WIZARD_QUESTION_IDS.FORMAT]: "Step-by-step guides",
    };

    const identity = buildFallbackIdentity(answers);

    // The OLD bug: both style and format showed "Formal analysis with citations"
    expect(identity.style).toBe("Friendly & conversational");
    expect(identity.format).toBe("Step-by-step guides");
    expect(identity.style).not.toBe(identity.format);
  });

  test("handles empty answer map gracefully", () => {
    const answers: InterviewAnswerMap = {};
    const identity = buildFallbackIdentity(answers);

    expect(identity.persona).toBe("A knowledgeable and helpful AI assistant");
    expect(identity.audience).toBe("General users");
    expect(identity.style).toBe("Clear and professional responses");
    expect(identity.format).toBe("Well-structured paragraphs with examples");
    expect(identity.boundaries).toBeTruthy();
  });

  test("handles partial answers — only persona provided", () => {
    const answers: InterviewAnswerMap = {
      [WIZARD_QUESTION_IDS.PERSONA]: "Creative assistant",
    };

    const identity = buildFallbackIdentity(answers);

    expect(identity.persona).toBe("A creative assistant");
    // Other fields should get defaults, not accidentally grab persona's value
    expect(identity.audience).toBe("General users");
    expect(identity.style).toBe("Clear and professional responses");
  });
});


describe("Wizard Validation — validateWizardContext", () => {
  test("catches suspicious chat phrases in identity fields", () => {
    const ctx: WizardContext = {
      ...EMPTY_WIZARD_CONTEXT,
      goal: "Build a customer support bot",
      persona: "lets go", // ← the bug this catches
      audience: "Working professionals",
      style: "Friendly",
      format: "Short answers",
      boundaries: "Never fabricate facts",
    };

    const warnings = validateWizardContext(ctx);

    expect(warnings.length).toBeGreaterThan(0);
    const personaWarning = warnings.find((w) => w.field === "persona");
    expect(personaWarning).toBeDefined();
    expect(personaWarning!.reason).toContain("raw chat phrase");
  });

  test("catches identical style and format", () => {
    const ctx: WizardContext = {
      ...EMPTY_WIZARD_CONTEXT,
      goal: "Analyze workforce data",
      persona: "Expert analyst",
      audience: "HR professionals",
      style: "Formal analysis with citations",
      format: "Formal analysis with citations", // ← duplicate bug
      boundaries: "Never fabricate facts",
    };

    const warnings = validateWizardContext(ctx);

    const dupWarning = warnings.find((w) => w.field === "style/format");
    expect(dupWarning).toBeDefined();
    expect(dupWarning!.reason).toContain("identical");
  });

  test("catches empty fields", () => {
    const ctx: WizardContext = {
      ...EMPTY_WIZARD_CONTEXT,
      goal: "Something",
      persona: "",
      audience: "Users",
      style: "Formal",
      format: "Paragraphs",
      boundaries: "",
    };

    const warnings = validateWizardContext(ctx);

    const emptyFields = warnings.filter((w) => w.reason.includes("empty"));
    expect(emptyFields.length).toBe(2); // persona and boundaries
  });

  test("catches suspiciously short values", () => {
    const ctx: WizardContext = {
      ...EMPTY_WIZARD_CONTEXT,
      goal: "Build a bot",
      persona: "AI",   // 2 chars — too short
      audience: "Pro",  // 3 chars — too short
      style: "Good style for responses",
      format: "Proper structured format",
      boundaries: "Never lie",
    };

    const warnings = validateWizardContext(ctx);

    const shortWarnings = warnings.filter((w) => w.reason.includes("short"));
    expect(shortWarnings.length).toBeGreaterThanOrEqual(2);
  });

  test("passes clean context with no warnings", () => {
    const ctx: WizardContext = {
      ...EMPTY_WIZARD_CONTEXT,
      goal: "Build a workforce advisory assistant",
      persona: "A senior workforce risk analyst with deep domain expertise",
      audience: "HR directors and compliance officers with intermediate knowledge",
      style: "Professional and authoritative, citing specific data sources",
      format: "Verdict-first summary followed by detailed analysis in 2-3 paragraphs",
      boundaries: "Never guarantee specific financial outcomes. Always recommend consulting legal counsel for compliance decisions.",
    };

    const warnings = validateWizardContext(ctx);
    expect(warnings).toEqual([]);
  });

  test("catches common chat phrases: hi, ok, yes, hello", () => {
    const chatPhrases = ["hi", "ok", "yes", "hello", "sure", "test"];
    for (const phrase of chatPhrases) {
      const ctx: WizardContext = {
        ...EMPTY_WIZARD_CONTEXT,
        goal: "Something",
        persona: phrase,
        audience: "Some audience here",
        style: "Some style here",
        format: "Some format here",
        boundaries: "Some boundary here",
      };

      const warnings = validateWizardContext(ctx);
      const phraseWarning = warnings.find(
        (w) => w.field === "persona" && w.reason.includes("chat phrase")
      );
      expect(phraseWarning).toBeDefined();
    }
  });
});


describe("Wizard Field Mapping — Full Flow Simulation", () => {
  test("simulates complete wizard flow and verifies correct field placement", () => {
    // Simulate: user types goal, then answers 4 questions
    const goalText = "I want to build a workforce advisory AI";

    // Simulate the interview: each answer is stored by question ID
    const answeredQuestions: InterviewAnswerMap = {};

    // Question 1: Persona
    answeredQuestions[WIZARD_QUESTION_IDS.PERSONA] = "Workforce Risk Analyst";
    // Question 2: Audience
    answeredQuestions[WIZARD_QUESTION_IDS.AUDIENCE] = "HR teams and hiring managers";
    // Question 3: Style
    answeredQuestions[WIZARD_QUESTION_IDS.STYLE] = "Professional & formal";
    // Question 4: Format
    answeredQuestions[WIZARD_QUESTION_IDS.FORMAT] = "Verdict-first, then analysis with citations";

    // Build identity from keyed answers
    const identity = buildFallbackIdentity(answeredQuestions);

    // Verify EVERY field is in the correct place
    expect(identity.persona).toContain("workforce risk analyst");
    expect(identity.audience).toBe("HR teams and hiring managers");
    expect(identity.style).toBe("Professional & formal");
    expect(identity.format).toBe("Verdict-first, then analysis with citations");

    // The goal text should NOT appear in any identity field
    expect(identity.persona).not.toContain(goalText);
    expect(identity.audience).not.toContain(goalText);

    // Style and Format must be different
    expect(identity.style).not.toBe(identity.format);

    // Build WizardContext and validate
    const ctx: WizardContext = {
      goal: goalText,
      persona: identity.persona as string,
      audience: identity.audience as string,
      style: identity.style as string,
      format: identity.format as string,
      boundaries: identity.boundaries as string,
      goldExamples: [],
      documentSummary: "",
    };

    const warnings = validateWizardContext(ctx);
    expect(warnings).toEqual([]); // Clean context — no warnings
  });
});
