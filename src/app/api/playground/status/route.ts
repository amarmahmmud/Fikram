import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import Replicate from "replicate";

const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN! });

export async function GET(req: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const url = new URL(req.url);
    const predictionId = url.searchParams.get("id");
    if (!predictionId) return NextResponse.json({ error: "Missing prediction id" }, { status: 400 });

    const prediction = await replicate.predictions.get(predictionId);
    
    if (prediction.status === "succeeded") {
      // Replicate Llama models usually return an array of strings
      const outputStr = Array.isArray(prediction.output) ? prediction.output.join("") : prediction.output;
      return NextResponse.json({ status: "succeeded", reply: outputStr });
    } else if (prediction.status === "failed" || prediction.status === "canceled") {
      return NextResponse.json({ status: "failed", error: prediction.error });
    } else {
      return NextResponse.json({ status: prediction.status }); // starting, processing
    }
  } catch (err: any) {
    console.error("Playground Status API error:", err);
    return NextResponse.json({ error: "Failed to check status" }, { status: 500 });
  }
}
