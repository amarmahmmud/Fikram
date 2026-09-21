"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, RotateCcw, Home } from "lucide-react";
import { FikraLogo } from "@/components/FikraLogo";

export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Root application error:", error);
  }, [error]);

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 24,
        padding: 32,
        textAlign: "center",
        background: "var(--bg, #090A0F)",
        position: "relative",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: "20%",
          left: "50%",
          transform: "translateX(-50%)",
          width: 400,
          height: 300,
          background:
            "radial-gradient(ellipse, rgba(239, 68, 68, 0.08) 0%, transparent 70%)",
          pointerEvents: "none",
          filter: "blur(40px)",
        }}
      />

      <FikraLogo size={36} showText />

      <div
        style={{
          width: 56,
          height: 56,
          borderRadius: "50%",
          background: "rgba(239, 68, 68, 0.12)",
          border: "1px solid rgba(239, 68, 68, 0.25)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--error, #EF4444)",
          marginTop: 8,
        }}
      >
        <AlertTriangle size={28} />
      </div>

      <div>
        <h1
          style={{
            fontSize: "1.5rem",
            fontWeight: 700,
            color: "var(--text-primary, #F8FAFC)",
            marginBottom: 8,
          }}
        >
          Something went wrong
        </h1>
        <p
          style={{
            color: "var(--text-muted, #94A3B8)",
            fontSize: "0.9375rem",
            maxWidth: 420,
            lineHeight: 1.6,
          }}
        >
          {error.message ||
            "An unexpected error occurred while loading this page. Our team has been notified."}
        </p>
        {error.digest && (
          <code
            style={{
              display: "inline-block",
              marginTop: 10,
              fontSize: "0.75rem",
              color: "var(--text-muted, #94A3B8)",
              background: "rgba(255, 255, 255, 0.05)",
              padding: "4px 8px",
              borderRadius: 6,
              fontFamily: "monospace",
            }}
          >
            Digest: {error.digest}
          </code>
        )}
      </div>

      <div style={{ display: "flex", gap: 12, marginTop: 8 }}>
        <button
          onClick={() => reset()}
          className="btn btn-primary"
          style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
        >
          <RotateCcw size={16} /> Try Again
        </button>
        <Link
          href="/"
          className="btn btn-secondary"
          style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
        >
          <Home size={16} /> Home
        </Link>
      </div>
    </div>
  );
}
