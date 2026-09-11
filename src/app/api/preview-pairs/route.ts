import { NextResponse } from "next/server";
import { bootstrapTranscribe, segmentAudio } from "@/lib/dataset-pipeline";
import type { ASRDatasetPair } from "@/lib/qps-types";

// Generate preview pairs using bootstrap transcription
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const audioUrl = body.audioUrl;
    const audioR2Key = body.audioR2Key;
    const modelCheckpoint = body.modelCheckpoint;

    if (!audioUrl || !audioR2Key) {
      return NextResponse.json({ error: "Missing audioUrl or audioR2Key" }, { status: 400 });
    }

    // 1. Get just a few clips via VAD
    const segmentResult = await segmentAudio(audioR2Key, audioUrl);
    // Take only first 3 for preview
    const previewClips = segmentResult.clips.slice(0, 3);

    // 2. Bootstrap transcribe them
    const transcriptions = await bootstrapTranscribe(previewClips, modelCheckpoint);

    // 3. Format as ASRDatasetPair
    const pairs: ASRDatasetPair[] = previewClips.map((clip) => {
      const trans = transcriptions.find((t) => t.clipId === clip.id);
      return {
        audioClipId: clip.id,
        audioR2Key: clip.r2Key,
        phonemeLabels: trans?.labels || [],
        qpsSequence: trans?.qpsSequence || "",
        isDeliberateError: false,
      };
    });

    return NextResponse.json({ pairs });
  } catch (err: any) {
    console.error("[Preview API] Error:", err);
    return NextResponse.json({ error: err.message || "Unknown error" }, { status: 500 });
  }
}
