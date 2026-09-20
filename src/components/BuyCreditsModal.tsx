"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { Coins, Zap, Check, X, Loader2, ShieldCheck, Sparkles, ArrowRight, Layers } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import styles from "./BuyCreditsModal.module.css";

export interface BuyCreditsModalProps {
  isOpen: boolean;
  onClose: () => void;
  creditsRequired?: number;
  currentBalance?: number;
  actionName?: string;
  onSuccess?: (newBalance: number) => void;
  returnUrl?: string;
}

const PRODUCTS = {
  topups: [
    {
      id: "starter",
      name: "Starter Pack",
      credits: 500,
      price: "$10",
      priceNum: 10,
      desc: "Instant top-up for documents & chat",
      productId: "00fff612-c08e-4bdd-b312-91617773e40b",
      features: [
        "500 usable credits immediately",
        "~500 documents or ~500 chat replies",
        "Credits never expire",
        "No monthly recurring charges",
      ],
      featured: false,
    },
    {
      id: "power",
      name: "Power Pack",
      credits: 2500,
      price: "$40",
      priceNum: 40,
      badge: "Best Value • 20% Off",
      desc: "High volume for multimodal & heavy RAG",
      productId: "3b97ad74-1645-4d8e-9c3e-c39e401b5eb1",
      features: [
        "2,500 usable credits immediately",
        "Save 20% vs starter pack rate",
        "Full support for audio, video & PDF ingest",
        "Credits never expire",
      ],
      featured: true,
    },
  ],
  subscriptions: [
    {
      id: "pro",
      name: "Pro Plan",
      credits: 2000,
      price: "$19/mo",
      desc: "For creators & active knowledge bases",
      productId: "fd898064-a43d-48de-a996-bdf220b62fc7",
      features: [
        "2,000 credits renewed monthly",
        "Dedicated Vertex AI Enterprise routing",
        "Priority multimodal processing",
        "Cancel or pause anytime",
      ],
      featured: false,
    },
    {
      id: "business",
      name: "Business Plan",
      credits: 10000,
      price: "$79/mo",
      badge: "Maximum Power",
      desc: "For heavy organizational knowledge bases",
      productId: "a02142a9-f54a-4637-817e-cb32fb46c67c",
      features: [
        "10,000 credits renewed monthly",
        "Highest throughput & zero queuing",
        "Full access to enterprise embedding models",
        "Dedicated developer support",
      ],
      featured: true,
    },
  ],
};

