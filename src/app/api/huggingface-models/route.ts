import { NextResponse } from "next/server";

// ─────────────────────────────────────────────
// HuggingFace Model Discovery API
// Fetches fine-tunable text-generation models
// ─────────────────────────────────────────────

export interface HFModel {
  id: string;
  name: string;
  org: string;
  downloads: number;
  likes: number;
  size: string;
  tags: string[];
  lastModified: string;
}

// In-memory cache to avoid hammering HuggingFace on every request
let cache: { data: HFModel[]; timestamp: number } | null = null;
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

// These are our verified models — we exclude them from HF results to avoid duplicates
const VERIFIED_IDS = new Set([
  "meta-llama/Llama-3.1-8B-Instruct",
  "google/gemma-2-9b-it",
  "mistralai/Mistral-7B-Instruct-v0.3",
  "microsoft/Phi-3-mini-4k-instruct",
  "microsoft/Phi-3.5-mini-instruct",
  "deepseek-ai/DeepSeek-R1-Distill-Llama-8B",
  "meta-llama/CodeLlama-7b-Instruct-hf",
  "Qwen/Qwen2.5-7B-Instruct",
  "meta-llama/Llama-3.2-3B-Instruct",
  "google/gemma-2-2b-it",
  "TinyLlama/TinyLlama-1.1B-Chat-v1.0",
  "microsoft/phi-2",
  "tiiuae/falcon-7b-instruct",
]);

// Parameter size limits for fine-tuning (in billions)
const MAX_PARAMS_B = 13; // A100 80GB can fine-tune up to ~13B with LoRA

function estimateParamsFromTags(tags: string[]): number | null {
  // HuggingFace tags often include size indicators
  for (const tag of tags) {
    const match = tag.match(/^(\d+(?:\.\d+)?)b$/i);
    if (match) return parseFloat(match[1]);
  }
  return null;
}

function formatSize(params: number | null): string {
  if (!params) return "Unknown";
  if (params >= 1) return `${params}B`;
  return `${Math.round(params * 1000)}M`;
}

async function fetchHuggingFaceModels(): Promise<HFModel[]> {
  // Check cache
  if (cache && Date.now() - cache.timestamp < CACHE_TTL) {
    return cache.data;
  }

  const models: HFModel[] = [];

  try {
    // Fetch text-generation models sorted by downloads, with safetensors
    const params = new URLSearchParams({
      pipeline_tag: "text-generation",
      library: "safetensors",
      sort: "downloads",
      direction: "-1",
      limit: "80",
      full: "false",
    });

    const res = await fetch(`https://huggingface.co/api/models?${params}`, {
      headers: { "Accept": "application/json" },
      next: { revalidate: 600 }, // Next.js cache for 10 min
    });

    if (!res.ok) {
      console.error("HuggingFace API error:", res.status, res.statusText);
      return cache?.data ?? [];
    }

    const data = await res.json();

    for (const model of data) {
      const modelId: string = model.modelId ?? model.id ?? "";

      // Skip our verified models
      if (VERIFIED_IDS.has(modelId)) continue;

      // Skip models without safetensors (can't easily fine-tune)
      const tags: string[] = model.tags ?? [];
      if (!tags.includes("safetensors")) continue;

      // Check model size — skip if too large
      const params = estimateParamsFromTags(tags);
      if (params && params > MAX_PARAMS_B) continue;

      // Skip non-instruct/chat models (base models are harder to fine-tune usefully)
      const nameLower = modelId.toLowerCase();
      const isInstruct = nameLower.includes("instruct") ||
        nameLower.includes("chat") ||
        nameLower.includes("it") ||
        tags.includes("conversational");

      // Extract org and model name
      const parts = modelId.split("/");
      const org = parts.length > 1 ? parts[0] : "Unknown";
      const name = parts.length > 1 ? parts[1] : modelId;

      models.push({
        id: modelId,
        name: name.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
        org,
        downloads: model.downloads ?? 0,
        likes: model.likes ?? 0,
        size: formatSize(params),
        tags: [
          ...(isInstruct ? ["instruct"] : ["base"]),
          ...(params ? [`${formatSize(params)}`] : []),
          ...tags.filter((t: string) =>
            ["text-generation", "conversational", "en", "zh", "ar", "multilingual"].includes(t)
          ).slice(0, 3),
        ],
        lastModified: model.lastModified ?? "",
      });
    }
  } catch (err) {
    console.error("Failed to fetch HuggingFace models:", err);
    return cache?.data ?? [];
  }

  // Cache the results
  cache = { data: models, timestamp: Date.now() };
  return models;
}

export async function GET() {
  try {
    const models = await fetchHuggingFaceModels();
    return NextResponse.json({
      ok: true,
      models,
      cached: cache ? Date.now() - cache.timestamp < 1000 : false,
      total: models.length,
    });
  } catch (err: any) {
    console.error("HuggingFace Models API error:", err?.message);
    return NextResponse.json(
      { ok: false, error: "Failed to fetch models", models: [] },
      { status: 500 }
    );
  }
}
