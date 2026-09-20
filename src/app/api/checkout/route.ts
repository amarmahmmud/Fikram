// ─────────────────────────────────────────────
// POST /api/checkout
// ─────────────────────────────────────────────
// Creates a Polar Checkout Session and returns the URL.
// Client redirects user to Polar's hosted checkout page.
// Credits are NEVER granted here — only via webhook.

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { polar } from "@/lib/polar";

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { productId, returnUrl } = await req.json();
    if (!productId || typeof productId !== "string") {
      return NextResponse.json(
        { error: "productId is required" },
        { status: 400 },
      );
    }

    // Determine base URL dynamically with fallbacks (env var, origin header, Vercel URL, or localhost)
    const hostHeader = req.headers.get("host");
    const originHeader = req.headers.get("origin");
    const protocol = hostHeader && !hostHeader.includes("localhost") ? "https" : "http";
    const appUrl = (
      process.env.NEXT_PUBLIC_APP_URL ||
      originHeader ||
      (hostHeader ? `${protocol}://${hostHeader}` : "") ||
      (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000")
    ).replace(/\/$/, "");

    // Determine success URL — returns to custom returnUrl if provided, else default /credits
    let successUrl = `${appUrl}/credits?checkout=success`;
    if (returnUrl && typeof returnUrl === "string" && returnUrl.startsWith("/")) {
      const sep = returnUrl.includes("?") ? "&" : "?";
      successUrl = `${appUrl}${returnUrl}${sep}checkout=success`;
    }

    // Create a Polar Checkout Session
    // Pass supabase_user_id as metadata & externalCustomerId so the webhook maps back accurately
    const checkout = await polar.checkouts.create({
      products: [productId],
      successUrl,
      metadata: {
        supabase_user_id: user.id,
        supabase_email: user.email ?? "",
      },
      customerEmail: user.email ?? undefined,
      externalCustomerId: user.id,
    });

    return NextResponse.json({ url: checkout.url });
  } catch (err: any) {
    console.error("[checkout] Error creating checkout session:", {
      message: err?.message,
      statusCode: err?.statusCode || err?.status,
      body: err?.body,
    });

    const isScopeError =
      err?.statusCode === 403 ||
      err?.status === 403 ||
      String(err?.message || "").includes("insufficient_scope") ||
      String(err?.body || "").includes("insufficient_scope");

    const errorMessage = isScopeError
      ? "Polar API configuration error: The access token is missing the 'checkouts:write' permission scope. Please create an access token with checkout permissions in the Polar developer dashboard."
      : (err?.message || "Failed to create checkout session");

    return NextResponse.json(
      { error: errorMessage },
      { status: isScopeError ? 403 : 500 },
    );
  }
}
