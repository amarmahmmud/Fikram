"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import styles from "./page.module.css";
import type { Database } from "@/lib/supabase/types";

type Transaction = Database["public"]["Tables"]["credit_transactions"]["Row"];

// ── Product catalog (displayed in the Buy Credits modal) ──
const PRODUCTS = {
  subscriptions: [
    { name: "Pro Plan", desc: "2,000 credits/month", priceLabel: "$19/mo", productId: "8f72db21-1114-4a9f-8157-47cb9b2e5000" },
    { name: "Business Plan", desc: "10,000 credits/month", priceLabel: "$79/mo", productId: "bc6d568a-1f56-42ca-85b6-336b74d5fdae" },
  ],
  topups: [
    { name: "Starter Pack", desc: "500 credits", priceLabel: "$10", productId: "50545e08-3bca-4798-a059-e1596bb5204a" },
    { name: "Power Pack", desc: "2,500 credits", priceLabel: "$40", productId: "bbae00ef-894b-40c1-9eb9-b34369729371" },
  ],
};

// ── Wrapper with Suspense boundary for useSearchParams ──
export default function CreditsPageWrapper() {
  return (
    <Suspense fallback={
      <div className="page-content" style={{ textAlign: "center", padding: "48px 0", color: "var(--text-muted)" }}>
        Loading credits…
      </div>
    }>
      <CreditsPageContent />
    </Suspense>
  );
}

