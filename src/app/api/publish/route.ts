import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { type, id, published, title, description, category, tags } = body;

    if (!id || !type) {
      return NextResponse.json({ error: "Missing required fields (id, type)" }, { status: 400 });
    }

    if (type === "job") {
      // 1. Fetch the fine-tuning job
      const { data: job, error: fetchErr } = await supabase
        .from("jobs")
        .select("*")
        .eq("id", id)
        .eq("user_id", user.id)
        .single();

      if (fetchErr || !job) {
        return NextResponse.json({ error: "Job not found or access denied" }, { status: 404 });
      }

      const currentConfig = (typeof job.config === "object" && job.config !== null && !Array.isArray(job.config))
        ? (job.config as Record<string, unknown>)
        : {};
      const updatedConfig = {
        ...currentConfig,
        published: Boolean(published),
        public_title: title?.trim() || job.name,
        public_description: description?.trim() || "",
        category: category || "General",
        tags: Array.isArray(tags) ? tags : [],
        published_at: published ? ((currentConfig.published_at as string) || new Date().toISOString()) : null,
      };

      const { data: updatedJob, error: updateErr } = await supabase
        .from("jobs")
        .update({ config: updatedConfig })
        .eq("id", id)
        .select()
        .single();

      if (updateErr) {
        return NextResponse.json({ error: updateErr.message }, { status: 500 });
      }

      return NextResponse.json({ ok: true, item: updatedJob, isPublished: Boolean(published) });
    } else if (type === "expert") {
      // 2. Fetch the smart assistant / expert
      const { data: expert, error: fetchErr } = await supabase
        .from("experts")
        .select("*")
        .eq("id", id)
        .eq("user_id", user.id)
        .single();

      if (fetchErr || !expert) {
        return NextResponse.json({ error: "Assistant not found or access denied" }, { status: 404 });
      }

      // Build description with embedded category/tags metadata
      // Strip any existing metadata tags first to avoid duplicates
      let cleanDesc = (description?.trim() || expert.description || "")
        .replace(/\[Category:\s*[^\]]+\]/gi, "")
        .replace(/\[Tags:\s*[^\]]+\]/gi, "")
        .trim();

      // Append metadata tags (parsed by the community API for filtering)
      if (category) {
        cleanDesc += ` [Category: ${category}]`;
      }
      if (Array.isArray(tags) && tags.length > 0) {
        cleanDesc += ` [Tags: ${tags.join(", ")}]`;
      }

      const { data: updatedExpert, error: updateErr } = await supabase
        .from("experts")
        .update({
          is_published: Boolean(published),
          name: title?.trim() || expert.name,
          description: cleanDesc,
        })
        .eq("id", id)
        .select()
        .single();

      if (updateErr) {
        return NextResponse.json({ error: updateErr.message }, { status: 500 });
      }

      return NextResponse.json({ ok: true, item: updatedExpert, isPublished: Boolean(published) });
    } else {
      return NextResponse.json({ error: "Invalid type. Must be 'job' or 'expert'." }, { status: 400 });
    }
  } catch (err: unknown) {
    console.error("[Publish API Error]:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Internal error" }, { status: 500 });
  }
}
