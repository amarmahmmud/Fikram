// ─────────────────────────────────────────────
// Centralized Model Registry — Single source of truth
// ─────────────────────────────────────────────

export interface ModelInfo {
  id: string;
  name: string;
  org: string;
  size: string;
  sizeNum: number;          // numeric param count in billions for sorting/filtering
  category: ModelCategory;
  strengths: string[];
  weaknesses: string[];
  bestFor: string[];
  contextWindow: number;
  languages: string[];
  credits: { min: number; max: number };
  speed: "fast" | "medium" | "slow";
  quality: number;          // 1-10 quality rating
  popular: boolean;
  recommended: boolean;
  tags: string[];
}

export type ModelCategory =
  | "chat"
  | "reasoning"
  | "code"
  | "multilingual"
  | "creative"
  | "lightweight"
  | "general";

export const MODEL_CATEGORIES: { value: ModelCategory | "all"; label: string }[] = [
  { value: "all", label: "All Models" },
  { value: "chat", label: "Chat & Instruction" },
  { value: "reasoning", label: "Reasoning" },
  { value: "code", label: "Code" },
  { value: "multilingual", label: "Multilingual" },
  { value: "general", label: "General Purpose" },
  { value: "lightweight", label: "Lightweight" },
];

// ─────────────────────────────────────────────
// The Model Catalog
// ─────────────────────────────────────────────
export const MODELS: ModelInfo[] = [
  // ── Chat / Instruction ──────────────────
  {
    id: "meta-llama/Llama-3.1-8B-Instruct",
    name: "Llama 3.1 8B Instruct",
    org: "Meta",
    size: "8B",
    sizeNum: 8,
    category: "chat",
    strengths: ["Instruction following", "Chat & dialogue", "Q&A", "Content generation"],
    weaknesses: ["Code generation", "Complex math"],
    bestFor: ["Customer support bots", "Knowledge Q&A", "Content assistants", "Book/document experts"],
    contextWindow: 8192,
    languages: ["en", "es", "fr", "de", "pt", "it"],
    credits: { min: 20, max: 40 },
    speed: "fast",
    quality: 8,
    popular: true,
    recommended: true,
    tags: ["chat", "instruction", "text"],
  },
  {
    id: "google/gemma-2-9b-it",
    name: "Gemma 2 9B Instruct",
    org: "Google",
    size: "9B",
    sizeNum: 9,
    category: "chat",
    strengths: ["Detailed explanations", "Reasoning", "Safety alignment", "Structured output"],
    weaknesses: ["Slower inference", "Higher cost"],
    bestFor: ["Educational tutors", "Detailed analysis", "Research assistants"],
    contextWindow: 8192,
    languages: ["en"],
    credits: { min: 25, max: 50 },
    speed: "medium",
    quality: 8.5,
    popular: true,
    recommended: false,
    tags: ["chat", "instruction", "reasoning"],
  },

  // ── General Purpose ─────────────────────
  {
    id: "mistralai/Mistral-7B-Instruct-v0.3",
    name: "Mistral 7B Instruct v0.3",
    org: "Mistral AI",
    size: "7B",
    sizeNum: 7,
    category: "general",
    strengths: ["Balanced quality & speed", "Concise answers", "Low cost"],
    weaknesses: ["Less creative", "English-focused"],
    bestFor: ["API backends", "Structured data extraction", "Email/text classification"],
    contextWindow: 8192,
    languages: ["en", "fr", "de", "es", "it"],
    credits: { min: 15, max: 35 },
    speed: "fast",
    quality: 7.5,
    popular: true,
    recommended: false,
    tags: ["general", "instruction", "text"],
  },

  // ── Reasoning ───────────────────────────
  {
    id: "microsoft/Phi-3-mini-4k-instruct",
    name: "Phi-3 Mini 4K Instruct",
    org: "Microsoft",
    size: "3.8B",
    sizeNum: 3.8,
    category: "reasoning",
    strengths: ["Strong reasoning for size", "Cost efficient", "Fast inference"],
    weaknesses: ["Limited context window", "Less fluent", "Shorter responses"],
    bestFor: ["Logic tasks", "Budget projects", "Quick prototypes"],
    contextWindow: 4096,
    languages: ["en"],
    credits: { min: 8, max: 18 },
    speed: "fast",
    quality: 6.5,
    popular: false,
    recommended: false,
    tags: ["reasoning", "lightweight", "text"],
  },
  {
    id: "microsoft/Phi-3.5-mini-instruct",
    name: "Phi-3.5 Mini Instruct",
    org: "Microsoft",
    size: "3.8B",
    sizeNum: 3.8,
    category: "reasoning",
    strengths: ["Improved reasoning", "Multilingual support", "Cost efficient"],
    weaknesses: ["Smaller context", "Less creative output"],
    bestFor: ["Reasoning tasks", "Multilingual classification", "Edge deployment"],
    contextWindow: 4096,
    languages: ["en", "ar", "zh", "ja", "ko"],
    credits: { min: 8, max: 18 },
    speed: "fast",
    quality: 7,
    popular: false,
    recommended: false,
    tags: ["reasoning", "multilingual", "lightweight"],
  },
  {
    id: "deepseek-ai/DeepSeek-R1-Distill-Llama-8B",
    name: "DeepSeek R1 Llama 8B",
    org: "DeepSeek",
    size: "8B",
    sizeNum: 8,
    category: "reasoning",
    strengths: ["Chain-of-thought reasoning", "Math & logic", "Analytical tasks"],
    weaknesses: ["Verbose responses", "Slower for simple tasks"],
    bestFor: ["Math tutors", "Problem-solving assistants", "Technical analysis"],
    contextWindow: 8192,
    languages: ["en", "zh"],
    credits: { min: 20, max: 40 },
    speed: "medium",
    quality: 8,
    popular: true,
    recommended: false,
    tags: ["reasoning", "cot", "math"],
  },

  // ── Code ────────────────────────────────
  {
    id: "meta-llama/CodeLlama-7b-Instruct-hf",
    name: "CodeLlama 7B Instruct",
    org: "Meta",
    size: "7B",
    sizeNum: 7,
    category: "code",
    strengths: ["Code generation", "Debugging", "Code explanation"],
    weaknesses: ["Poor at general chat", "Limited natural language"],
    bestFor: ["Code assistants", "Documentation generators", "Bug fixers"],
    contextWindow: 4096,
    languages: ["en"],
    credits: { min: 15, max: 35 },
    speed: "fast",
    quality: 7.5,
    popular: false,
    recommended: false,
    tags: ["code", "instruction", "programming"],
  },

  // ── Multilingual ────────────────────────
  {
    id: "Qwen/Qwen2.5-7B-Instruct",
    name: "Qwen 2.5 7B Instruct",
    org: "Alibaba",
    size: "7B",
    sizeNum: 7,
    category: "multilingual",
    strengths: ["Excellent multilingual", "Arabic support", "Chinese native", "Structured output"],
    weaknesses: ["Less tested in English-only", "Newer ecosystem"],
    bestFor: ["Arabic chatbots", "Chinese assistants", "Multilingual customer support"],
    contextWindow: 8192,
    languages: ["en", "ar", "zh", "ja", "ko", "fr", "de", "es"],
    credits: { min: 15, max: 35 },
    speed: "fast",
    quality: 7.5,
    popular: false,
    recommended: false,
    tags: ["multilingual", "instruction", "text"],
  },

  // ── Lightweight / Budget ────────────────
  {
    id: "meta-llama/Llama-3.2-3B-Instruct",
    name: "Llama 3.2 3B Instruct",
    org: "Meta",
    size: "3B",
    sizeNum: 3,
    category: "lightweight",
    strengths: ["Very fast inference", "Lowest cost", "Good for simple tasks"],
    weaknesses: ["Limited depth", "Short responses", "Basic reasoning"],
    bestFor: ["Simple FAQ bots", "Classification", "Quick experiments"],
    contextWindow: 8192,
    languages: ["en", "es", "fr", "de", "pt", "it"],
    credits: { min: 6, max: 14 },
    speed: "fast",
    quality: 6,
    popular: false,
    recommended: false,
    tags: ["lightweight", "chat", "budget"],
  },
  {
    id: "google/gemma-2-2b-it",
    name: "Gemma 2 2B Instruct",
    org: "Google",
    size: "2B",
    sizeNum: 2,
    category: "lightweight",
    strengths: ["Ultra-lightweight", "Very fast", "Cheap to run"],
    weaknesses: ["Limited capability", "Simple outputs only"],
    bestFor: ["Prototyping", "Edge/mobile apps", "Budget experiments"],
    contextWindow: 8192,
    languages: ["en"],
    credits: { min: 4, max: 10 },
    speed: "fast",
    quality: 5.5,
    popular: false,
    recommended: false,
    tags: ["lightweight", "budget", "text"],
  },
  {
    id: "TinyLlama/TinyLlama-1.1B-Chat-v1.0",
    name: "TinyLlama 1.1B Chat",
    org: "TinyLlama",
    size: "1.1B",
    sizeNum: 1.1,
    category: "lightweight",
    strengths: ["Smallest model", "Near-instant inference", "Minimal cost"],
    weaknesses: ["Very limited capability", "Poor complex reasoning", "Short responses"],
    bestFor: ["Experiments", "Learning fine-tuning", "Proof of concepts"],
    contextWindow: 2048,
    languages: ["en"],
    credits: { min: 2, max: 6 },
    speed: "fast",
    quality: 4,
    popular: false,
    recommended: false,
    tags: ["lightweight", "experimental", "budget"],
  },
  {
    id: "microsoft/phi-2",
    name: "Phi-2",
    org: "Microsoft",
    size: "2.7B",
    sizeNum: 2.7,
    category: "general",
    strengths: ["Good reasoning for size", "Efficient", "Compact"],
    weaknesses: ["Older model", "Limited instruction following"],
    bestFor: ["Budget general tasks", "Quick experiments"],
    contextWindow: 2048,
    languages: ["en"],
    credits: { min: 6, max: 14 },
    speed: "fast",
    quality: 5.5,
    popular: false,
    recommended: false,
    tags: ["lightweight", "general", "text"],
  },

  // ── Instruction Following ───────────────
  {
    id: "tiiuae/falcon-7b-instruct",
    name: "Falcon 7B Instruct",
    org: "TII UAE",
    size: "7B",
    sizeNum: 7,
    category: "general",
    strengths: ["Strong instruction following", "Open license"],
    weaknesses: ["Older architecture", "Less refined output"],
    bestFor: ["Instruction following", "Text generation"],
    contextWindow: 2048,
    languages: ["en"],
    credits: { min: 15, max: 30 },
    speed: "fast",
    quality: 6.5,
    popular: false,
    recommended: false,
    tags: ["instruction", "text", "general"],
  },
];

