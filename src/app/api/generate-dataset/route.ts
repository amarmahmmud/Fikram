import { generateDataset } from "@/lib/dataset-pipeline";
import { WizardContext } from "@/lib/wizard-types";
import type { PipelineProgress } from "@/lib/dataset-pipeline";

/**
 * SSE streaming endpoint for dataset generation.
 *
 * Streams PipelineProgress events in real-time so the frontend can show
 * chunk-by-chunk progress, then sends the final result as a "complete" event.
 *
 * Event format:
 *   data: {"type":"progress","stage":"generating","message":"...","chunksTotal":13,"chunksProcessed":7,"pairsGenerated":365}
 *   data: {"type":"complete","ok":true,"jsonl":"...","stats":{...},"systemPrompt":"..."}
 *   data: {"type":"error","error":"..."}
 */
export async function POST(req: Request) {
  let body: { text?: string; goal?: string; wizardContext?: WizardContext };

  try {
    body = await req.json();
  } catch {
    return new Response(
      JSON.stringify({ error: "Invalid request body" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const { text, goal, wizardContext } = body;

  if (!text) {
    return new Response(
      JSON.stringify({ error: "No text provided" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      function sendEvent(data: Record<string, unknown>) {
        const payload = `data: ${JSON.stringify(data)}\n\n`;
        try {
          controller.enqueue(encoder.encode(payload));
        } catch {
          // Stream may have been closed by the client
        }
      }

      // Progress callback — fires for every pipeline stage transition
      const onProgress = (progress: PipelineProgress) => {
        sendEvent({
          type: "progress",
          stage: progress.stage,
          message: progress.message,
          chunksTotal: progress.chunksTotal,
          chunksProcessed: progress.chunksProcessed,
          pairsGenerated: progress.pairsGenerated,
        });
      };

      try {
        const { jsonl, stats, systemPrompt } = await generateDataset(
          text,
          goal || wizardContext?.goal || "",
          onProgress,
          wizardContext
        );

        if (stats.afterDedup === 0) {
          sendEvent({
            type: "error",
            error: "Failed to generate any valid Q&A pairs from the document. Try a different file.",
          });
        } else {
          sendEvent({
            type: "complete",
            ok: true,
            jsonl,
            stats,
            systemPrompt,
          });
        }
      } catch (error: any) {
        console.error("Dataset Generation Error:", error?.message ?? error);
        sendEvent({
          type: "error",
          error: "Failed to generate dataset: " + (error?.message ?? "Unknown error"),
        });
      } finally {
        try {
          controller.close();
        } catch {
          // Already closed
        }
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no", // Disable buffering in nginx proxies
    },
  });
}
