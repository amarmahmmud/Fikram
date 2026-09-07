import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { error: "Please log in to like this model", unauthorized: true },
        { status: 401 }
      );
    }

    const body = await req.json();
    const { targetId, targetType, action } = body;

    if (!targetId || !targetType || !["expert", "job"].includes(targetType)) {
      return NextResponse.json({ error: "Invalid request data" }, { status: 400 });
    }

    const admin = createAdminClient();
    const table = targetType === "expert" ? "experts" : "jobs";

    // 1. Check existing like status in DB
    const { data: existingLike } = await supabase
      .from("user_likes")
      .select("id")
      .eq("user_id", user.id)
      .eq("target_id", targetId)
      .eq("target_type", targetType as "expert" | "job")
      .maybeSingle();

    const isCurrentlyLiked = Boolean(existingLike);

    // 2. Determine target state (toggle, explicit like, or explicit unlike)
    let shouldLike: boolean;
    if (action === "like") {
      shouldLike = true;
    } else if (action === "unlike") {
      shouldLike = false;
    } else {
      // Default: toggle
      shouldLike = !isCurrentlyLiked;
    }

    // 3. Idempotent check: if state already matches requested action, return success immediately
    if (shouldLike === isCurrentlyLiked) {
      const { data: currentItem } = await admin
        .from(table)
        .select("likes_count")
        .eq("id", targetId)
        .maybeSingle();

      return NextResponse.json({
        ok: true,
        liked: isCurrentlyLiked,
        likes_count: currentItem?.likes_count ?? 0,
        idempotent: true,
      });
    }

    if (shouldLike) {
      // Record like (upsert with ignoreDuplicates to guarantee no 23505 conflict crashes)
      const { error: insertErr } = await supabase.from("user_likes").upsert(
        {
          user_id: user.id,
          target_id: targetId,
          target_type: targetType as "expert" | "job",
        },
        { onConflict: "user_id,target_id,target_type", ignoreDuplicates: true }
      );

      if (insertErr && insertErr.code !== "23505") {
        console.error("[Like API] Insert error:", insertErr);
      }

      // Atomically increment counter
      const rpcName = targetType === "expert" ? "increment_expert_likes" : "increment_job_likes";
      const rpcArg = targetType === "expert" ? { expert_id: targetId } : { job_id: targetId };

      const { data: newCount, error: rpcError } = await admin.rpc(rpcName as any, rpcArg);

      let finalCount = newCount;
      if (rpcError || finalCount === null || finalCount === undefined) {
        // Fallback: direct update if RPC is missing
        const { data: cur } = await admin
          .from(table)
          .select("likes_count")
          .eq("id", targetId)
          .single();
        finalCount = (cur?.likes_count ?? 0) + 1;
        await admin.from(table).update({ likes_count: finalCount }).eq("id", targetId);
      }

      return NextResponse.json({
        ok: true,
        liked: true,
        likes_count: finalCount,
      });
    } else {
      // Remove like
      const { error: deleteError } = await supabase
        .from("user_likes")
        .delete()
        .eq("user_id", user.id)
        .eq("target_id", targetId)
        .eq("target_type", targetType as "expert" | "job");

      if (deleteError) {
        console.error("[Like API] Delete error:", deleteError);
      }

      // Atomically decrement counter
      const rpcName = targetType === "expert" ? "decrement_expert_likes" : "decrement_job_likes";
      const rpcArg = targetType === "expert" ? { expert_id: targetId } : { job_id: targetId };

      const { data: newCount, error: rpcError } = await admin.rpc(rpcName as any, rpcArg);

      let finalCount = newCount;
      if (rpcError || finalCount === null || finalCount === undefined) {
        // Fallback: direct update if RPC is missing
        const { data: cur } = await admin
          .from(table)
          .select("likes_count")
          .eq("id", targetId)
          .single();
        finalCount = Math.max(0, (cur?.likes_count ?? 1) - 1);
        await admin.from(table).update({ likes_count: finalCount }).eq("id", targetId);
      }

      return NextResponse.json({
        ok: true,
        liked: false,
        likes_count: finalCount,
      });
    }
  } catch (err: unknown) {
    console.error("[Community Like API Error]:", err);
    return NextResponse.json({ error: "Failed to process like" }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { error: "Please log in to unlike", unauthorized: true },
        { status: 401 }
      );
    }

    let targetId: string | null = null;
    let targetType: string | null = null;

    try {
      const body = await req.json();
      targetId = body?.targetId;
      targetType = body?.targetType;
    } catch {
      // Try search params if body was empty
      const url = new URL(req.url);
      targetId = url.searchParams.get("targetId");
      targetType = url.searchParams.get("targetType");
    }

    if (!targetId || !targetType || !["expert", "job"].includes(targetType)) {
      return NextResponse.json({ error: "Invalid request data" }, { status: 400 });
    }

    // Delegate to unlike logic (idempotent)
    const admin = createAdminClient();
    const table = targetType === "expert" ? "experts" : "jobs";

    await supabase
      .from("user_likes")
      .delete()
      .eq("user_id", user.id)
      .eq("target_id", targetId)
      .eq("target_type", targetType as "expert" | "job");

    const rpcName = targetType === "expert" ? "decrement_expert_likes" : "decrement_job_likes";
    const rpcArg = targetType === "expert" ? { expert_id: targetId } : { job_id: targetId };

    const { data: newCount, error: rpcError } = await admin.rpc(rpcName as any, rpcArg);

    let finalCount = newCount;
    if (rpcError || finalCount === null || finalCount === undefined) {
      const { data: cur } = await admin
        .from(table)
        .select("likes_count")
        .eq("id", targetId)
        .single();
      finalCount = Math.max(0, (cur?.likes_count ?? 1) - 1);
      await admin.from(table).update({ likes_count: finalCount }).eq("id", targetId);
    }

    return NextResponse.json({ ok: true, liked: false, likes_count: finalCount });
  } catch (err: unknown) {
    console.error("[Community Unlike API Error]:", err);
    return NextResponse.json({ error: "Failed to process unlike" }, { status: 500 });
  }
}
