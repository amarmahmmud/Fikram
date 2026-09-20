import { NextRequest, NextResponse } from "next/server";
import { generateWithModelFallback } from "@/lib/gemini";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Speech-to-Text API route using Gemini Multimodal Audio Transcription.
 * Supports WebM, WAV, MP3, OGG, and MP4 audio in any language (including English, Amharic, and Arabic).
 */
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const languageHint = (formData.get("language") as string) || "auto";

    if (!file) {
      return NextResponse.json(
        { ok: false, error: "No audio file provided" },
        { status: 400 }
      );
    }

    // Check file size (max 25MB)
    const MAX_SIZE = 25 * 1024 * 1024;
    if (file.size > MAX_SIZE) {
      return NextResponse.json(
        { ok: false, error: "Audio file is too large (max 25MB)" },
        { status: 413 }
      );
    }

    // If file is too small to contain valid audio frames (e.g. quick click < 500 bytes)
    if (file.size < 500) {
      return NextResponse.json(
        { ok: true, text: "", noSpeech: true },
        { status: 200 }
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const base64Audio = buffer.toString("base64");

    // Extract or infer mimeType
    let mimeType = file.type || "audio/webm";
    if (mimeType === "audio/x-m4a") mimeType = "audio/mp4";
    if (!mimeType.startsWith("audio/")) {
      mimeType = "audio/webm";
    }

    console.log(`[STT] Processing audio file: ${file.name || "audio"}, size: ${file.size} bytes, mimeType: ${mimeType}, languageHint: ${languageHint}`);

    const prompt = `Transcribe the spoken audio verbatim in the original language spoken (e.g. English, Amharic, or Arabic).
Rules:
- Output ONLY the verbatim transcription of what was spoken.
- Preserve the original spoken language (do not translate).
- Do NOT add quotation marks, commentary, preamble, markdown formatting, timestamps, or disclaimers.
- If the audio is silent, contains only unintelligible background noise, or has no discernible speech, output exactly: [NO_SPEECH]`;

    const contents = [
      {
        role: "user",
        parts: [
          {
            inlineData: {
              data: base64Audio,
              mimeType,
            },
          },
          {
            text: prompt,
          },
        ],
      },
    ];

    const startTime = Date.now();
    const res = await generateWithModelFallback(contents, {
      systemInstruction: "You are an expert audio transcriber. You transcribe spoken audio accurately and verbatim without adding commentary.",
      generationConfig: {
        temperature: 0.0,
      },
    });

    const elapsed = Date.now() - startTime;
    let rawText = res.text().trim();

    // Clean up text
    if (rawText.startsWith('"') && rawText.endsWith('"') && rawText.length > 1) {
      rawText = rawText.slice(1, -1).trim();
    }
    if (rawText.startsWith("```") && rawText.endsWith("```")) {
      rawText = rawText.replace(/^```[a-zA-Z]*\n?/, "").replace(/\n?```$/, "").trim();
    }

    console.log(`[STT] Transcription completed in ${elapsed}ms: "${rawText.slice(0, 80)}"`);

    if (rawText === "[NO_SPEECH]" || !rawText) {
      return NextResponse.json({
        ok: true,
        text: "",
        noSpeech: true,
      });
    }

    return NextResponse.json({
      ok: true,
      text: rawText,
      noSpeech: false,
    });
  } catch (err: any) {
    console.error("[STT] Error processing audio transcription:", err);
    const msg = err?.message || "";
    let friendlyError = "Failed to transcribe audio. Please try again.";
    let status = 500;

    if (msg.includes("INVALID_ARGUMENT") || msg.includes("invalid argument")) {
      friendlyError = "Audio recording was empty or could not be decoded. Please speak clearly and try again.";
      status = 400;
    } else if (msg.includes("429") || msg.includes("RESOURCE_EXHAUSTED")) {
      friendlyError = "Speech service is temporarily busy. Please wait a moment and try again.";
      status = 429;
    }

    return NextResponse.json(
      {
        ok: false,
        error: friendlyError,
      },
      { status }
    );
  }
}
