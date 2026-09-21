"use client";

import { useEffect } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Global application error:", error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          background: "#090A0F",
          color: "#F8FAFC",
          fontFamily:
            "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
          display: "flex",
          minHeight: "100vh",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
          boxSizing: "border-box",
        }}
      >
        <div
          style={{
            maxWidth: 440,
            width: "100%",
            textAlign: "center",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 20,
          }}
        >
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
              color: "#EF4444",
            }}
          >
            <AlertTriangle size={28} />
          </div>

          <div>
            <h1
              style={{
                fontSize: "1.5rem",
                fontWeight: 700,
                margin: "0 0 8px 0",
              }}
            >
              Application Error
            </h1>
            <p
              style={{
                color: "#94A3B8",
                fontSize: "0.9375rem",
                lineHeight: 1.6,
                margin: 0,
              }}
            >
              A critical error occurred while rendering the application root. Please
              refresh or try again.
            </p>
          </div>

          <button
            onClick={() => reset()}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "10px 20px",
              background: "#00E5C8",
              color: "#000",
              border: "none",
              borderRadius: 8,
              fontSize: "0.9375rem",
              fontWeight: 600,
              cursor: "pointer",
              marginTop: 4,
            }}
          >
            <RotateCcw size={16} /> Reload Application
          </button>
        </div>
      </body>
    </html>
  );
}
