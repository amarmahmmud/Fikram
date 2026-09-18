"use client";

import { useEffect } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";

export default function ModelsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Models page error:", error);
  }, [error]);

  return (
    <div className="page-content" style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "50vh", gap: "16px", textAlign: "center" }}>
      <div style={{ width: 48, height: 48, borderRadius: "50%", background: "rgba(239, 68, 68, 0.1)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--error)" }}>
        <AlertTriangle size={24} />
      </div>
      <div>
        <h2 style={{ fontSize: "1.2rem", fontWeight: 600, marginBottom: "8px" }}>Something went wrong</h2>
        <p style={{ color: "var(--text-muted)", fontSize: "0.9rem", maxWidth: "400px" }}>
          {error.message || "We encountered an error loading this page. Please try again."}
        </p>
      </div>
      <button onClick={() => reset()} className="btn btn-secondary" style={{ marginTop: "8px", gap: "8px" }}>
        <RotateCcw size={16} /> Try again
      </button>
    </div>
  );
}
