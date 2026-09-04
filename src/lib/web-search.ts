import * as cheerio from "cheerio";

export interface WebSearchResult {
  title: string;
  snippet: string;
  link: string;
}

/**
 * Searches the public web using DuckDuckGo HTML endpoint without requiring third-party API keys.
 * Returns up to maxResults clean title/snippet/link entries.
 */
export async function searchWeb(query: string, maxResults = 4): Promise<WebSearchResult[]> {
  try {
    const cleanQuery = query
      .replace(/^(roast my idea|roast|evaluate|what do you think about|critique|check):?\s*/i, "")
      .trim();

    const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(cleanQuery)}`;
    const response = await fetch(searchUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      console.warn(`[WebSearch] Search request failed with status ${response.status}`);
      return [];
    }

    const html = await response.text();
    const $ = cheerio.load(html);
    const results: WebSearchResult[] = [];

    $(".result").each((_, element) => {
      if (results.length >= maxResults) return;

      const title = $(element).find(".result__title a").text().trim();
      const snippet = $(element).find(".result__snippet").text().trim();
      const link = $(element).find(".result__url").text().trim();

      if (title && snippet) {
        results.push({
          title,
          snippet,
          link: link.startsWith("http") ? link : `https://${link}`,
        });
      }
    });

    return results;
  } catch (err: any) {
    console.warn(`[WebSearch] Search error for query "${query}":`, err.message);
    return [];
  }
}
