// ─────────────────────────────────────────────
// RAG Credit System — Two-Tier Architecture
// ─────────────────────────────────────────────
// Free users  → Free Gemini API keys + Groq free tier = $0 cost
// Paid users  → Vertex AI Enterprise + Groq = premium, reliable, covered by their payment
//
// Credits serve different purposes per tier:
// - Free tier:  usage cap to prevent abuse (platform cost = $0)
// - Paid tier:  payment unit that covers API cost + profit margin

import { createClient } from "@/lib/supabase/server";

// ── User Tier Detection ──────────────────────────────────────────────────────

export type UserTier = "free" | "paid";

/**
 * Determine if a user is on the free or paid tier.
 * Paid = has an active subscription plan (pro/enterprise) or any purchase transaction.
 * Free = everyone else (including the 50 signup credits).
 */
export async function getUserTier(userId: string): Promise<{ tier: UserTier; plan: string }> {
  const supabase = await createClient();

  const { data: profile } = await supabase
    .from("profiles")
    .select("plan")
    .eq("id", userId)
    .single();

  const plan = (profile as any)?.plan || "free";

  // Any plan other than "free" is a paid user
  if (plan !== "free") {
    return { tier: "paid", plan };
  }

  return { tier: "free", plan: "free" };
}

/**
 * Quick check: should this user's API calls ALWAYS go through Vertex AI?
 * Returns true only for paid-tier users. Free users may still be routed
 * to Vertex AI via the AI Gateway's fallback logic, but only when free
 * providers fail and the monthly budget allows it.
 */
export function shouldAlwaysUseEnterprise(tier: UserTier): boolean {
  return tier === "paid";
}

// ── Credit Cost Table ────────────────────────────────────────────────────────

/** Credit costs for each RAG action */
export const RAG_CREDIT_COSTS = {
  // Document ingestion
  ingest_text: 1,      // text/PDF upload
  ingest_image: 1,     // image upload (Gemini describes → embed)
  ingest_audio: 5,     // audio upload (Gemini transcribes → embed)
  ingest_video: 10,    // video upload (Gemini describes → embed)

  // Chat messages
  chat_text: 1,        // text-only chat (Groq, essentially free but gates abuse)
  chat_with_image: 2,  // chat with image attachment
  chat_with_audio: 5,  // chat with audio attachment
  chat_with_video: 5,  // chat with video attachment
} as const;

export type RagAction = keyof typeof RAG_CREDIT_COSTS;

/**
 * Determine the credit cost for a document ingest based on media type.
 */
export function getIngestCreditCost(mimeType: string, isMedia: boolean): { cost: number; action: RagAction } {
  if (!isMedia) {
    return { cost: RAG_CREDIT_COSTS.ingest_text, action: "ingest_text" };
  }
  if (mimeType.startsWith("video/")) {
    return { cost: RAG_CREDIT_COSTS.ingest_video, action: "ingest_video" };
  }
  if (mimeType.startsWith("audio/")) {
    return { cost: RAG_CREDIT_COSTS.ingest_audio, action: "ingest_audio" };
  }
  return { cost: RAG_CREDIT_COSTS.ingest_image, action: "ingest_image" };
}

/**
 * Determine the credit cost for a chat message based on attachments.
 */
export function getChatCreditCost(hasMedia: boolean, mimeType?: string): { cost: number; action: RagAction } {
  if (!hasMedia || !mimeType) {
    return { cost: RAG_CREDIT_COSTS.chat_text, action: "chat_text" };
  }
  if (mimeType.startsWith("video/")) {
    return { cost: RAG_CREDIT_COSTS.chat_with_video, action: "chat_with_video" };
  }
  if (mimeType.startsWith("audio/")) {
    return { cost: RAG_CREDIT_COSTS.chat_with_audio, action: "chat_with_audio" };
  }
  return { cost: RAG_CREDIT_COSTS.chat_with_image, action: "chat_with_image" };
}

// ── Balance Check ────────────────────────────────────────────────────────────

/**
 * Check if a user has enough credits for an action.
 * Returns the current available balance and whether the action is allowed.
 */
export async function checkCreditBalance(
  userId: string,
  requiredCredits: number,
): Promise<{ allowed: boolean; balance: number }> {
  const supabase = await createClient();

  const { data: profile } = await supabase
    .from("profiles")
    .select("credits_balance, credits_held")
    .eq("id", userId)
    .single();

  if (!profile) {
    return { allowed: false, balance: 0 };
  }

  const available = profile.credits_balance - (profile.credits_held ?? 0);
  return {
    allowed: available >= requiredCredits,
    balance: available,
  };
}

// ── Credit Deduction ─────────────────────────────────────────────────────────

/**
 * Atomically deduct credits from a user's balance and log the transaction.
 * Uses the existing grant_credits RPC with a negative amount.
 *
 * @returns true if deduction succeeded, false if insufficient balance or error
 */
export async function deductCredits(
  userId: string,
  amount: number,
  action: RagAction,
  label: string,
  referenceId?: string,
): Promise<{ success: boolean; error?: string }> {
  if (amount <= 0) return { success: true };

  try {
    const supabase = await createClient();

    const { allowed } = await checkCreditBalance(userId, amount);
    if (!allowed) {
      return { success: false, error: "Insufficient credits" };
    }

    // Use grant_credits with negative amount for atomic deduction
    // Type assertion: grant_credits is a manually-created RPC not in auto-generated types
    const { error } = await (supabase.rpc as any)("grant_credits", {
      p_user_id: userId,
      p_amount: -amount,
      p_type: action,
      p_label: label,
      p_reference_id: referenceId || null,
    });

    if (error) {
      console.error(`[Credits] Failed to deduct ${amount} credits for ${action}:`, error);
      return { success: false, error: `RPC grant_credits failed: ${error.message || JSON.stringify(error)}` };
    }

    console.log(`[Credits] Deducted ${amount} credits from user ${userId} for ${action}: ${label}`);
    return { success: true };
  } catch (err: any) {
    console.error(`[Credits] Exception in deductCredits:`, err);
    return { success: false, error: `Credits exception: ${err.message}` };
  }
}
