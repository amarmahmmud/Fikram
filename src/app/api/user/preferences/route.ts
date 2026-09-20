import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (!user || authError) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("user_preferences")
    .select("voice_enabled")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    console.error("Error fetching user preferences:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    voice_enabled: data?.voice_enabled ?? true,
  });
}

export async function PATCH(req: Request) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (!user || authError) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { voice_enabled } = body;
  if (typeof voice_enabled !== "boolean") {
    return NextResponse.json(
      { error: "voice_enabled must be a boolean" },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from("user_preferences")
    .upsert(
      {
        user_id: user.id,
        voice_enabled,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" }
    )
    .select("voice_enabled, updated_at")
    .single();

  if (error) {
    console.error("Error updating user preferences:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    voice_enabled: data?.voice_enabled ?? voice_enabled,
  });
}
