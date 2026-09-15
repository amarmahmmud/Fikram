// ─────────────────────────────────────────────
// RAG Credit System
// ─────────────────────────────────────────────
// Centralized credit management for RAG operations.
// Uses the existing grant_credits RPC (which supports negative amounts)
// to atomically deduct credits and record transactions.

import { createClient } from "@/lib/supabase/server";

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
  chat_with_image: 2,  // chat with image attachment (Vertex AI)
  chat_with_audio: 5,  // chat with audio attachment (Vertex AI)
  chat_with_video: 5,  // chat with video attachment (Vertex AI)
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
  // image or other media
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
  // image
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
): Promise<boolean> {
  if (amount <= 0) return true; // No cost, no deduction needed

  const supabase = await createClient();

  // Double-check balance before deducting (race-safe via RPC)
  const { allowed } = await checkCreditBalance(userId, amount);
  if (!allowed) {
    return false;
  }

  // Use grant_credits with negative amount for atomic deduction
  // Use type assertion since grant_credits is a manually-created RPC
  // not included in the auto-generated Supabase types
  const { error } = await (supabase.rpc as any)("grant_credits", {
    p_user_id: userId,
    p_amount: -amount,
    p_type: action,
    p_label: label,
    p_reference_id: referenceId || null,
  });

  if (error) {
    console.error(`[Credits] Failed to deduct ${amount} credits for ${action}:`, error);
    return false;
  }

  console.log(`[Credits] Deducted ${amount} credits from user ${userId} for ${action}: ${label}`);
  return true;
}
