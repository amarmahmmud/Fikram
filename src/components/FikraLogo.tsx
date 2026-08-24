import React from "react";

interface FikraLogoProps {
  size?: number;
  showText?: boolean;
  subtitle?: string;
  className?: string;
}

export function FikraLogo({
  size = 32,
  showText = false,
  subtitle,
  className = "",
}: FikraLogoProps) {
  return (
    <div
      className={`fikra-logo-container ${className}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: size > 28 ? 10 : 8,
        textDecoration: "none",
      }}
    >
      {/* Mathematical F+A Minimalist Monogram */}
      <svg
        width={size}
        height={size}
        viewBox="0 0 36 36"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        style={{ flexShrink: 0 }}
      >
        <defs>
          {/* Base Gradients */}
          <linearGradient id="fikra-bg-grad" x1="0" y1="0" x2="36" y2="36" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#12121A" />
            <stop offset="100%" stopColor="#050508" />
          </linearGradient>
          <linearGradient id="fikra-border-grad" x1="0" y1="0" x2="36" y2="36" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="rgba(255, 255, 255, 0.12)" />
            <stop offset="100%" stopColor="rgba(99, 102, 241, 0.25)" />
          </linearGradient>

          {/* FA Monogram Gradients */}
          <linearGradient id="stem1-grad" x1="8" y1="9" x2="12" y2="29" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#818CF8" />
            <stop offset="100%" stopColor="#4F46E5" />
          </linearGradient>
          <linearGradient id="topbar-grad" x1="14" y1="9" x2="20" y2="13" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#818CF8" />
            <stop offset="100%" stopColor="#22D3EE" />
          </linearGradient>
          <linearGradient id="crossbar-grad" x1="14" y1="17" x2="20" y2="21" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#6366F1" />
            <stop offset="100%" stopColor="#3B82F6" />
          </linearGradient>
          <linearGradient id="stem2-grad" x1="22" y1="17" x2="26" y2="29" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#3B82F6" />
            <stop offset="100%" stopColor="#0EA5E9" />
          </linearGradient>
          <linearGradient id="spark-grad" x1="20" y1="7" x2="28" y2="15" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#FFFFFF" />
            <stop offset="100%" stopColor="#67E8F9" />
          </linearGradient>
        </defs>

        {/* Clean Squircle Base */}
        <rect width="36" height="36" rx="10" fill="url(#fikra-bg-grad)" />
        <rect width="35" height="35" x="0.5" y="0.5" rx="9.5" stroke="url(#fikra-border-grad)" strokeWidth="1" />

        {/* Stem 1 (Left leg of F/A) */}
        <rect x="8" y="9" width="4" height="20" rx="2" fill="url(#stem1-grad)" />

        {/* Top bar of F */}
        <rect x="14" y="9" width="6" height="4" rx="2" fill="url(#topbar-grad)" />

        {/* Crossbar (Mid F / Mid A) */}
        <rect x="14" y="17" width="6" height="4" rx="2" fill="url(#crossbar-grad)" />

        {/* Stem 2 (Right leg of A) */}
        <rect x="22" y="17" width="4" height="12" rx="2" fill="url(#stem2-grad)" />

        {/* AI Spark (Apex of A / Idea connection) */}
        <path
          d="M24 7C24 9.2 25.8 11 28 11C25.8 11 24 12.8 24 15C24 12.8 22.2 11 20 11C22.2 11 24 9.2 24 7Z"
          fill="url(#spark-grad)"
        />
      </svg>

      {showText && (
        <div style={{ display: "flex", flexDirection: "column" }}>
          <span
            style={{
              fontSize: size > 28 ? "1.05rem" : "0.9375rem",
              fontWeight: 800,
              letterSpacing: "-0.03em",
              color: "var(--text-primary)",
              lineHeight: 1.15,
            }}
          >
            Fikra
          </span>
          {subtitle && (
            <span
              style={{
                fontSize: "0.6875rem",
                fontWeight: 600,
                color: "var(--text-muted)",
                letterSpacing: "0.04em",
                textTransform: "uppercase",
                marginTop: 2,
              }}
            >
              {subtitle}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
