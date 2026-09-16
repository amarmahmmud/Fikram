// ─────────────────────────────────────────────
// POST /api/webhooks/polar
// ─────────────────────────────────────────────
// Handles Polar webhook events with:
// 1. Signature verification (via @polar-sh/nextjs Webhooks helper)
// 2. Redis-backed idempotency (prevents double-processing)
// 3. Atomic credit mutations (Supabase RPC — no read-then-write races)

import { Webhooks } from "@polar-sh/nextjs";
import { redis } from "@/lib/redis";
import { PLAN_CREDITS, PRODUCT_PLAN_MAP, TOPUP_CREDITS } from "@/lib/polar";
import { createClient } from "@supabase/supabase-js";

// Use service role for webhook — no user session available
// Lazy-init to avoid crashing at build time (env vars aren't available during Next.js build)
let _supabase: ReturnType<typeof createClient> | null = null;
function getSupabase() {
  if (!_supabase) {
    _supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
  }
  return _supabase;
}

// ── Idempotency ──────────────────────────────────────────────────────────────

const EVENT_TTL = 7 * 24 * 60 * 60; // 7 days in seconds

/**
 * Atomically claim an event for processing using SET NX (set-if-not-exists).
 * Returns true if we successfully claimed it (we should process it).
 * Returns false if another handler already claimed it (skip processing).
 *
 * If Redis is not provisioned or fails, safely falls back to true
 * so Supabase's credit_transactions_reference_id_unique constraint handles idempotency.
 */
async function claimEvent(eventId: string): Promise<boolean> {
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    return true;
  }
  try {
    const result = await redis.set(`polar:event:${eventId}`, "1", { nx: true, ex: EVENT_TTL });
    return result === "OK";
  } catch (err) {
    console.warn("[webhook] Redis claimEvent failed, relying on Supabase unique constraint:", err);
    return true;
  }
}

// ── Atomic credit grant via Supabase RPC ─────────────────────────────────────

function toUuidOrUndefined(val: string | null | undefined): string | undefined {
  if (!val) return undefined;
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val);
  return isUuid ? val : undefined;
}

async function grantCredits(
  userId: string,
  amount: number,
  type: string,
  label: string,
  referenceId?: string,
) {
  const safeReferenceId = toUuidOrUndefined(referenceId);
  const { error } = await (getSupabase().rpc as any)("grant_credits", {
    p_user_id: userId,
    p_amount: amount,
    p_type: type,
    p_label: label,
    p_reference_id: safeReferenceId ?? null,
  });

  if (error) {
    // If unique constraint was violated, it's a duplicate delivery that already succeeded
    if (error.code === "23505" || error.message?.includes("unique")) {
      console.log(`[webhook] Duplicate event ${referenceId} ignored by database unique constraint.`);
      return;
    }
    console.error("[webhook] grant_credits RPC failed:", error);
    throw new Error(`grant_credits failed: ${error.message}`);
  }
}

async function updateUserPlan(userId: string, plan: string) {
  const { error } = await (getSupabase() as any)
    .from("profiles")
    .update({ plan })
    .eq("id", userId);

  if (error) {
    console.error("[webhook] updateUserPlan failed:", error);
  }
}

// ── Resolve Supabase user ID with multi-level fallback ───────────────────────

async function resolveUserId(data: any): Promise<string | null> {
  if (!data) return null;

  // 1. Explicit metadata on the order / subscription
  if (data.metadata?.supabase_user_id && typeof data.metadata.supabase_user_id === "string") {
    return data.metadata.supabase_user_id;
  }

  // 2. externalCustomerId on the customer object
  if (data.customer?.externalId && typeof data.customer.externalId === "string") {
    return data.customer.externalId;
  }

  // 3. Fallback: match profile by customer email in Supabase
  const email = data.customer?.email || data.customerEmail;
  if (email && typeof email === "string") {
    const { data: profile } = await (getSupabase() as any)
      .from("profiles")
      .select("id")
      .eq("email", email.trim().toLowerCase())
      .maybeSingle();

    if (profile?.id) return profile.id;
  }

  return null;
}

// ── Webhook handler using named event handlers for proper TypeScript typing ──

export const POST = Webhooks({
  webhookSecret: process.env.POLAR_WEBHOOK_SECRET || "",

  // ── Order paid — this is where credits are actually granted ──
  onOrderPaid: async (payload) => {
    const order = payload.data;
    const eventId = order.id;

    if (!(await claimEvent(eventId))) {
      console.log(`[webhook] Skipping already-claimed order.paid: ${eventId}`);
      return;
    }

    const userId = await resolveUserId(order);
    if (!userId) {
      console.error("[webhook] order.paid missing user identification", { orderId: order.id, customer: order.customer });
      return;
    }

    const billingReason = order.billingReason;
    const productId = order.productId;

    if (!productId) {
      console.error("[webhook] order.paid missing productId");
      return;
    }

    const planName = PRODUCT_PLAN_MAP[productId];
    const topupCredits = TOPUP_CREDITS[productId];

    if (planName) {
      // Subscription payment — grant monthly credit allowance
      const credits = PLAN_CREDITS[planName] ?? 0;

      if (credits > 0) {
        const label = billingReason === "subscription_create"
          ? `${planName.toUpperCase()} plan activated`
          : billingReason === "subscription_update"
          ? `${planName.toUpperCase()} plan upgraded`
          : `${planName.toUpperCase()} monthly renewal`;

        await grantCredits(userId, credits, "purchase", label, order.id);
        await updateUserPlan(userId, planName);
      }
    } else if (topupCredits) {
      // One-off top-up purchase
      await grantCredits(
        userId,
        topupCredits,
        "purchase",
        `Credit top-up (${topupCredits} credits)`,
        order.id,
      );
    } else {
      console.warn(`[webhook] Unknown product ID received in order.paid: ${productId}`);
    }
  },

  // ── Subscription active — update plan field ──
  onSubscriptionActive: async (payload) => {
    const sub = payload.data;
    const eventId = sub.id;

    if (!(await claimEvent(eventId))) return;

    const userId = await resolveUserId(sub);
    if (!userId) return;

    const planName = PRODUCT_PLAN_MAP[sub.productId];
    if (planName) {
      await updateUserPlan(userId, planName);
    }
  },

  // ── Subscription updated — update plan field when customer upgrades/downgrades ──
  onSubscriptionUpdated: async (payload) => {
    const sub = payload.data;
    const eventId = `updated:${sub.id}:${sub.modifiedAt || Date.now()}`;

    if (!(await claimEvent(eventId))) return;

    const userId = await resolveUserId(sub);
    if (!userId) return;

    const planName = PRODUCT_PLAN_MAP[sub.productId];
    if (planName) {
      await updateUserPlan(userId, planName);
    }
  },

  // ── Subscription canceled — note it, keep existing credits ──
  onSubscriptionCanceled: async (payload) => {
    const sub = payload.data;
    const eventId = `canceled:${sub.id}`;

    if (!(await claimEvent(eventId))) return;

    const userId = await resolveUserId(sub);
    console.log(`[webhook] Subscription canceled for user ${userId ?? "unknown"}. Credits preserved.`);
  },

  // ── Subscription revoked — downgrade to free ──
  onSubscriptionRevoked: async (payload) => {
    const sub = payload.data;
    const eventId = `revoked:${sub.id}`;

    if (!(await claimEvent(eventId))) return;

    const userId = await resolveUserId(sub);
    if (userId) {
      await updateUserPlan(userId, "free");
      console.log(`[webhook] Subscription revoked for user ${userId}. Plan set to free.`);
    }
  },
});
