import { GoogleGenAI } from "@google/genai";

export const RESILIENT_GEMINI_MODELS = [
  "gemini-3.5-flash",
  "gemini-3.6-flash",
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

import path from "path";
import fs from "fs";

function setupGoogleCredentials(): boolean {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    if (!path.isAbsolute(process.env.GOOGLE_APPLICATION_CREDENTIALS)) {
      process.env.GOOGLE_APPLICATION_CREDENTIALS = path.resolve(
        /* turbopackIgnore: true */ process.cwd(),
        process.env.GOOGLE_APPLICATION_CREDENTIALS
      );
    }
    return fs.existsSync(process.env.GOOGLE_APPLICATION_CREDENTIALS);
  }

  const defaultKeyPath = path.resolve(process.cwd(), "gcp-key.json");
  if (fs.existsSync(defaultKeyPath)) {
    process.env.GOOGLE_APPLICATION_CREDENTIALS = defaultKeyPath;
    return true;
  }

  return false;
}

/**
 * Returns all configured Gemini API keys, allowing round-robin rotation
 * across multiple keys to bypass per-key rate limits.
 */
export function getGeminiApiKeys(): string[] {
  const keysStr = process.env.GOOGLE_GEMINI_API_KEYS;
  if (keysStr) {
    const parsed = keysStr.split(",").map((k) => k.trim()).filter(Boolean);
    if (parsed.length > 0) return parsed;
  }
  const single = process.env.GOOGLE_CLOUD_API_KEY || process.env.GOOGLE_GEMINI_API_KEY;
  if (single) {
    if (single.includes(",")) {
      return single.split(",").map((k) => k.trim()).filter(Boolean);
    }
    return [single.trim()];
  }
  return [];
}

const clientCache = new Map<string, GoogleGenAI>();
let currentKeyIndex = 0;

function getGenAIClientForKey(apiKey: string): GoogleGenAI {
  let client = clientCache.get(apiKey);
  if (!client) {
    client = new GoogleGenAI({ apiKey });
    clientCache.set(apiKey, client);
  }
  return client;
}

function getEnterpriseClient(): GoogleGenAI {
  setupGoogleCredentials();
  const project = process.env.GOOGLE_CLOUD_PROJECT || "model-factory-505311";
  const location = process.env.GOOGLE_CLOUD_LOCATION || "us-central1";
  return new GoogleGenAI({
    vertexai: true,
    project: project,
    location: location,
  });
}

/**
 * Returns an initialized GoogleGenAI client configured for Vertex AI Enterprise
 * if a service account key or GOOGLE_GENAI_USE_ENTERPRISE is present,
 * otherwise falling back to standard API key mode.
 */
export function getGenAIClient(): GoogleGenAI {
  const useEnterprise = process.env.GOOGLE_GENAI_USE_ENTERPRISE === "true";
  if (useEnterprise) {
    return getEnterpriseClient();
  }

  const keys = getGeminiApiKeys();
  if (keys.length === 0) {
    throw new Error("Neither Google Service Account key nor Gemini API key is configured in environment.");
  }

  const key = keys[currentKeyIndex % keys.length];
  return getGenAIClientForKey(key);
}

/**
 * Execute a generateContent call against Gemini with automatic
 * retry and fallback across multiple models and API keys when encountering 503 (high demand)
 * or 429 (rate limits).
 */
export async function generateWithModelFallback(
  contentsOrRequest: any,
  options: ResilientGenerateOptions = {}
) {
  const useEnterprise = process.env.GOOGLE_GENAI_USE_ENTERPRISE === "true";
  const keys = useEnterprise ? [] : getGeminiApiKeys();

  if (!useEnterprise && keys.length === 0) {
    throw new Error("Neither Google Service Account key nor Gemini API key is configured in environment.");
  }

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
      // If we have multiple keys, we try across available keys before sleeping
      const keysToTryCount = useEnterprise ? 1 : Math.max(1, keys.length);

      for (let keyAttempt = 0; keyAttempt < keysToTryCount; keyAttempt++) {
        const activeKey = useEnterprise ? "" : keys[currentKeyIndex % keys.length];
        const client = useEnterprise ? getEnterpriseClient() : getGenAIClientForKey(activeKey);

        try {
          const result = await client.models.generateContent({
            model: modelName,
            contents: contents,
            config: Object.keys(config).length > 0 ? config : undefined,
          });

          // result.text may be a getter (string) or a function depending on the SDK version
          const rawText = result.text;
          const textOutput = (typeof rawText === "function" ? (rawText as () => string)() : rawText) || "";

          // Advance key index for natural load-balancing across requests
          if (!useEnterprise && keys.length > 1) {
            currentKeyIndex = (currentKeyIndex + 1) % keys.length;
          }

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
            status === 502 ||
            status === 504 ||
            msg.includes("503") ||
            msg.includes("429") ||
            msg.includes("502") ||
            msg.includes("504") ||
            msg.includes("high demand") ||
            msg.includes("overloaded") ||
            msg.includes("Resource has been exhausted") ||
            msg.includes("fetch failed") ||
            msg.includes("Timeout") ||
            msg.includes("timeout") ||
            msg.includes("ETIMEDOUT") ||
            msg.includes("ECONNRESET") ||
            err?.code === "UND_ERR_CONNECT_TIMEOUT";

          if (isTransient) {
            if (!useEnterprise && keys.length > 1) {
              const prevIdx = currentKeyIndex % keys.length;
              currentKeyIndex = (currentKeyIndex + 1) % keys.length;
              console.warn(
                `[Gemini Rotation] Model ${modelName} hit ${status || "transient"} on key ${prevIdx + 1}/${keys.length}. Switching to key ${currentKeyIndex + 1}/${keys.length}...`
              );
              // If there are more keys to try without delay, try next key immediately
              if (keyAttempt < keysToTryCount - 1) {
                continue;
              }
            }

            const delay = (status === 429 || msg.includes("429") || msg.includes("Resource has been exhausted"))
              ? attempt * 2000
              : attempt * 1000;
            console.warn(
              `[Gemini Fallback] Model ${modelName} all keys hit transient issue (status ${status}, attempt ${attempt}/${maxRetries}). Retrying in ${delay}ms...`
            );
            await new Promise((resolve) => setTimeout(resolve, delay));
          } else {
            console.warn(`[Gemini Fallback] Model ${modelName} failed with non-transient error: ${msg}. Trying next candidate model...`);
            break; // Don't retry same model if it's not transient, try next model
          }
        }
      }
    }
  }

  throw lastError;
}

