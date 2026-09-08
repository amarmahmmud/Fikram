import { GoogleGenerativeAI, GenerateContentRequest } from "@google/generative-ai";

export const RESILIENT_GEMINI_MODELS = [
  "gemini-3.7-flash",
  "gemini-3-flash-preview",
  "gemini-3.1-flash-lite",
  "gemini-flash-latest",
];

export interface ResilientGenerateOptions {
  systemInstruction?: any;
  generationConfig?: any;
  preferredModels?: string[];
  maxRetriesPerModel?: number;
}

/**
 * Execute a generateContent call against Gemini with automatic
 * retry and fallback across multiple models when encountering 503 (high demand)
 * or 429 (rate limits).
 */
export async function generateWithModelFallback(
  contentsOrRequest: GenerateContentRequest | string | Array<any>,
  options: ResilientGenerateOptions = {}
) {
  const apiKey = process.env.GOOGLE_CLOUD_API_KEY || process.env.GOOGLE_GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("Neither GOOGLE_CLOUD_API_KEY nor GOOGLE_GEMINI_API_KEY is set in environment.");
  }

  const client = new GoogleGenerativeAI(apiKey);
  const models = options.preferredModels && options.preferredModels.length > 0
    ? options.preferredModels
    : RESILIENT_GEMINI_MODELS;

  const maxRetries = options.maxRetriesPerModel ?? 2;
  let lastError: any = null;

  // Normalize request payload
  let payload: GenerateContentRequest;
  if (typeof contentsOrRequest === "string") {
    payload = {
      contents: [{ role: "user", parts: [{ text: contentsOrRequest }] }],
      generationConfig: options.generationConfig,
    };
  } else if (Array.isArray(contentsOrRequest)) {
    payload = {
      contents: contentsOrRequest,
      generationConfig: options.generationConfig,
    };
  } else {
    payload = {
      ...contentsOrRequest,
      generationConfig: options.generationConfig || contentsOrRequest.generationConfig,
    };
  }

  for (const modelName of models) {
    const model = client.getGenerativeModel({
      model: modelName,
      ...(options.systemInstruction ? { systemInstruction: options.systemInstruction } : {}),
    });

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const result = await model.generateContent(payload);
        return result;
      } catch (err: any) {
        lastError = err;
        const msg = err?.message || "";
        const status = err?.status;

        const isTransient =
          status === 503 ||
          status === 429 ||
          msg.includes("503") ||
          msg.includes("429") ||
          msg.includes("high demand") ||
          msg.includes("overloaded") ||
          msg.includes("Resource has been exhausted");

        if (isTransient) {
          const delay = (status === 429 || msg.includes("429") || msg.includes("Resource has been exhausted"))
            ? attempt * 2500
            : attempt * 1000;
          console.warn(
            `[Gemini Fallback] Model ${modelName} hit transient issue (status ${status}, attempt ${attempt}/${maxRetries}). Retrying in ${delay}ms...`
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
        } else {
          console.warn(`[Gemini Fallback] Model ${modelName} failed with error: ${msg}. Trying next candidate model...`);
          break; // Don't retry same model if it's not transient, try next model
        }
      }
    }
  }

  throw lastError;
}
