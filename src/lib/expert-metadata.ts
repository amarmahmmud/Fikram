export type ReasoningMode = "strict" | "evaluative" | "hybrid";

export interface ExpertMetadata {
  cleanDescription: string;
  category: string;
  tags: string[];
  reasoningMode: ReasoningMode;
  webSearchEnabled: boolean;
}

/**
 * Parses embedded metadata tags from an expert's description:
 * e.g., "[Category: Tech] [Tags: AI, Startup] [Mode: evaluative] [WebSearch: true]"
 */
export function parseExpertMetadata(
  description: string = "",
  expertName: string = ""
): ExpertMetadata {
  const isRoast = /roast|evaluat|validator|critique/i.test(expertName);

  // Category
  const catMatch = description.match(/\[Category:\s*([^\]]+)\]/i);
  const category = catMatch ? catMatch[1].trim() : "General";

  // Tags
  const tagsMatch = description.match(/\[Tags:\s*([^\]]+)\]/i);
  const tags = tagsMatch
    ? tagsMatch[1]
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
    : ["Knowledge Base", "Q&A"];

  // Reasoning Mode (strict | evaluative | hybrid)
  const modeMatch = description.match(/\[Mode:\s*(strict|evaluative|hybrid)\]/i);
  let reasoningMode: ReasoningMode = "hybrid";
  if (modeMatch) {
    reasoningMode = modeMatch[1].toLowerCase() as ReasoningMode;
  } else if (isRoast) {
    reasoningMode = "evaluative";
  }

  // Web Search (true | false)
  const webMatch = description.match(/\[WebSearch:\s*(true|false)\]/i);
  let webSearchEnabled = false;
  if (webMatch) {
    webSearchEnabled = webMatch[1].toLowerCase() === "true";
  } else if (isRoast) {
    webSearchEnabled = true;
  }

  // Strip metadata tags from display description
  const cleanDescription = description
    .replace(/\[(Category|Tags|Mode|WebSearch):[^\]]+\]/gi, "")
    .trim();

  return {
    cleanDescription,
    category,
    tags,
    reasoningMode,
    webSearchEnabled,
  };
}

/**
 * Formats clean description with embedded metadata tags.
 */
export function formatExpertDescription(
  cleanDescription: string,
  options: {
    category?: string;
    tags?: string[];
    reasoningMode?: ReasoningMode;
    webSearchEnabled?: boolean;
  }
): string {
  const meta: string[] = [];
  if (options.category) meta.push(`[Category: ${options.category}]`);
  if (options.tags && options.tags.length > 0) meta.push(`[Tags: ${options.tags.join(", ")}]`);
  if (options.reasoningMode) meta.push(`[Mode: ${options.reasoningMode}]`);
  if (options.webSearchEnabled !== undefined) meta.push(`[WebSearch: ${options.webSearchEnabled}]`);

  const clean = cleanDescription
    .replace(/\[(Category|Tags|Mode|WebSearch):[^\]]+\]/gi, "")
    .trim();

  return meta.length > 0 ? `${clean}\n\n${meta.join(" ")}`.trim() : clean;
}
