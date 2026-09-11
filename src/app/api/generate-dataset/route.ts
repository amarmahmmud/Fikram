import { NextRequest } from "next/server";
import { generateASRDataset } from "@/lib/dataset-pipeline";
import { ASRWizardContext } from "@/lib/asr-wizard-types";

export async function POST(req: NextRequest) {
  const encoder = new TextEncoder();
  const stream = new TransformStream();
  const writer = stream.writable.getWriter();

  const writeEvent = async (data: any) => {
    try {
      await writer.write(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
    } catch (err) {
      console.error("[SSE] Error writing event:", err);
    }
  };

  (async () => {
    try {
      const body = await req.json();
      const audioUrl = body.audioUrl;
      const audioR2Key = body.audioR2Key;
      const wizardContext: ASRWizardContext = body.wizardContext;

      if (!audioUrl || !audioR2Key) {
        throw new Error("Missing audioUrl or audioR2Key in request body");
      }

      const result = await generateASRDataset(
        audioR2Key,
        audioUrl,
        (progress) => {
          writeEvent({ type: "progress", ...progress });
        },
        wizardContext
      );

      await writeEvent({
        type: "complete",
        ok: true,
        pairs: result.pairs,
        trainPairs: result.trainPairs,
        evalPairs: result.evalPairs,
        stats: result.stats,
        lowConfidenceClips: result.lowConfidenceClips,
      });

    } catch (err: any) {
      console.error("[Generate Dataset] Fatal Error:", err);
      await writeEvent({ type: "error", message: err.message });
    } finally {
      await writer.close();
    }
  })();

  return new Response(stream.readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
