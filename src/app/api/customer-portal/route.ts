// ─────────────────────────────────────────────
// POST /api/customer-portal
// ─────────────────────────────────────────────
// Generates a Polar Customer Portal session URL.
// Allows users to manage subscriptions, update payment methods, and view receipts.

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { polar } from "@/lib/polar";

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const hostHeader = req.headers.get("host");
    const originHeader = req.headers.get("origin");
    const protocol = hostHeader && !hostHeader.includes("localhost") ? "https" : "http";
    const appUrl = (
      process.env.NEXT_PUBLIC_APP_URL ||
      originHeader ||
      (hostHeader ? `${protocol}://${hostHeader}` : "") ||
      (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000")
    ).replace(/\/$/, "");

    const returnUrl = `${appUrl}/credits`;

    // Try finding customer via externalCustomerId (user.id)
    try {
      const session = await polar.customerSessions.create({
        externalCustomerId: user.id,
        returnUrl,
      });

      return NextResponse.json({ url: session.customerPortalUrl });
    } catch (sessionErr: any) {
      // If externalCustomerId not found in Polar yet, look up by email
      console.warn("[customer-portal] externalCustomerId lookup failed, trying customer list:", sessionErr?.message);
      
      const customerList = await polar.customers.list({
        email: user.email ?? undefined,
        limit: 1,
      });

      const customer = customerList.result.items[0];
      if (!customer) {
        return NextResponse.json(
          { error: "No billing profile found. You have not made any purchases yet." },
          { status: 404 },
        );
      }

      const session = await polar.customerSessions.create({
        customerId: customer.id,
        returnUrl,
      });

      return NextResponse.json({ url: session.customerPortalUrl });
    }
  } catch (err: any) {
    console.error("[customer-portal] Error creating customer portal session:", err);
    const isScopeError = err?.statusCode === 403 || err?.status === 403 || String(err?.message || "").includes("insufficient_scope");
    const errorMessage = isScopeError
      ? "Customer portal requires the 'customer_sessions:write' scope on your Polar Access Token. You can also manage or cancel subscriptions via your receipt email."
      : (err?.message || "Failed to open billing portal");

    return NextResponse.json(
      { error: errorMessage },
      { status: isScopeError ? 403 : 500 },
    );
  }
}
