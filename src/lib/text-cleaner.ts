/**
 * Text Cleaner Utility
 * ====================
 * High-precision, Unicode-aware detection and sanitization for degenerate
 * autoregressive LLM repetition loops (e.g. non-Latin subwords/tokens repeating
 * dozens of times like "በተለይ በተለይ በተለይ...").
 *
 * Designed to preserve natural conversational emphasis (e.g. "very very very" /
 * "በጣም በጣም") while accurately cutting off runaway token loops and cleanly
 * restoring natural sentence and markdown list boundaries.
 */

/**
 * Checks if a string contains a degenerate token/word/phrase repetition loop.
 */
export function hasRepetitionLoop(text: string): boolean {
  if (!text || typeof text !== "string" || text.length < 40) return false;

  // Pattern 1: Single word repeated 4+ consecutive times with optional punctuation
  const singleWordRegex = /(?:^|\s)([\p{L}\p{N}_\-]{2,})(?:[\s,፣፤፦.!\-]+\1){3,}/u;
  if (singleWordRegex.test(text)) return true;

  // Pattern 2: Multi-word phrase (2-6 words) repeated 3+ consecutive times
  const phraseRegex = /(?:^|\s)((?:[\p{L}\p{N}_\-]+[\s,፣፤]+){1,5}[\p{L}\p{N}_\-]+)(?:[\s,፣፤፦.!\-]+\1){2,}/u;
  if (phraseRegex.test(text)) return true;

  // Pattern 3: Unnatural repeated character sequences (>12 times for non-markdown chars)
  const charRepeatRegex = /([^\s\-=\|#*`~_])\1{12,}/u;
  if (charRepeatRegex.test(text)) return true;

  return false;
}

/**
 * Cleans degenerate repetition loops from text by slicing at the loop's onset
 * and restoring a clean, natural sentence or list boundary.
 */
export function cleanRepetitionLoop(text: string): string {
  if (!text || typeof text !== "string" || text.length < 40) return text;

  // Pattern 1: Single word (2+ letters) repeated 4+ consecutive times with optional punctuation
  // e.g. "በተለይ በተለይ በተለይ በተለይ" or "በተለይ፣ በተለይ፣ በተለይ፣"
  const singleWordRegex = /(?:^|\s)([\p{L}\p{N}_\-]{2,})(?:[\s,፣፤፦.!\-]+\1){3,}/gu;

  // Pattern 2: Multi-word phrase (2-6 words) repeated 3+ consecutive times
  const phraseRegex = /(?:^|\s)((?:[\p{L}\p{N}_\-]+[\s,፣፤]+){1,5}[\p{L}\p{N}_\-]+)(?:[\s,፣፤፦.!\-]+\1){2,}/gu;

  // Pattern 3: Repeated character sequences (>12 times for non-markdown chars)
  const charRepeatRegex = /([^\s\-=\|#*`~_])\1{12,}/gu;

  let earliestCutIndex = -1;

  let match: RegExpExecArray | null;
  while ((match = singleWordRegex.exec(text)) !== null) {
    const cutPos = match.index;
    if (earliestCutIndex === -1 || cutPos < earliestCutIndex) {
      earliestCutIndex = cutPos;
    }
  }

  while ((match = phraseRegex.exec(text)) !== null) {
    const cutPos = match.index;
    if (earliestCutIndex === -1 || cutPos < earliestCutIndex) {
      earliestCutIndex = cutPos;
    }
  }

  while ((match = charRepeatRegex.exec(text)) !== null) {
    const cutPos = match.index;
    if (earliestCutIndex === -1 || cutPos < earliestCutIndex) {
      earliestCutIndex = cutPos;
    }
  }

  if (earliestCutIndex === -1) {
    return text;
  }

  // Find the start of the line or clause leading into the repetition
  let truncated = text.slice(0, earliestCutIndex).trimEnd();

  // If the repetition started on a bullet or numbered list point (e.g. "\n   - ውሂቡን"),
  // cut back to before that corrupt list item
  const lastBulletMatch = truncated.search(/(?:\r?\n|^)\s*(?:[-*+•]|\d+[.)])\s+[^\r\n]*$/);
  if (lastBulletMatch !== -1 && lastBulletMatch > truncated.length * 0.3) {
    truncated = truncated.slice(0, lastBulletMatch).trimEnd();
  }

  // Find a clean sentence or clause boundary before the cut
  // Check for punctuation preceded by a word character (avoiding list numbers like "1.")
  const sentenceEndRegex = /(?:[\p{L}\p{N}]{2,}[.!?።፤]+(?:\s+|\r?\n|$)|(?:\r?\n){2,}|\r?\n(?=\s*[-*+•\d]))/gu;
  let bestBoundary = -1;
  let m: RegExpExecArray | null;
  while ((m = sentenceEndRegex.exec(truncated)) !== null) {
    const end = m.index + m[0].length;
    if (end > bestBoundary && end >= truncated.length * 0.35) {
      bestBoundary = end;
    }
  }

  if (bestBoundary !== -1) {
    truncated = truncated.slice(0, bestBoundary).trim();
  } else {
    // If no strong boundary, cut back to the last newline if reasonably far along
    const lastNewline = truncated.lastIndexOf("\n");
    if (lastNewline > truncated.length * 0.5) {
      truncated = truncated.slice(0, lastNewline).trim();
    } else {
      // Clean trailing fragments and punctuation
      truncated = truncated.replace(/[\s\-,:፦፤]+$/, "").trim();
      if (truncated.length > 0 && !/[.!?።]$/.test(truncated)) {
        // If it's an Ethiopic script text, end with Ethiopian full stop '።', else '.'
        const isEthiopic = /[\u1200-\u137F]/.test(truncated);
        truncated += isEthiopic ? "።" : ".";
      }
    }
  }

  return truncated;
}
