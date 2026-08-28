import { NextResponse } from "next/server";
import cheerio from "cheerio";
import { htmlToText } from "html-to-text";

/**
 * POST /api/scrape-url
 * Body: { url: string }
 * Returns: { ok: true, text: string, title?: string } or { ok: false, error: string }
 */
export async function POST(req: Request) {
  try {
    const { url } = await req.json();
    if (!url || typeof url !== "string") {
      return NextResponse.json({ ok: false, error: "Missing or invalid 'url'" }, { status: 400 });
    }
    // Basic validation – only allow http/https and block private IP ranges
    if (!/^https?:\/\//i.test(url)) {
      return NextResponse.json({ ok: false, error: "Only http:// or https:// URLs are allowed" }, { status: 400 });
    }
    // Fetch with reasonable timeout (10s)
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!response.ok) {
      return NextResponse.json({ ok: false, error: `Failed to fetch URL (status ${response.status})` }, { status: 502 });
    }
    const html = await response.text();
    const $ = cheerio.load(html);
    const title = $("title").first().text().trim();
    // Remove script/style/comments
    $("script, style, noscript").remove();
    const text = htmlToText(html, {
      wordwrap: false,
      selectors: [
        { selector: "a", options: { ignoreHref: true } },
        { selector: "img", format: "skip" },
      ],
    });
    const trimmed = text.trim().slice(0, 5000); // cap to 5k chars to keep prompt size reasonable
    return NextResponse.json({ ok: true, title, text: trimmed });
  } catch (err: any) {
    console.error("scrape-url error:", err);
    const msg = err.name === "AbortError" ? "Request timed out" : err.message ?? "Unknown error";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
