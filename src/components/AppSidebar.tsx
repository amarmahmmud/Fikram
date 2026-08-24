"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { FikraLogo } from "@/components/FikraLogo";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: "⊞" },
  { href: "/experts/new", label: "New Assistant", icon: "◆", highlight: true },
  { href: "/new-job",   label: "Fine-Tune", icon: "◈" },
  { href: "/jobs",      label: "Jobs", icon: "◈" },
  { href: "/models",    label: "Model Browser", icon: "◉" },
];

const NAV_BOTTOM = [
  { href: "/credits",  label: "Credits", icon: "◈" },
  { href: "/settings", label: "Settings", icon: "⚙" },
];

export function AppSidebar({ credits: initialCredits }: { credits?: number }) {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createClient();

  const [userName, setUserName] = useState<string>("Loading...");
  const [userEmail, setUserEmail] = useState<string>("");
  const [credits, setCredits] = useState<number>(initialCredits ?? 100);
  const [initials, setInitials] = useState<string>("--");
  const [isOpen, setIsOpen] = useState(false);

  // Close sidebar on route change
  useEffect(() => {
    setIsOpen(false);
  }, [pathname]);

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
      {/* Mobile toggle button */}
      <button 
        className="mobile-sidebar-toggle"
        onClick={() => setIsOpen(!isOpen)}
        aria-label="Toggle Menu"
      >
        {isOpen ? (
           <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        ) : (
           <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg>
        )}
      </button>

      {/* Mobile overlay */}
      {isOpen && (
        <div className="mobile-sidebar-overlay" onClick={() => setIsOpen(false)} />
      )}

      <aside className={`sidebar ${isOpen ? "open" : ""}`}>
      {/* Logo */}
      <div className="sidebar-logo" style={{ padding: "0" }}>
        <FikraLogo size={32} showText subtitle="Expert AI Platform" />
      </div>

      {/* Nav */}
      <nav className="sidebar-nav">
        <span className="sidebar-section-label">Workspace</span>

        {NAV.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`nav-item ${pathname === item.href ? "active" : ""}`}
            style={item.highlight && pathname !== item.href ? {
              background: "rgba(99,102,241,0.08)",
              borderColor: "rgba(99,102,241,0.15)",
              color: "var(--text-primary)",
            } : {}}
          >
            <span style={{ fontSize: "1rem" }}>{item.icon}</span>
            {item.label}
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
            className={`nav-item ${pathname === item.href ? "active" : ""}`}
          >
            <span style={{ fontSize: "1rem" }}>{item.icon}</span>
            {item.label}
          </Link>
        ))}
      </nav>

      {/* Credit bar */}
      <div style={{ padding: "0 12px 12px" }}>
        <Link href="/credits" style={{ textDecoration: "none" }}>
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

      {/* User */}
      <div className="sidebar-footer">
        <Link href="/settings" style={{ textDecoration: "none", color: "inherit", display: "block" }}>
          <div className="user-card" title="Click to view Settings">
            <div className="user-avatar">{initials}</div>
            <div className="user-info">
              <div className="user-name">{userName}</div>
              <div className="user-email">{userEmail || "View settings"}</div>
            </div>
            <span style={{ fontSize: "0.875rem", color: "var(--text-muted)" }}>⚙</span>
          </div>
        </Link>
      </div>
    </aside>
    </>
  );
}

