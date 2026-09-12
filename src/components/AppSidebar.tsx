"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { FikraLogo } from "@/components/FikraLogo";
import { LayoutDashboard, Globe, Sparkles, Wrench, List, Layers, Coins, Settings } from "lucide-react";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: <LayoutDashboard size={18} /> },
  { href: "/browse",    label: "Browse Models", icon: <Globe size={18} /> },
  { href: "/experts/new", label: "New Assistant", icon: <Sparkles size={18} />, highlight: true },
  { href: "/jobs",      label: "Jobs", icon: <List size={18} /> },
  { href: "/models",    label: "Model Registry", icon: <Layers size={18} /> },
];

const NAV_BOTTOM = [
  { href: "/credits",  label: "Credits", icon: <Coins size={18} /> },
  { href: "/settings", label: "Settings", icon: <Settings size={18} /> },
];

export function AppSidebar({ credits: initialCredits }: { credits?: number }) {
  const pathname = usePathname();
  const supabase = createClient();

  const [userName, setUserName] = useState<string>("Loading...");
  const [userEmail, setUserEmail] = useState<string>("");
  const [credits, setCredits] = useState<number>(initialCredits ?? 100);
  const [initials, setInitials] = useState<string>("--");
  const [isOpen, setIsOpen] = useState(false);

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
            .select("full_name, credits_balance, avatar_url")
            .eq("id", user.id)
            .single();

          const displayName = profile?.full_name?.trim() || email.split("@")[0] || "User";
          setUserName(displayName);

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
        className={`mobile-sidebar-toggle ${isOpen ? "hidden" : ""}`}
        onClick={() => setIsOpen(true)}
        aria-label="Open menu"
        aria-expanded={isOpen}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="3" y1="12" x2="21" y2="12" />
          <line x1="3" y1="6" x2="21" y2="6" />
          <line x1="3" y1="18" x2="21" y2="18" />
        </svg>
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
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
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
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setIsOpen(false)}
              className={`nav-item ${pathname === item.href ? "active" : ""}`}
            >
              <span style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>{item.icon}</span>
              <span>{item.label}</span>
            </Link>
          ))}
        </nav>

        {/* Credit bar */}
        <div style={{ padding: "0 12px 12px" }}>
          <Link href="/credits" onClick={() => setIsOpen(false)} style={{ textDecoration: "none", display: "block" }}>
            <div className="credit-bar">
              <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", whiteSpace: "nowrap" }}>Credits</span>
              <div className="credit-bar-track">
                <div className="credit-bar-fill" style={{ width: `${Math.min(100, Math.max(0, credits))}%` }} />
              </div>
              <span style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--text-primary)", whiteSpace: "nowrap", fontFamily: "var(--font-mono)" }}>
                {credits}
              </span>
            </div>
          </Link>
        </div>

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
    </>
  );
}