function CreditsPageContent() {
  const supabase = createClient();
  const searchParams = useSearchParams();
  const [balance, setBalance] = useState<number>(0);
  const [held, setHeld] = useState<number>(0);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [showBuyModal, setShowBuyModal] = useState(false);
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null);

  const isCheckoutSuccess = searchParams.get("checkout") === "success";

  useEffect(() => {
    async function loadData() {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        // Fetch profile credits balance + held
        const { data: profile } = await supabase
          .from("profiles")
          .select("credits_balance, credits_held")
          .eq("id", user.id)
          .single();

        if (profile) {
          setBalance(profile.credits_balance);
          setHeld((profile as Record<string, unknown>).credits_held as number ?? 0);
        }

        // Fetch user's credit transactions
        const { data: txs } = await supabase
          .from("credit_transactions")
          .select("*")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false });

        if (txs) {
          setTransactions(txs);
        }
      } catch (err) {
        console.error("Error loading credits:", err);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, [supabase]);

  const total = Math.max(100, balance + held); // Dynamic total based on actual balance
  const available = Math.max(0, balance - held);
  const pct = Math.min(100, Math.max(0, Math.round((available / total) * 100)));

  /** Map transaction type to a human-readable badge */
  function txBadge(type: string) {
    switch (type) {
      case "signup_bonus": return { label: "SIGNUP BONUS", cls: "badge-success" };
      case "purchase": return { label: "PURCHASE", cls: "badge-success" };
      case "subscription_grant": return { label: "SUBSCRIPTION", cls: "badge-success" };
      case "job_consumed": return { label: "USAGE", cls: "badge-default" };
      case "job_hold": return { label: "HOLD", cls: "badge-indigo" };
      case "job_refund": return { label: "REFUND", cls: "badge-success" };
      case "refund": return { label: "REFUND", cls: "badge-success" };
      default: return { label: type.replace("_", " ").toUpperCase(), cls: "badge-default" };
    }
  }

  async function handleCheckout(productId: string) {
    if (!productId) {
      alert("This product is not yet configured. Please check back soon.");
      return;
    }
    setCheckoutLoading(productId);
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId }),
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        alert(data.error || "Failed to create checkout session");
      }
    } catch {
      alert("Something went wrong. Please try again.");
    } finally {
      setCheckoutLoading(null);
    }
  }

  return (
    <>
      <div className="topbar">
        <span className="topbar-title">Credits &amp; Billing</span>
        <button
          className="btn btn-primary btn-sm"
          onClick={() => setShowBuyModal(true)}
        >
          Buy More Credits
        </button>
      </div>

      <div className="page-content">
        {/* Checkout success banner */}
        {isCheckoutSuccess && (
          <div
            style={{
              background: "rgba(16, 185, 129, 0.1)",
              border: "1px solid rgba(16, 185, 129, 0.3)",
              borderRadius: "var(--radius-md)",
              padding: "12px 16px",
              color: "var(--success)",
              fontSize: "0.875rem",
              fontWeight: 600,
              marginBottom: 20,
            }}
          >
            ✓ Payment received — your credits will appear in a moment once the payment is confirmed.
          </div>
        )}

        {/* Balance card */}
        <div className={styles.balanceCard}>
          <div className={styles.balanceGlow} />
          <div className={styles.balanceContent}>
            <div>
              <div className={styles.balanceLabel}>Available Balance</div>
              <div className={styles.balanceValue}>{loading ? "..." : available}</div>
              <div className={styles.balanceUnit}>credits available</div>
            </div>
            <div className={styles.balanceChart}>
              <svg viewBox="0 0 120 120" className={styles.radialSvg}>
                <circle cx="60" cy="60" r="50" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="10" />
                <circle
                  cx="60" cy="60" r="50"
                  fill="none"
                  stroke="url(#creditGrad)"
                  strokeWidth="10"
                  strokeDasharray={`${2 * Math.PI * 50}`}
                  strokeDashoffset={`${2 * Math.PI * 50 * (1 - pct / 100)}`}
                  strokeLinecap="round"
                  transform="rotate(-90 60 60)"
                />
                <defs>
                  <linearGradient id="creditGrad" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="#00E5C8" />
                    <stop offset="100%" stopColor="#C77DFF" />
                  </linearGradient>
                </defs>
                <text x="60" y="55" textAnchor="middle" fill="white" fontSize="18" fontWeight="800" fontFamily="Inter,sans-serif">{pct}%</text>
                <text x="60" y="72" textAnchor="middle" fill="#52525b" fontSize="9" fontFamily="Inter,sans-serif">available</text>
              </svg>
            </div>
          </div>

          <div className={styles.creditStats}>
            <div className={styles.creditStat}>
              <span className={styles.creditStatValue}>{balance}</span>
              <span className={styles.creditStatLabel}>Total Balance</span>
            </div>
            {held > 0 && (
              <div className={styles.creditStat}>
                <span className={styles.creditStatValue} style={{ color: "var(--accent-primary)" }}>{held}</span>
                <span className={styles.creditStatLabel}>Held (in progress)</span>
              </div>
            )}
            <div className={styles.creditStat}>
              <span className={styles.creditStatValue} style={{ color: "var(--success)" }}>{available}</span>
              <span className={styles.creditStatLabel}>Available</span>
            </div>
          </div>
        </div>

        {/* Credit usage reference — reflects currently live features */}
        <div className={styles.estimatorCard}>
          <h3 className={styles.sectionTitle}>Credit Usage Reference</h3>
          <div className={styles.estimatorGrid}>
            {[
              { feature: "AI Expert Chat", desc: "Ask your expert questions", cost: "1 credit/message" },
              { feature: "Document Ingestion", desc: "Upload & process documents for RAG", cost: "2 credits/document" },
              { feature: "Playground Inference", desc: "Test models in the playground", cost: "1 credit/request" },
            ].map((e) => (
              <div key={e.feature} className={styles.estimatorRow}>
                <div className={styles.estimatorModel}>{e.feature}</div>
                <div className={styles.estimatorTime} style={{ flex: 1 }}>{e.desc}</div>
                <div className={styles.estimatorCost}>{e.cost}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Transaction History */}
        <div className="card">
          <h3 className={styles.sectionTitle} style={{ marginBottom: 16 }}>Transaction History</h3>
          {transactions.length === 0 ? (
            <div style={{ textAlign: "center", padding: "32px 0", color: "var(--text-muted)", fontSize: "0.875rem" }}>
              No transactions recorded yet.
            </div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Description</th>
                    <th>Type</th>
                    <th>Amount</th>
                    <th>Balance After</th>
                    <th>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.map((tx) => {
                    const badge = txBadge(tx.type);
                    return (
                      <tr key={tx.id}>
                        <td style={{ fontWeight: 600, color: "var(--text-primary)" }}>{tx.label}</td>
                        <td>
                          <span className={`badge ${badge.cls}`}>
                            {badge.label}
                          </span>
                        </td>
                        <td className="font-mono" style={{
                          color: tx.amount > 0 ? "var(--success)"
                            : tx.type === "job_hold" ? "var(--accent-primary)"
                            : "var(--warning)",
                          fontWeight: 700,
                        }}>
                          {tx.amount > 0 ? `+${tx.amount}` : tx.amount}
                        </td>
                        <td className="font-mono">{tx.balance_after}</td>
                        <td style={{ fontSize: "0.8125rem", color: "var(--text-muted)" }}>
                          {new Date(tx.created_at).toLocaleDateString()} {new Date(tx.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* ── Buy Credits Modal ── */}
      {showBuyModal && (
        <div
          style={{
            position: "fixed", inset: 0, zIndex: 1000,
            background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
          onClick={() => setShowBuyModal(false)}
        >
          <div
            className="card"
            style={{ maxWidth: 480, width: "90%", padding: 24 }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ fontSize: "1.125rem", fontWeight: 700, marginBottom: 4, color: "var(--text-primary)" }}>
              Buy Credits
            </h3>
            <p style={{ fontSize: "0.8125rem", color: "var(--text-muted)", marginBottom: 20 }}>
              Choose a subscription plan or a one-time top-up pack.
            </p>

            {/* Subscriptions */}
            <div style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>
              Monthly Plans
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 20 }}>
              {PRODUCTS.subscriptions.map((p) => (
                <button
                  key={p.name}
                  className="btn btn-secondary"
                  style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px" }}
                  disabled={!p.productId || checkoutLoading === p.productId}
                  onClick={() => handleCheckout(p.productId)}
                >
                  <span>
                    <strong>{p.name}</strong>
                    <span style={{ color: "var(--text-muted)", marginLeft: 8, fontSize: "0.8125rem" }}>{p.desc}</span>
                  </span>
                  <span style={{ fontWeight: 700, color: "var(--success)" }}>
                    {checkoutLoading === p.productId ? "..." : p.priceLabel}
                  </span>
                </button>
              ))}
            </div>

            {/* Top-ups */}
            <div style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>
              One-Time Top-Ups
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
              {PRODUCTS.topups.map((p) => (
                <button
                  key={p.name}
                  className="btn btn-secondary"
                  style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px" }}
                  disabled={!p.productId || checkoutLoading === p.productId}
                  onClick={() => handleCheckout(p.productId)}
                >
                  <span>
                    <strong>{p.name}</strong>
                    <span style={{ color: "var(--text-muted)", marginLeft: 8, fontSize: "0.8125rem" }}>{p.desc}</span>
                  </span>
                  <span style={{ fontWeight: 700, color: "var(--success)" }}>
                    {checkoutLoading === p.productId ? "..." : p.priceLabel}
                  </span>
                </button>
              ))}
            </div>

            <button
              className="btn btn-secondary btn-sm"
              style={{ width: "100%" }}
              onClick={() => setShowBuyModal(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </>
  );
}
