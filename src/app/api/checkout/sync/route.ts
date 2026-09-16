// ─────────────────────────────────────────────
// POST /api/checkout/sync
// ─────────────────────────────────────────────
// Payment Reconciliation Endpoint
// Called automatically when user lands on /credits?checkout=success
// or manually to reconcile pending/delayed webhooks directly with Polar.

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { polar, PLAN_CREDITS, PRODUCT_PLAN_MAP, TOPUP_CREDITS } from "@/lib/polar";
import { createClient as createAdminClient } from "@supabase/supabase-js";

function getAdminSupabase() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

function toUuidOrUndefined(val: string | null | undefined): string | undefined {
  if (!val) return undefined;
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val);
  return isUuid ? val : undefined;
}

export async function POST() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const adminDb = getAdminSupabase();
    const userEmail = (user.email ?? "").trim().toLowerCase();

    // Query Polar for recent orders matching this user
    let ordersList: any[] = [];
    try {
      const res = await polar.orders.list({ limit: 15 });
      ordersList = res.result.items || [];
    } catch (polarErr: any) {
      console.error("[checkout/sync] Error listing Polar orders:", polarErr?.message);
      return NextResponse.json(
        { error: "Could not reach payment provider to verify orders." },
        { status: 502 },
      );
    }

    const userOrders = ordersList.filter((o) => {
      const metaUserId = o.metadata?.supabase_user_id;
      const extId = o.customer?.externalId;
      const custEmail = (o.customer?.email || "").trim().toLowerCase();
      return (
        metaUserId === user.id ||
        extId === user.id ||
        (userEmail && custEmail === userEmail)
      );
    });

    let newlySynced = 0;

    for (const order of userOrders) {
      if (order.status !== "paid") continue;
      const productId = order.productId;
      if (!productId) continue;

      const safeOrderId = toUuidOrUndefined(order.id);
      if (!safeOrderId) continue;

      // Check if this order was already recorded in credit_transactions
      const { data: existingTx } = await adminDb
        .from("credit_transactions")
        .select("id")
        .eq("reference_id", safeOrderId)
        .maybeSingle();

      if (existingTx) {
        // Already processed
        continue;
      }

      const planName = PRODUCT_PLAN_MAP[productId];
      const topupCredits = TOPUP_CREDITS[productId];

      if (planName) {
        const credits = PLAN_CREDITS[planName] ?? 0;
        if (credits > 0) {
          const { error: grantErr } = await (adminDb.rpc as any)("grant_credits", {
            p_user_id: user.id,
            p_amount: credits,
            p_type: "purchase",
            p_label: `${planName.toUpperCase()} plan activated`,
            p_reference_id: safeOrderId,
          });

          if (!grantErr || grantErr.code === "23505") {
            await adminDb.from("profiles").update({ plan: planName }).eq("id", user.id);
            newlySynced++;
          }
        }
      } else if (topupCredits) {
        const { error: grantErr } = await (adminDb.rpc as any)("grant_credits", {
          p_user_id: user.id,
          p_amount: topupCredits,
          p_type: "purchase",
          p_label: `Credit top-up (${topupCredits} credits)`,
          p_reference_id: safeOrderId,
        });

        if (!grantErr || grantErr.code === "23505") {
          newlySynced++;
        }
      }
    }

    // Fetch the updated profile balance and plan
    const { data: profile } = await adminDb
      .from("profiles")
      .select("credits_balance, credits_held, plan")
      .eq("id", user.id)
      .single();

    return NextResponse.json({
      success: true,
      syncedOrders: newlySynced,
      profile: {
        balance: profile?.credits_balance ?? 0,
        held: profile?.credits_held ?? 0,
        plan: profile?.plan ?? "free",
      },
    });
  } catch (err: any) {
    console.error("[checkout/sync] Reconciliation exception:", err);
    return NextResponse.json(
      { error: err?.message || "Internal server error" },
      { status: 500 },
    );
  }
}
