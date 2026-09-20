import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { TextToSpeechClient } from "@google-cloud/text-to-speech";
import {
  checkRateLimit,
  checkCharacterQuota,
  getClientIP,
  ANON_TTS_LIMIT,
  AUTH_TTS_LIMIT,
  ANON_TTS_CHAR_QUOTA,
  AUTH_TTS_CHAR_QUOTA,
  MAX_TTS_CHARS_PER_REQUEST,
} from "@/lib/rate-limiter";
import {
  detectLanguage,
  cleanTextForTTS,
  getLanguageConfig,
  DEFAULT_TTS_MODEL,
} from "@/lib/tts-config";
import fs from "fs";
import path from "path";
import os from "os";

export const runtime = "nodejs";
export const maxDuration = 60; // Allow up to 60s for long audio synthesis

let cachedTtsClient: TextToSpeechClient | null = null;

/**
 * Initializes and caches the Google Cloud Text-to-Speech client
 * using credentials from environment variables or local gcp-key.json.
 */
function getTTSClient(): TextToSpeechClient {
  if (cachedTtsClient) return cachedTtsClient;

  let keyFilename: string | undefined;

  // 1. Check path specified in GOOGLE_APPLICATION_CREDENTIALS
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    const credPath = path.isAbsolute(process.env.GOOGLE_APPLICATION_CREDENTIALS)
      ? process.env.GOOGLE_APPLICATION_CREDENTIALS
      : path.resolve(/*turbopackIgnore: true*/ process.cwd(), process.env.GOOGLE_APPLICATION_CREDENTIALS);
    if (fs.existsSync(credPath)) {
      keyFilename = credPath;
    }
  }

  // 2. Check JSON string in GOOGLE_APPLICATION_CREDENTIALS_JSON (Vercel / cloud)
  if (!keyFilename && process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
    try {
      let json = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON.trim();
      if (!json.startsWith("{") && json.length > 50) {
        try {
          const decoded = Buffer.from(json, "base64").toString("utf-8");
          if (decoded.trim().startsWith("{")) json = decoded.trim();
        } catch {}
      }
      const tmpPath = path.join(os.tmpdir(), "gcp-tts-key.json");
      fs.writeFileSync(tmpPath, json, { mode: 0o600 });
      keyFilename = tmpPath;
    } catch (e) {
      console.error("[TTS] Failed to parse GOOGLE_APPLICATION_CREDENTIALS_JSON:", e);
    }
  }

  // 3. Fallback to default gcp-key.json in root
  if (!keyFilename) {
    const defaultKey = path.resolve(process.cwd(), "gcp-key.json");
    if (fs.existsSync(defaultKey)) {
      keyFilename = defaultKey;
    }
  }

  const projectId = process.env.GOOGLE_CLOUD_PROJECT || "model-factory-505311";

  cachedTtsClient = new TextToSpeechClient({
    projectId,
    ...(keyFilename ? { keyFilename } : {}),
  });

  return cachedTtsClient;
}

interface TTSErrorLike {
  details?: string;
  message?: string;
  statusDetails?: Array<{ reason?: string }>;
  reason?: string;
  code?: number;
}

/**
 * Classifies Google Cloud error codes and messages into structured client-safe error payloads.
 */
