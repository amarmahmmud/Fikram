import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { targetId, targetType } = body;

    if (!targetId || !targetType || !["expert", "job"].includes(targetType)) {
      return NextResponse.json({ error: "Invalid request data" }, { status: 400 });
    }

    const rpcName = targetType === "expert" ? "increment_expert_chats" : "increment_job_chats";
    const rpcArg = targetType === "expert" ? { expert_id: targetId } : { job_id: targetId };

    // Try admin client first (bypasses RLS); fallback to standard client with RPC
    let newCount: number | null = null;

    if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
      try {
        const admin = createAdminClient();
        const { data, error } = await admin.rpc(rpcName, rpcArg);
        if (!error && data !== null) {
          newCount = data;
        }
      } catch (adminErr) {
        console.warn("[ChatCount API] Admin RPC attempt failed, falling back to server client:", adminErr);
      }
    }

    if (newCount === null) {
      try {
        const supabase = await createClient();
        const { data } = await supabase.rpc(rpcName, rpcArg);
        if (data !== null) {
          newCount = data;
        }
      } catch {
        // Soft fail for analytics
      }
    }

    return NextResponse.json({ ok: true, chats_count: newCount });
  } catch (err: unknown) {
    console.error("[Community ChatCount API Error]:", err);
    // Don't throw 500 for a background counter
    return NextResponse.json({ ok: true, chats_count: null });
  }
}
