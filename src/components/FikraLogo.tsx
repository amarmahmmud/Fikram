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
  // Generate unique IDs to avoid SVG gradient collisions when multiple logos are on the page
  const uid = React.useId().replace(/:/g, "");

  return (
    <div
      className={`fikra-logo-container ${className}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: size > 28 ? 12 : 8,
        textDecoration: "none",
      }}
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 36 36"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        style={{ flexShrink: 0 }}
      >
        <defs>
          {/* Background */}
          <linearGradient id={`${uid}-bg`} x1="0" y1="0" x2="36" y2="36" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#0a0a0c" />
            <stop offset="100%" stopColor="#000000" />
          </linearGradient>
          <linearGradient id={`${uid}-border`} x1="0" y1="0" x2="36" y2="36" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="rgba(255,255,255,0.15)" />
            <stop offset="100%" stopColor="rgba(0,229,200,0.3)" />
          </linearGradient>

          {/* Monogram gradients — cyan-teal to violet-magenta */}
          <linearGradient id={`${uid}-stem1`} x1="8" y1="9" x2="12" y2="29" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#00E5C8" />
            <stop offset="100%" stopColor="#00B39C" />
          </linearGradient>
          <linearGradient id={`${uid}-topbar`} x1="14" y1="9" x2="20" y2="13" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#00E5C8" />
            <stop offset="100%" stopColor="#5EE8D0" />
          </linearGradient>
          <linearGradient id={`${uid}-crossbar`} x1="14" y1="17" x2="20" y2="21" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#00D4B8" />
            <stop offset="100%" stopColor="#C77DFF" />
          </linearGradient>
          <linearGradient id={`${uid}-stem2`} x1="22" y1="17" x2="26" y2="29" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#C77DFF" />
            <stop offset="100%" stopColor="#A855F7" />
          </linearGradient>
          <linearGradient id={`${uid}-node`} x1="21" y1="8" x2="27" y2="14" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#FFFFFF" />
            <stop offset="100%" stopColor="#00E5C8" />
          </linearGradient>

          {/* Subtle glow filter */}
          <filter id={`${uid}-glow`} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="1.5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Squircle base */}
        <rect width="36" height="36" rx="10" fill={`url(#${uid}-bg)`} />
        <rect width="35" height="35" x="0.5" y="0.5" rx="9.5" stroke={`url(#${uid}-border)`} strokeWidth="1" />

        {/* F+A Monogram with glow */}
        <g filter={`url(#${uid}-glow)`}>
          {/* Left stem (F) */}
          <rect x="8" y="9" width="4" height="20" rx="2" fill={`url(#${uid}-stem1)`} />
          {/* Top bar (F) */}
          <rect x="14" y="9" width="6" height="4" rx="2" fill={`url(#${uid}-topbar)`} />
          {/* Crossbar (F/A junction) */}
          <rect x="14" y="17" width="6" height="4" rx="2" fill={`url(#${uid}-crossbar)`} />
          {/* Right stem (A) */}
          <rect x="22" y="17" width="4" height="12" rx="2" fill={`url(#${uid}-stem2)`} />
          {/* Apex node (A) */}
          <circle cx="24" cy="11" r="2.5" fill={`url(#${uid}-node)`} />
        </g>
      </svg>

      {showText && (
        <div style={{ display: "flex", flexDirection: "column" }}>
          <span
            style={{
              fontSize: size > 28 ? "1.1rem" : "0.9375rem",
              fontWeight: 800,
              letterSpacing: "-0.04em",
              color: "var(--text-primary)",
              lineHeight: 1.15,
              fontFamily: "var(--font-display)",
            }}
          >
            Fikram
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
