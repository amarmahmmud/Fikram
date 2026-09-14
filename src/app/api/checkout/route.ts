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

    const { productId } = await req.json();
    if (!productId || typeof productId !== "string") {
      return NextResponse.json(
        { error: "productId is required" },
        { status: 400 },
      );
    }

    // Create a Polar Checkout Session
    // Pass supabase_user_id as metadata so the webhook can map back to our user
    const checkout = await polar.checkouts.create({
      products: [productId],
      successUrl: `${process.env.NEXT_PUBLIC_APP_URL}/credits?checkout=success`,
      metadata: {
        supabase_user_id: user.id,
        supabase_email: user.email ?? "",
      },
      customerEmail: user.email ?? undefined,
    });

    return NextResponse.json({ url: checkout.url });
  } catch (err) {
    console.error("[checkout] Error creating checkout session:", err);
    return NextResponse.json(
      { error: "Failed to create checkout session" },
      { status: 500 },
    );
  }
}
