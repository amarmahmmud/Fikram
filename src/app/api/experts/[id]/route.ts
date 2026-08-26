import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// DELETE /api/experts/[id] — delete an expert owned by the authenticated user
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Fetch the expert and verify ownership
  const { data: expert, error: fetchErr } = await supabase
    .from("experts")
    .select("id, user_id")
    .eq("id", id)
    .single();

  if (fetchErr || !expert) {
    return NextResponse.json({ error: "Expert not found" }, { status: 404 });
  }

  if (expert.user_id !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Delete the expert
  const { error: deleteErr } = await supabase
    .from("experts")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);

  if (deleteErr) {
    console.error("[Experts API] Delete error:", deleteErr);
    return NextResponse.json({ error: deleteErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
