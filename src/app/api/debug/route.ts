import { NextResponse } from "next/server";

export async function GET() {
  // Block this endpoint in production to prevent service enumeration by external users.
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const results: Record<string, { ok: boolean; detail: string }> = {};

  // 1. Check Groq
  try {
    const groqRes = await fetch("https://api.groq.com/openai/v1/models", {
      headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
    });
    results.groq = groqRes.ok
      ? { ok: true, detail: "Connected" }
      : { ok: false, detail: `Status ${groqRes.status}` };
  } catch (e) {
    results.groq = { ok: false, detail: String(e) };
  }

  // 2. Check Gemini
  try {
    const gemRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${process.env.GOOGLE_GEMINI_API_KEY}`
    );
    results.gemini = gemRes.ok
      ? { ok: true, detail: "Connected" }
      : { ok: false, detail: `Status ${gemRes.status}` };
  } catch (e) {
    results.gemini = { ok: false, detail: String(e) };
  }

  // 3. Check Replicate
  try {
    const repRes = await fetch("https://api.replicate.com/v1/account", {
      headers: { Authorization: `Token ${process.env.REPLICATE_API_TOKEN}` },
    });
    results.replicate = repRes.ok
      ? { ok: true, detail: "Connected" }
      : { ok: false, detail: `Status ${repRes.status}` };
  } catch (e) {
    results.replicate = { ok: false, detail: String(e) };
  }

  // 4. Check Supabase
  results.supabase = {
    ok: !!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
    detail: process.env.NEXT_PUBLIC_SUPABASE_URL
      ? `URL set: ${process.env.NEXT_PUBLIC_SUPABASE_URL.slice(0, 40)}...`
      : "Missing",
  };

  // 5. Check Modal endpoints
  results.modal_train = {
    ok: !!process.env.MODAL_TRAIN_URL,
    detail: process.env.MODAL_TRAIN_URL ? "URL configured" : "MODAL_TRAIN_URL missing",
  };
  results.modal_inference = {
    ok: !!process.env.MODAL_INFERENCE_URL,
    detail: process.env.MODAL_INFERENCE_URL ? "URL configured" : "MODAL_INFERENCE_URL missing",
  };

  // 6. Check Cloudflare R2
  results.r2 = {
    ok: !!(process.env.CLOUDFLARE_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID && process.env.R2_BUCKET_NAME),
    detail: process.env.CLOUDFLARE_ACCOUNT_ID
      ? `Account: ${process.env.CLOUDFLARE_ACCOUNT_ID.slice(0, 8)}... | Bucket: ${process.env.R2_BUCKET_NAME || "missing"}`
      : "CLOUDFLARE_ACCOUNT_ID missing",
  };

  // 7. Check service role key
  results.supabase_admin = {
    ok: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    detail: process.env.SUPABASE_SERVICE_ROLE_KEY
      ? "Service role key set"
      : "SUPABASE_SERVICE_ROLE_KEY missing — webhooks will fail!",
  };

  const allOk = Object.values(results).every((r) => r.ok);
  return NextResponse.json({ allOk, results }, { status: allOk ? 200 : 207 });
}
