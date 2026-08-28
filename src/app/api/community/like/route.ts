import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const { targetId, targetType } = body;

    if (!targetId || !targetType || !["expert", "job"].includes(targetType)) {
      return NextResponse.json({ error: "Invalid request data" }, { status: 400 });
    }

    // 1. Record the like in user_likes (enforces uniqueness via DB constraint)
    const { error: likeError } = await supabase
      .from("user_likes")
      .insert({
        user_id: user.id,
        target_id: targetId,
        target_type: targetType as "expert" | "job",
      });

    if (likeError) {
      // Unique constraint violation = user already liked this
      if (likeError.code === "23505") {
        return NextResponse.json({ error: "Already liked" }, { status: 409 });
      }
      throw likeError;
    }

    // 2. Atomically increment the counter using a SECURITY DEFINER function
    //    so RLS doesn't block updating another user's row.
    const admin = createAdminClient();
    const rpcName = targetType === "expert" ? "increment_expert_likes" : "increment_job_likes";
    const rpcArg = targetType === "expert" ? { expert_id: targetId } : { job_id: targetId };

    const { data: newCount, error: rpcError } = await admin.rpc(rpcName, rpcArg);
    if (rpcError) {
      console.error("[Like API] RPC increment error:", rpcError);
      // Don't fail the request — the like was recorded, count update is cosmetic
    }

    return NextResponse.json({ ok: true, likes_count: newCount ?? null });
  } catch (err: unknown) {
    console.error("[Community Like API Error]:", err);
    return NextResponse.json({ error: "Failed to process like" }, { status: 500 });
  }
}
