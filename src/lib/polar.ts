// ─────────────────────────────────────────────
// Polar.sh SDK Client & Pricing Constants
// ─────────────────────────────────────────────
// Merchant-of-Record billing via Polar (sandbox mode).
// Env vars: POLAR_ACCESS_TOKEN, POLAR_ORGANIZATION_ID

import { Polar } from "@polar-sh/sdk";

// Server environment: Allow explicit override via POLAR_SERVER ("sandbox" | "production")
// This allows testing in sandbox on live Vercel deployments before switching to production.
export const polarServer: "sandbox" | "production" =
  (process.env.POLAR_SERVER as "sandbox" | "production") ||
  (process.env.POLAR_ENV as "sandbox" | "production") ||
  (process.env.NODE_ENV === "production" ? "production" : "sandbox");

export const polar = new Polar({
  accessToken: process.env.POLAR_ACCESS_TOKEN!,
  server: polarServer,
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
// The webhook handler & reconciliation sync use this to determine which plan a subscription maps to.
export const PRODUCT_PLAN_MAP: Record<string, string> = {
  // ── Production (Live Polar) ──
  "fd898064-a43d-48de-a996-bdf220b62fc7": "pro",        // Pro Plan ($19/mo)
  "a02142a9-f54a-4637-817e-cb32fb46c67c": "enterprise", // Business Plan ($79/mo)

  // ── Sandbox (Test Environment) ──
  "8f72db21-1114-4a9f-8157-47cb9b2e5000": "pro",
  "bc6d568a-1f56-42ca-85b6-336b74d5fdae": "enterprise",
};

// ── Map Polar product IDs → one-off credit amounts ──
// For top-up packs (non-subscription, one-time purchases).
export const TOPUP_CREDITS: Record<string, number> = {
  // ── Production (Live Polar) ──
  "00fff612-c08e-4bdd-b312-91617773e40b": 500,   // Starter Pack ($10)
  "3b97ad74-1645-4d8e-9c3e-c39e401b5eb1": 2500,  // Power Pack ($40)

  // ── Sandbox (Test Environment) ──
  "50545e08-3bca-4798-a059-e1596bb5204a": 500,   // Starter Pack
  "bbae00ef-894b-40c1-9eb9-b34369729371": 2500,  // Power Pack
};
