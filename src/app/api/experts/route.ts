import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { formatExpertDescription, ReasoningMode } from "@/lib/expert-metadata";
import { z } from "zod";

const createExpertSchema = z.object({
  name: z.string().min(1, "Name is required").max(100, "Name is too long"),
  description: z.string().max(1000, "Description is too long").optional(),
  systemPrompt: z.string().max(5000, "System prompt is too long").optional(),
  reasoningMode: z.string().optional(),
  webSearchEnabled: z.boolean().optional(),
  category: z.string().max(50).optional(),
  tags: z.array(z.string().max(30)).max(10).optional(),
});

// GET /api/experts — list user's experts
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: experts, error } = await supabase
    .from("experts")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, experts: experts ?? [] });
}

// POST /api/experts — create a new expert
export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let parsedBody;
  try {
    const json = await req.json();
    parsedBody = createExpertSchema.parse(json);
  } catch (error: any) {
    return NextResponse.json({ error: error.errors?.[0]?.message || "Invalid input" }, { status: 400 });
  }

  const { name, description, systemPrompt, reasoningMode, webSearchEnabled, category, tags } = parsedBody;

  const finalDescription = formatExpertDescription(description?.trim() || "", {
    category,
    tags,
    reasoningMode: reasoningMode as ReasoningMode,
    webSearchEnabled: Boolean(webSearchEnabled),
  });

  // Generate a URL-friendly slug from the name
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .substring(0, 50)
    + "-" + Date.now().toString(36);

  const { data: expert, error } = await supabase
    .from("experts")
    .insert({
      user_id: user.id,
      name: name.trim(),
      slug,
      description: finalDescription || null,
      system_prompt: systemPrompt?.trim() || `You are ${name.trim()}, a knowledgeable expert. Answer questions based on your expertise.`,
    })
    .select()
    .single();

  if (error) {
    console.error("[Experts API] Create error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, expert });
}