// ─────────────────────────────────────────────
// Helper Functions
// ─────────────────────────────────────────────

/** Get a model by its ID */
export function getModelById(id: string): ModelInfo | undefined {
  return MODELS.find((m) => m.id === id);
}

/** Get all models for a specific category */
export function getModelsByCategory(category: ModelCategory | "all"): ModelInfo[] {
  if (category === "all") return MODELS;
  return MODELS.filter((m) => m.category === category);
}

/** Get the recommended model for a use case based on simple heuristics */
export function getRecommendedModel(opts?: {
  needsMultilingual?: boolean;
  needsCode?: boolean;
  needsReasoning?: boolean;
  budgetConstrained?: boolean;
  maxCredits?: number;
}): ModelInfo {
  if (opts?.needsCode) return MODELS.find((m) => m.category === "code") ?? MODELS[0];
  if (opts?.needsMultilingual) return MODELS.find((m) => m.category === "multilingual") ?? MODELS[0];
  if (opts?.needsReasoning) return MODELS.find((m) => m.id.includes("DeepSeek")) ?? MODELS[0];
  if (opts?.budgetConstrained || (opts?.maxCredits && opts.maxCredits < 15)) {
    return MODELS.find((m) => m.category === "lightweight" && m.credits.max <= (opts?.maxCredits ?? 15)) ?? MODELS[0];
  }
  return MODELS.find((m) => m.recommended) ?? MODELS[0];
}

/** Build a summary string for use in AI prompts */
export function getModelCatalogPrompt(): string {
  return MODELS.map((m) =>
    `- ${m.name} (${m.id}): ${m.size} params, ${m.category}, ` +
    `Quality ${m.quality}/10, ${m.credits.min}-${m.credits.max} credits, ` +
    `Best for: ${m.bestFor.join(", ")}. ` +
    `Strengths: ${m.strengths.join(", ")}. ` +
    `Languages: ${m.languages.join(", ")}.`
  ).join("\n");
}
