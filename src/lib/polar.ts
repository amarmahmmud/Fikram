// ─────────────────────────────────────────────
// Polar.sh SDK Client & Pricing Constants
// ─────────────────────────────────────────────
// Merchant-of-Record billing via Polar (sandbox mode).
// Env vars: POLAR_ACCESS_TOKEN, POLAR_ORGANIZATION_ID

import { Polar } from "@polar-sh/sdk";

export const polar = new Polar({
  accessToken: process.env.POLAR_ACCESS_TOKEN!,
  server: process.env.NODE_ENV === "production" ? "production" : "sandbox",
});

// ── Credit allowances per plan (server-side source of truth) ──
// These values control how many credits the webhook grants on
// subscription creation and renewal. Adjust here, not in Polar dashboard.
export const PLAN_CREDITS: Record<string, number> = {
  free: 0,         // No monthly refill — only signup bonus
  pro: 2000,       // TBD: confirm with user
  enterprise: 10000, // TBD: confirm with user
};

// ── Map Polar product IDs → plan names ──
// Populated after user creates products in Polar sandbox dashboard.
// The webhook handler uses this to determine which plan a subscription maps to.
// Keys are Polar product IDs (UUIDs), values are plan names from the profiles table.
export const PRODUCT_PLAN_MAP: Record<string, string> = {
  // "polar_product_id_for_pro": "pro",
  // "polar_product_id_for_business": "enterprise",
};

// ── Map Polar product IDs → one-off credit amounts ──
// For top-up packs (non-subscription, one-time purchases).
export const TOPUP_CREDITS: Record<string, number> = {
  // "polar_product_id_for_starter_pack": 500,
  // "polar_product_id_for_power_pack": 2500,
};
