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
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

// ── Idempotency ──────────────────────────────────────────────────────────────

const EVENT_TTL = 7 * 24 * 60 * 60; // 7 days in seconds

/**
 * Atomically claim an event for processing using SET NX (set-if-not-exists).
 * Returns true if we successfully claimed it (we should process it).
 * Returns false if another handler already claimed it (skip processing).
 *
 * This eliminates the race window that existed with separate
 * isProcessed() + markProcessed() calls — SET NX is atomic in Redis.
 */
async function claimEvent(eventId: string): Promise<boolean> {
  // SET key value NX EX ttl — only sets if key does NOT exist
  const result = await redis.set(`polar:event:${eventId}`, "1", { nx: true, ex: EVENT_TTL });
  // Returns "OK" if set succeeded (we claimed it), null if key already existed
  return result === "OK";
}

// ── Atomic credit grant via Supabase RPC ─────────────────────────────────────

async function grantCredits(
  userId: string,
  amount: number,
  type: string,
  label: string,
  referenceId?: string,
) {
  const { error } = await supabase.rpc("grant_credits", {
    p_user_id: userId,
    p_amount: amount,
    p_type: type,
    p_label: label,
    p_reference_id: referenceId ?? null,
  });

  if (error) {
    console.error("[webhook] grant_credits RPC failed:", error);
    throw new Error(`grant_credits failed: ${error.message}`);
  }
}

async function updateUserPlan(userId: string, plan: string) {
  const { error } = await supabase
    .from("profiles")
    .update({ plan })
    .eq("id", userId);

  if (error) {
    console.error("[webhook] updateUserPlan failed:", error);
  }
}

// ── Resolve Supabase user ID from metadata ───────────────────────────────────

function getUserId(metadata: Record<string, unknown> | null | undefined): string | null {
  if (!metadata) return null;
  const id = metadata.supabase_user_id;
  return typeof id === "string" ? id : null;
}

// ── Webhook handler using named event handlers for proper TypeScript typing ──

export const POST = Webhooks({
  webhookSecret: process.env.POLAR_WEBHOOK_SECRET!,

  // ── Order paid — this is where credits are actually granted ──
  onOrderPaid: async (payload) => {
    const order = payload.data;
    const eventId = order.id;

    if (!(await claimEvent(eventId))) {
      console.log(`[webhook] Skipping already-claimed order.paid: ${eventId}`);
      return;
    }

    const userId = getUserId(order.metadata as Record<string, unknown> | null);
    if (!userId) {
      console.error("[webhook] order.paid missing supabase_user_id in metadata");
      return;
    }

    const billingReason = order.billingReason;
    const productId = order.productId;

    if (!productId) {
      console.error("[webhook] order.paid missing productId");
      return;
    }

    if (billingReason === "subscription_create" || billingReason === "subscription_cycle") {
      // Subscription payment — grant monthly credit allowance
      const planName = PRODUCT_PLAN_MAP[productId];
      const credits = planName ? PLAN_CREDITS[planName] ?? 0 : 0;

      if (credits > 0) {
        const label = billingReason === "subscription_create"
          ? `${planName?.toUpperCase()} plan activated`
          : `${planName?.toUpperCase()} monthly renewal`;

        await grantCredits(userId, credits, "purchase", label, order.id);

        if (planName) {
          await updateUserPlan(userId, planName);
        }
      }
    } else if (billingReason === "purchase") {
      // One-off top-up purchase
      const credits = TOPUP_CREDITS[productId] ?? 0;

      if (credits > 0) {
        await grantCredits(
          userId,
          credits,
          "purchase",
          `Credit top-up (${credits} credits)`,
          order.id,
        );
      }
    }

  },

  // ── Subscription active — update plan field ──
  onSubscriptionActive: async (payload) => {
    const sub = payload.data;
    const eventId = sub.id;

    if (!(await claimEvent(eventId))) return;

    const userId = getUserId(sub.metadata as Record<string, unknown> | null);
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

    const userId = getUserId(sub.metadata as Record<string, unknown> | null);
    console.log(`[webhook] Subscription canceled for user ${userId ?? "unknown"}. Credits preserved.`);

  },

  // ── Subscription revoked — downgrade to free ──
  onSubscriptionRevoked: async (payload) => {
    const sub = payload.data;
    const eventId = `revoked:${sub.id}`;

    if (!(await claimEvent(eventId))) return;

    const userId = getUserId(sub.metadata as Record<string, unknown> | null);
    if (userId) {
      await updateUserPlan(userId, "free");
      console.log(`[webhook] Subscription revoked for user ${userId}. Plan set to free.`);
    }

  },
});