export function BuyCreditsModal({
  isOpen,
  onClose,
  creditsRequired,
  currentBalance: initialBalance,
  actionName,
  onSuccess,
  returnUrl,
}: BuyCreditsModalProps) {
  const [activeTab, setActiveTab] = useState<"topups" | "subscriptions">("topups");
  const [balance, setBalance] = useState<number>(initialBalance ?? 0);
  const [loadingBalance, setLoadingBalance] = useState(false);
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null);

  const supabase = createClient();

  const fetchLiveBalance = useCallback(async () => {
    try {
      setLoadingBalance(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: profile } = await supabase
        .from("profiles")
        .select("credits_balance, credits_held")
        .eq("id", user.id)
        .single();

      if (profile) {
        const avail = Math.max(0, (profile.credits_balance ?? 0) - (profile.credits_held ?? 0));
        setBalance(avail);
      }
    } catch (e) {
      console.warn("[BuyCreditsModal] Error fetching balance:", e);
    } finally {
      setLoadingBalance(false);
    }
  }, [supabase]);

  // Sync balance when modal opens
  useEffect(() => {
    if (isOpen) {
      if (initialBalance !== undefined) {
        setBalance(initialBalance);
      }
      fetchLiveBalance();
    }
  }, [isOpen, initialBalance, fetchLiveBalance]);

  // Check URL params for checkout return: auto-sync and notify
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("checkout") === "success") {
      // Reconcile instantly with Polar
      fetch("/api/checkout/sync", { method: "POST" })
        .then((res) => res.json())
        .then((data) => {
          if (data.profile?.balance !== undefined) {
            setBalance(data.profile.balance);
            if (onSuccess) onSuccess(data.profile.balance);
          }
          toast.success("Payment completed! Your credits have been updated.", {
            duration: 5000,
          });
        })
        .catch((err) => console.warn("[BuyCreditsModal] Sync notice:", err))
        .finally(() => {
          // Clean up URL parameter cleanly
          const url = new URL(window.location.href);
          url.searchParams.delete("checkout");
          window.history.replaceState({}, "", url.toString());
        });
    }
  }, [onSuccess]);

  async function handleBuy(productId: string) {
    if (!productId) {
      toast.info("This package is currently being configured. Please choose another pack.");
      return;
    }

    setCheckoutLoading(productId);
    try {
      const targetReturnUrl = returnUrl || (typeof window !== "undefined" ? window.location.pathname + window.location.search : "/credits");
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId,
          returnUrl: targetReturnUrl,
        }),
      });

      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        toast.error(data.error || "Failed to create checkout session. Please try again.");
      }
    } catch {
      toast.error("Network error connecting to payment gateway. Please check your connection.");
    } finally {
      setCheckoutLoading(null);
    }
  }

  if (!isOpen) return null;

  const creditsNeeded = creditsRequired !== undefined ? Math.max(0, creditsRequired - balance) : 0;
  const isInsufficient = creditsRequired !== undefined && balance < creditsRequired;

  return (
    <div className={styles.overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className={styles.modal} role="dialog" aria-modal="true">
        {/* Header */}
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            <div className={styles.iconWrap}>
              {isInsufficient ? <Zap size={22} /> : <Coins size={22} />}
            </div>
            <div className={styles.titleArea}>
              <div className={styles.title}>
                {isInsufficient ? "Credit Limit Reached" : "Refill Credits"}
              </div>
              <div className={styles.subtitle}>
                {actionName
                  ? `You need more credits to ${actionName}. Select a package to continue immediately.`
                  : isInsufficient
                  ? `This action requires ${creditsRequired} credits. Top up your balance to proceed.`
                  : "Choose an instant top-up pack or monthly plan to power your AI models and chat."}
              </div>
            </div>
          </div>

          <button className={styles.closeBtn} onClick={onClose} aria-label="Close dialog">
            <X size={16} />
          </button>
        </div>

        {/* Balance Status Banner */}
        <div className={styles.balanceRow}>
          <div className={`${styles.balancePill} ${balance === 0 ? styles.balancePillWarning : styles.balancePillHighlight}`}>
            <Coins size={13} />
            <span>Available Balance: {loadingBalance ? "..." : `${balance.toLocaleString()} credits`}</span>
          </div>

          {isInsufficient && (
            <div className={`${styles.balancePill} ${styles.balancePillWarning}`}>
              <Zap size={13} />
              <span>Required: {creditsRequired} ({creditsNeeded} more needed)</span>
            </div>
          )}
        </div>

        {/* Modal Body */}
        <div className={styles.body}>
          {/* Tab Switcher */}
          <div className={styles.tabsContainer}>
            <button
              type="button"
              className={`${styles.tabBtn} ${activeTab === "topups" ? styles.tabBtnActive : ""}`}
              onClick={() => setActiveTab("topups")}
            >
              <Coins size={15} />
              <span>One-Time Top-Up</span>
            </button>
            <button
              type="button"
              className={`${styles.tabBtn} ${activeTab === "subscriptions" ? styles.tabBtnActive : ""}`}
              onClick={() => setActiveTab("subscriptions")}
            >
              <Layers size={15} />
              <span>Monthly Subscription</span>
            </button>
          </div>

          {/* Cards Grid */}
          <div className={styles.productsGrid}>
            {(activeTab === "topups" ? PRODUCTS.topups : PRODUCTS.subscriptions).map((prod) => {
              const isLoading = checkoutLoading === prod.productId;
              return (
                <div
                  key={prod.id}
                  className={`${styles.productCard} ${prod.featured ? styles.productCardFeatured : ""}`}
                >
                  {prod.badge && <div className={styles.badgeHighlight}>{prod.badge}</div>}

                  <div className={styles.productHeader}>
                    <div className={styles.productName}>{prod.name}</div>
                    <div className={styles.productDesc}>{prod.desc}</div>
                  </div>

                  <div className={styles.priceRow}>
                    <span className={styles.priceAmount}>{prod.price}</span>
                    <span className={styles.priceCredits}>• {prod.credits.toLocaleString()} credits</span>
                  </div>

                  <ul className={styles.featuresList}>
                    {prod.features.map((feat, idx) => (
                      <li key={idx} className={styles.featureItem}>
                        <Check size={14} className={styles.featureCheck} />
                        <span>{feat}</span>
                      </li>
                    ))}
                  </ul>

                  <button
                    type="button"
                    className={`${styles.buyBtn} ${prod.featured ? styles.buyBtnPrimary : styles.buyBtnSecondary}`}
                    onClick={() => handleBuy(prod.productId)}
                    disabled={Boolean(checkoutLoading)}
                  >
                    {isLoading ? (
                      <>
                        <Loader2 size={15} className={styles.spinner} />
                        <span>Opening Checkout...</span>
                      </>
                    ) : (
                      <>
                        <span>{activeTab === "topups" ? `Get ${prod.name}` : `Subscribe for ${prod.price}`}</span>
                        <ArrowRight size={14} />
                      </>
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        {/* Footer */}
        <div className={styles.footer}>
          <div className={styles.footerNotice}>
            <ShieldCheck size={14} color="var(--accent-primary)" />
            <span>Instant delivery • Secured by Polar • Credits never expire on top-ups</span>
          </div>

          <Link href="/credits" onClick={onClose} className={styles.footerLink}>
            View full billing details &rarr;
          </Link>
        </div>
      </div>
    </div>
  );
}
