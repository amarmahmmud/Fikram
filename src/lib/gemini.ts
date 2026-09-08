import { GoogleGenAI } from "@google/genai";

export const RESILIENT_GEMINI_MODELS = [
  "gemini-2.5-flash",
  "gemini-1.5-flash",
  "gemini-3-flash-preview",
];

export interface ResilientGenerateOptions {
  systemInstruction?: any;
  generationConfig?: any;
  preferredModels?: string[];
  maxRetriesPerModel?: number;
}

/**
 * Normalizes input contents into the format expected by @google/genai.
 */
function normalizeContents(contentsOrRequest: any): any {
  if (typeof contentsOrRequest === "string") {
    return contentsOrRequest;
  }
  if (Array.isArray(contentsOrRequest)) {
    return contentsOrRequest;
  }
  if (contentsOrRequest && contentsOrRequest.contents) {
    return contentsOrRequest.contents;
  }
  return contentsOrRequest;
}

/**
 * Returns an initialized GoogleGenAI client configured for Vertex AI Enterprise
 * if GOOGLE_GENAI_USE_ENTERPRISE or GOOGLE_CLOUD_PROJECT is set,
 * otherwise falling back to standard API key mode.
 */
function getGenAIClient(): GoogleGenAI {
  const apiKey = process.env.GOOGLE_CLOUD_API_KEY || process.env.GOOGLE_GEMINI_API_KEY;
  const project = process.env.GOOGLE_CLOUD_PROJECT;
  const location = process.env.GOOGLE_CLOUD_LOCATION || "us-central1";
  const useEnterprise = process.env.GOOGLE_GENAI_USE_ENTERPRISE === "true" || !!project;

  if (useEnterprise && project) {
    return new GoogleGenAI({
      vertexai: true,
      project: project,
      location: location,
      apiKey: apiKey,
    });
  }

  if (!apiKey) {
    throw new Error("Neither GOOGLE_CLOUD_API_KEY nor GOOGLE_GEMINI_API_KEY is set in environment.");
  }

  return new GoogleGenAI({ apiKey });
}

/**
 * Execute a generateContent call against Gemini with automatic
 * retry and fallback across multiple models when encountering 503 (high demand)
 * or 429 (rate limits).
 */
export async function generateWithModelFallback(
  contentsOrRequest: any,
  options: ResilientGenerateOptions = {}
) {
  const client = getGenAIClient();
  const models = options.preferredModels && options.preferredModels.length > 0
    ? options.preferredModels
    : RESILIENT_GEMINI_MODELS;

  const maxRetries = options.maxRetriesPerModel ?? 2;
  let lastError: any = null;
  const contents = normalizeContents(contentsOrRequest);

  const config: any = {
    ...(options.generationConfig || {}),
  };
  if (options.systemInstruction) {
    config.systemInstruction = options.systemInstruction;
  }

  for (const modelName of models) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const result = await client.models.generateContent({
          model: modelName,
          contents: contents,
          config: Object.keys(config).length > 0 ? config : undefined,
        });

        const textOutput = result.text || "";

        // Return an adapter object preserving .response.text() compatibility for existing callers
        return {
          text: () => textOutput,
          response: {
            text: () => textOutput,
          },
          raw: result,
        };
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