function classifyTTSError(error: unknown, languageCode: string, isPreview: boolean): {
  status: number;
  code: string;
  error: string;
  details?: string;
} {
  const err = error as TTSErrorLike | undefined;
  const msg = err?.details || err?.message || String(error);
  const statusDetails = err?.statusDetails || [];
  const reason = err?.reason || statusDetails[0]?.reason;

  // 1. Service disabled / unauthenticated
  if (
    reason === "SERVICE_DISABLED" ||
    msg.includes("has not been used in project") ||
    msg.includes("is disabled")
  ) {
    return {
      status: 403,
      code: "SERVICE_DISABLED",
      error: "Cloud Text-to-Speech API is disabled in your Google Cloud project.",
      details: "Enable it in GCP Console: https://console.developers.google.com/apis/api/texttospeech.googleapis.com",
    };
  }

  // 2. Preview language unavailable or voice not found
  if (
    isPreview ||
    languageCode.startsWith("am") ||
    msg.includes("Language not supported") ||
    msg.includes("Voice not found") ||
    msg.includes("INVALID_ARGUMENT") ||
    msg.includes("not supported")
  ) {
    return {
      status: 400,
      code: isPreview ? "PREVIEW_UNAVAILABLE" : "LANGUAGE_NOT_SUPPORTED",
      error: isPreview
        ? `Audio synthesis for ${languageCode} is in Preview status on Google Cloud and is currently unavailable on this voice endpoint.`
        : `Language or voice "${languageCode}" is not supported by Google Cloud TTS.`,
      details: msg,
    };
  }

  // 3. Quota or rate limit
  if (msg.includes("Resource has been exhausted") || err?.code === 8 || msg.includes("429")) {
    return {
      status: 429,
      code: "QUOTA_EXCEEDED",
      error: "Google Cloud TTS quota exceeded. Please try again later.",
      details: msg,
    };
  }

  return {
    status: 500,
    code: "TTS_SYNTHESIS_FAILED",
    error: "Failed to synthesize speech.",
    details: msg,
  };
}

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    // 1. Rate Limiting Check
    const ip = getClientIP(req);
    const rateLimitKey = user ? `user:${user.id}:tts` : `ip:${ip}:tts`;
    const rateLimitConfig = user ? AUTH_TTS_LIMIT : ANON_TTS_LIMIT;

    const { allowed, resetMs } = await checkRateLimit(rateLimitKey, rateLimitConfig);
    if (!allowed) {
      return NextResponse.json(
        {
          error: "TTS rate limit exceeded. Please wait before requesting more audio.",
          code: "RATE_LIMIT_EXCEEDED",
          retryAfterMs: resetMs,
        },
        { status: 429, headers: { "Retry-After": String(Math.ceil(resetMs / 1000)) } }
      );
    }

    // 2. Parse Request Body
    const body = await req.json();
    const {
      text,
      languageCode: explicitLanguageCode,
      voiceName: explicitVoiceName,
      speakingRate = 1.0,
      model = DEFAULT_TTS_MODEL,
    } = body;

    if (!text || typeof text !== "string" || text.trim().length === 0) {
      return NextResponse.json({ error: "No text provided for synthesis", code: "INVALID_INPUT" }, { status: 400 });
    }

    // Clean text: strip markdown formatting to yield natural spoken sentences
    const cleanText = cleanTextForTTS(text);
    if (cleanText.length === 0) {
      return NextResponse.json({ error: "Text contains no speakable content", code: "INVALID_INPUT" }, { status: 400 });
    }

    // Single request character cap
    if (cleanText.length > MAX_TTS_CHARS_PER_REQUEST) {
      return NextResponse.json(
        {
          error: `Text exceeds maximum allowed length of ${MAX_TTS_CHARS_PER_REQUEST} characters per request.`,
          code: "TEXT_TOO_LONG",
          maxCharacters: MAX_TTS_CHARS_PER_REQUEST,
          characterCount: cleanText.length,
        },
        { status: 400 }
      );
    }

    // 3. Hourly Character Quota Check (Cost Control)
    const quotaKey = user ? `user:${user.id}` : `ip:${ip}`;
    const maxChars = user ? AUTH_TTS_CHAR_QUOTA : ANON_TTS_CHAR_QUOTA;
    const { allowed: quotaAllowed, remaining: quotaRemaining, resetMs: quotaResetMs } =
      await checkCharacterQuota(quotaKey, cleanText.length, maxChars);

    if (!quotaAllowed) {
      return NextResponse.json(
        {
          error: "Character synthesis quota exceeded for this hour. Please try again later.",
          code: "QUOTA_EXCEEDED",
          remainingChars: 0,
          retryAfterMs: quotaResetMs,
        },
        { status: 429, headers: { "Retry-After": String(Math.ceil(quotaResetMs / 1000)) } }
      );
    }

    // 4. Language & Voice Resolution
    let finalLangCode = explicitLanguageCode;
    let finalVoiceName = explicitVoiceName;
    let isPreview = false;

    if (!finalLangCode) {
      const detected = detectLanguage(cleanText);
      finalLangCode = detected.languageCode;
      isPreview = detected.isPreview;
      if (!finalVoiceName) {
        finalVoiceName = detected.defaultVoice;
      }
    } else {
      const config = getLanguageConfig(finalLangCode);
      isPreview = config.isPreview || false;
      if (!finalVoiceName) {
        finalVoiceName = config.defaultVoice;
      }
    }

    // Log character usage for billing & analytics
    console.log(
      `[TTS Usage] user=${user ? user.id : "anon"} ip=${ip} lang=${finalLangCode} voice=${finalVoiceName} chars=${cleanText.length} model=${model}`
    );

    // 5. Initialize Client & Synthesize Speech
    const client = getTTSClient();

    try {
      const [unaryResult] = await client.synthesizeSpeech({
        input: { text: cleanText },
        voice: {
          languageCode: finalLangCode,
          name: finalVoiceName,
        },
        audioConfig: {
          audioEncoding: "MP3",
          speakingRate,
        },
      });

      if (!unaryResult.audioContent || unaryResult.audioContent.length === 0) {
        return NextResponse.json(
          { error: "TTS provider returned empty audio content", code: "EMPTY_AUDIO" },
          { status: 500 }
        );
      }

      const audioBuffer = Buffer.from(unaryResult.audioContent);

      return new Response(audioBuffer, {
        status: 200,
        headers: {
          "Content-Type": "audio/mpeg",
          "Content-Length": String(audioBuffer.length),
          "Cache-Control": "no-cache, no-store",
          "X-TTS-Language": finalLangCode,
          "X-TTS-Voice": finalVoiceName,
          "X-TTS-Chars": String(cleanText.length),
          "X-TTS-Remaining-Quota": String(quotaRemaining),
        },
      });
    } catch (synthErr: unknown) {
      console.error("[TTS Synthesis error]:", (synthErr as Error)?.message || synthErr);
      const classified = classifyTTSError(synthErr, finalLangCode, isPreview);
      return NextResponse.json(
        {
          error: classified.error,
          code: classified.code,
          isPreview,
          languageCode: finalLangCode,
          details: classified.details,
        },
        { status: classified.status }
      );
    }
  } catch (error: unknown) {
    const err = error as Error | undefined;
    console.error("[TTS API Route Exception]:", error);
    return NextResponse.json(
      {
        error: "Internal server error occurred while processing TTS request.",
        code: "SERVER_ERROR",
        details: err?.message,
      },
      { status: 500 }
    );
  }
}
