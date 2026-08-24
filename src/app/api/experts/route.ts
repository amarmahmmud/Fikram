import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

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

  const body = await req.json();
  const { name, description, systemPrompt } = body;

  if (!name?.trim()) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }

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
      description: description?.trim() || null,
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