/**
 * Downloads a file from a URL to a temporary local file, uploads it to Gemini File API,
 * polls until it becomes ACTIVE, and returns the file URI.
 */
export async function uploadFileFromUrl(url: string, mimeType: string): Promise<string> {
  const os = await import("os");
  const fs = await import("fs");
  const path = await import("path");

  // Fetch the file from the signed URL
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`Failed to download file from storage: ${res.statusText}`);

  // Create temp file path
  const tempPath = path.join(os.tmpdir(), `gemini-upload-${Date.now()}-${Math.random().toString(36).substring(7)}`);
  
  // Stream to disk
  const fileStream = fs.createWriteStream(tempPath);
  
  // @ts-ignore - native fetch response body to Node stream
  await new Promise((resolve, reject) => {
    // We can use node's native readable stream from Web Streams API
    // Actually, simple array buffer is safer for smallish files (up to 50MB) if streaming is complex, 
    // but arrayBuffer still uses memory. 
    // Let's use array buffer for simplicity and to avoid polyfill issues, 50MB ArrayBuffer is OK locally,
    // just avoid Base64 stringification.
    res.arrayBuffer().then(buffer => {
      fs.writeFileSync(tempPath, Buffer.from(buffer));
      resolve(true);
    }).catch(reject);
  });
  const isEnterprise = Boolean(process.env.GOOGLE_CLOUD_PROJECT && process.env.GOOGLE_GENAI_USE_ENTERPRISE);
  const keys = getGeminiApiKeys();
  const activeKey = isEnterprise ? "" : keys[currentKeyIndex % keys.length];
  const client = isEnterprise ? getEnterpriseClient() : getGenAIClientForKey(activeKey);

  try {
    console.log(`[Gemini File API] Uploading temp file ${tempPath} (${mimeType})`);
    let file = await client.files.upload({
      file: tempPath,
      config: { mimeType },
    });

    console.log(`[Gemini File API] Uploaded ${file.name}. Polling until ACTIVE...`);
    let retries = 0;
    while (file.state?.toString() !== "ACTIVE") {
      if (file.state?.toString() === "FAILED") {
        throw new Error("Gemini file processing failed");
      }
      if (retries > 60) {
        throw new Error("Timeout waiting for Gemini file processing");
      }
      
      await new Promise(r => setTimeout(r, 2000));
      file = await client.files.get({ name: file.name! });
      retries++;
    }

    console.log(`[Gemini File API] File ${file.name} is ACTIVE`);
    return file.uri!;
  } finally {
    // Always cleanup the local temp file
    if (fs.existsSync(tempPath)) {
      fs.unlinkSync(tempPath);
    }
  }
}

/**
 * Deletes a file from Gemini File API by URI
 */
export async function deleteGeminiFile(uri: string) {
  // Extract name from uri, typical uri: https://generativelanguage.googleapis.com/v1beta/files/abc
  // Wait, files API uses the short name, e.g. "files/abc"
  const keys = getGeminiApiKeys();
  const activeKey = keys[currentKeyIndex % keys.length];
  const client = getGenAIClientForKey(activeKey);
  
  try {
    // If it's a URI, we can try to extract the file ID
    // E.g., https://generativelanguage.googleapis.com/v1beta/files/abc -> files/abc
    const match = uri.match(/files\/[a-zA-Z0-9_-]+/);
    const name = match ? match[0] : null;
    
    if (name) {
      await client.files.delete({ name });
      console.log(`[Gemini File API] Deleted ${name}`);
    }
  } catch (err) {
    console.warn(`[Gemini File API] Failed to delete ${uri}:`, err);
  }
}

