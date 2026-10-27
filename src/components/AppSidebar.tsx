"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { FikraLogo } from "@/components/FikraLogo";
import { LayoutDashboard, Globe, Sparkles, Wrench, List, Layers, Coins, Settings, Menu, X, Zap, Headphones } from "lucide-react";
import { BuyCreditsModal } from "@/components/BuyCreditsModal";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: <LayoutDashboard size={18} /> },
  { href: "/browse",    label: "Browse Models", icon: <Globe size={18} /> },
  { href: "/experts/new", label: "New AI Expert", icon: <Sparkles size={18} />, highlight: true },
  { href: "/jobs",      label: "Jobs", icon: <List size={18} /> },
  { href: "/models",    label: "Model Registry", icon: <Layers size={18} /> },
];

const NAV_BOTTOM = [
  { href: "/credits",  label: "Credits", icon: <Coins size={18} /> },
  { href: "/settings", label: "Settings", icon: <Settings size={18} /> },
  { href: "mailto:support@fikram.live", label: "Support", icon: <Headphones size={18} />, external: true },
];

export function AppSidebar({ credits: initialCredits }: { credits?: number }) {
  const pathname = usePathname();
  const supabase = createClient();

  const [userName, setUserName] = useState<string>("Loading...");
  const [userEmail, setUserEmail] = useState<string>("");
  const [credits, setCredits] = useState<number | null>(initialCredits ?? null);
  const [plan, setPlan] = useState<string>("free");
  const [initials, setInitials] = useState<string>("--");
  const [isOpen, setIsOpen] = useState(false);
  const [showBuyModal, setShowBuyModal] = useState(false);

  // Lock body scroll when mobile sidebar is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  useEffect(() => {
    async function loadUserData() {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          const email = user.email || "";
          setUserEmail(email);

          const { data: profile } = await supabase
            .from("profiles")
            .select("full_name, credits_balance, avatar_url, plan")
            .eq("id", user.id)
            .single();

          const displayName = profile?.full_name?.trim() || email.split("@")[0] || "User";
          setUserName(displayName);
          if (profile?.plan) {
            setPlan(profile.plan);
          }

          if (profile?.credits_balance !== undefined && profile?.credits_balance !== null) {
            setCredits(profile.credits_balance);
          } else if (initialCredits !== undefined) {
            setCredits(initialCredits);
          }

          const derivedInitials = displayName
            .split(" ")
            .map((n) => n[0])
            .join("")
            .toUpperCase()
            .slice(0, 2);
          setInitials(derivedInitials || "U");
        } else {
          setUserName("Guest");
          setUserEmail("");
          setInitials("G");
        }
      } catch (err) {
        console.error("Error loading user in sidebar:", err);
      }
    }

    loadUserData();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => {
      loadUserData();
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [supabase, initialCredits]);

  return (
    <>
      {/* Mobile hamburger toggle button (visible on phones when sidebar is closed) */}
      <button 
        type="button"
        className={`mobile-sidebar-toggle ${isOpen ? "hidden" : ""}`}
        onClick={() => setIsOpen(true)}
        aria-label="Open menu"
        aria-expanded={isOpen}
      >
        <Menu size={20} />
      </button>

      {/* Mobile backdrop overlay */}
      <div 
        className={`mobile-sidebar-overlay ${isOpen ? "active" : ""}`}
        onClick={() => setIsOpen(false)}
        aria-hidden={!isOpen}
      />

      {/* Sidebar drawer */}
      <aside className={`sidebar ${isOpen ? "open" : ""}`} aria-label="Sidebar navigation">
        {/* Header with Logo and dedicated Mobile Close button */}
        <div className="sidebar-logo">
          <Link href="/dashboard" onClick={() => setIsOpen(false)} style={{ display: "inline-flex", textDecoration: "none" }}>
            <FikraLogo size={30} showText subtitle="Expert AI Platform" />
          </Link>
          <button 
            className="sidebar-close-btn"
            onClick={() => setIsOpen(false)}
            aria-label="Close menu"
          >
            <X size={18} />
          </button>
        </div>

        {/* Navigation items */}
        <nav className="sidebar-nav">
          <span className="sidebar-section-label">Workspace</span>

          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setIsOpen(false)}
              className={`nav-item ${pathname === item.href ? "active" : ""}`}
              style={item.highlight && pathname !== item.href ? {
                background: "rgba(0,229,200,0.06)",
                borderColor: "rgba(0,229,200,0.18)",
                color: "var(--text-primary)",
              } : {}}
            >
              <span style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>{item.icon}</span>
              <span>{item.label}</span>
              {item.highlight && (
                <span className="badge badge-indigo" style={{ marginLeft: "auto", fontSize: "0.625rem", padding: "2px 6px" }}>
                  New
                </span>
              )}
            </Link>
          ))}

          <span className="sidebar-section-label" style={{ marginTop: 8 }}>Account</span>

          {NAV_BOTTOM.map((item) => (
            (item as any).external ? (
              <a
                key={item.href}
                href={item.href}
                onClick={() => setIsOpen(false)}
                className="nav-item"
                title="Customer Support (support@fikram.live)"
              >
                <span style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>{item.icon}</span>
                <span>{item.label}</span>
              </a>
            ) : (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setIsOpen(false)}
                className={`nav-item ${pathname === item.href ? "active" : ""}`}
              >
                <span style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>{item.icon}</span>
                <span>{item.label}</span>
              </Link>
            )
          ))}
        </nav>

        {/* Credit bar */}
        {(() => {
          const displayCredits = credits === null ? 0 : credits;
          
          let maxCredits = 50;
          if (plan === "enterprise" || plan === "business") {
            maxCredits = 10000;
          } else if (plan === "pro") {
            maxCredits = 2000;
          } else {
            const tiers = [50, 500, 1000, 2500, 5000, 10000];
            maxCredits = tiers.find(t => displayCredits <= t) || Math.ceil(displayCredits / 5000) * 5000;
          }

          const pct = Math.min(100, Math.max(0, Math.round((displayCredits / maxCredits) * 100)));

          const isZero = credits === 0;
          const isLow = credits !== null && credits < 10;

          return (
            <div style={{ padding: "0 12px 12px" }}>
              <div
                className={`credit-bar ${isZero ? "credit-bar-empty" : isLow ? "credit-bar-warning" : ""}`}
                onClick={() => {
                  setIsOpen(false);
                  setShowBuyModal(true);
                }}
                style={{
                  cursor: "pointer",
                  borderColor: isZero ? "rgba(239, 68, 68, 0.4)" : isLow ? "rgba(245, 158, 11, 0.4)" : undefined,
                  boxShadow: isZero
                    ? "0 0 12px rgba(239, 68, 68, 0.15)"
                    : isLow
                    ? "0 0 12px rgba(245, 158, 11, 0.12)"
                    : undefined,
                }}
                title="Click to view or refill credits"
              >
                <span style={{ fontSize: "0.75rem", color: isZero ? "#f87171" : isLow ? "#fbbf24" : "var(--text-muted)", whiteSpace: "nowrap" }}>
                  Credits
                </span>
                <div className="credit-bar-track">
                  <div
                    className="credit-bar-fill"
                    style={{
                      width: `${pct}%`,
                      background: isZero
                        ? "#ef4444"
                        : isLow
                        ? "linear-gradient(90deg, #f59e0b, #ef4444)"
                        : undefined,
                      boxShadow: isZero || isLow ? "0 0 8px rgba(245, 158, 11, 0.4)" : undefined,
                    }}
                  />
                </div>
                <span
                  style={{
                    fontSize: "0.8125rem",
                    fontWeight: 600,
                    color: isZero ? "#f87171" : isLow ? "#fbbf24" : "var(--text-primary)",
                    whiteSpace: "nowrap",
                    fontFamily: "var(--font-mono)",
                    fontVariantNumeric: "tabular-nums",
                    fontFeatureSettings: '"zero" 0',
                    letterSpacing: "0.02em",
                    flexShrink: 0,
                    display: "flex",
                    alignItems: "center",
                    gap: 3,
                  }}
                >
                  {credits === null ? "..." : isZero ? "0 • Refill" : credits.toLocaleString()}
                </span>
              </div>
            </div>
          );
        })()}

        {/* User footer */}
        <div className="sidebar-footer">
          <Link href="/settings" onClick={() => setIsOpen(false)} style={{ textDecoration: "none", color: "inherit", display: "block" }}>
            <div className="user-card" title="Click to view Settings">
              <div className="user-avatar">{initials}</div>
              <div className="user-info">
                <div className="user-name">{userName}</div>
                <div className="user-email">{userEmail || "View settings"}</div>
              </div>
              <Settings size={16} color="var(--text-muted)" />
            </div>
          </Link>
        </div>
      </aside>

      <BuyCreditsModal
        isOpen={showBuyModal}
        onClose={() => setShowBuyModal(false)}
        currentBalance={credits ?? undefined}
        onSuccess={(newBal) => {
          setCredits(newBal);
        }}
      />
    </>
  );
}

