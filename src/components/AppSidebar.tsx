"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: "⊞" },
  { href: "/new-job",   label: "New Fine-Tune", icon: "✦", highlight: true },
  { href: "/jobs",      label: "Jobs", icon: "◈" },
  { href: "/models",    label: "Model Browser", icon: "◉" },
  { href: "/playground",label: "Playground", icon: "▷" },
];

const NAV_BOTTOM = [
  { href: "/credits",  label: "Credits", icon: "◈" },
  { href: "/settings", label: "Settings", icon: "⚙" },
];

export function AppSidebar({ credits = 72 }: { credits?: number }) {
  const pathname = usePathname();

  return (
    <aside className="sidebar">
      {/* Logo */}
      <div className="sidebar-logo">
        <div className="sidebar-logo-mark">MF</div>
        <div className="sidebar-logo-text">
          Model Factory
          <span>AI Fine-Tuning Platform</span>
        </div>
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
        <div className="credit-bar">
          <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", whiteSpace: "nowrap" }}>Credits</span>
          <div className="credit-bar-track">
            <div className="credit-bar-fill" style={{ width: `${credits}%` }} />
          </div>
          <span style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--text-primary)", whiteSpace: "nowrap", fontFamily: "var(--font-mono)" }}>
            {credits}
          </span>
        </div>
      </div>

      {/* User */}
      <div className="sidebar-footer">
        <div className="user-card">
          <div className="user-avatar">JS</div>
          <div className="user-info">
            <div className="user-name">Jane Smith</div>
            <div className="user-email">jane@example.com</div>
          </div>
          <span style={{ fontSize: "0.875rem", color: "var(--text-muted)" }}>⋯</span>
        </div>
      </div>
    </aside>
  );
}
