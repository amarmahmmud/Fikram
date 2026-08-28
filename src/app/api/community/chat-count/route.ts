import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { targetId, targetType } = body;

    if (!targetId || !targetType || !["expert", "job"].includes(targetType)) {
      return NextResponse.json({ error: "Invalid request data" }, { status: 400 });
    }

    // Use the admin client + SECURITY DEFINER RPC so the counter update
    // works even when the model belongs to a different user.
    const admin = createAdminClient();
    const rpcName = targetType === "expert" ? "increment_expert_chats" : "increment_job_chats";
    const rpcArg = targetType === "expert" ? { expert_id: targetId } : { job_id: targetId };

    const { data: newCount, error } = await admin.rpc(rpcName, rpcArg);

    if (error) {
      console.error("[ChatCount API] RPC increment error:", error);
      return NextResponse.json({ error: "Failed to increment chat count" }, { status: 500 });
    }

    return NextResponse.json({ ok: true, chats_count: newCount ?? null });
  } catch (err: unknown) {
    console.error("[Community ChatCount API Error]:", err);
    return NextResponse.json({ error: "Failed to increment chat count" }, { status: 500 });
  }
}
