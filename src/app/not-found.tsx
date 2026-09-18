import Link from "next/link";
import { FikraLogo } from "@/components/FikraLogo";

export default function NotFound() {
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
        background: "var(--bg)",
      }}
    >
      {/* Ambient glow */}
      <div
        style={{
          position: "absolute",
          top: "15%",
          left: "50%",
          transform: "translateX(-50%)",
          width: 400,
          height: 300,
          background:
            "radial-gradient(ellipse, rgba(0,229,200,0.06) 0%, transparent 70%)",
          pointerEvents: "none",
          filter: "blur(40px)",
        }}
      />

      <FikraLogo size={36} showText />

      <div
        style={{
          fontSize: "5rem",
          fontWeight: 900,
          fontFamily: "var(--font-display, 'Outfit', sans-serif)",
          background: "linear-gradient(135deg, #00E5C8, #C77DFF)",
          WebkitBackgroundClip: "text",
          WebkitTextFillColor: "transparent",
          lineHeight: 1,
          marginTop: 8,
        }}
      >
        404
      </div>

      <div>
        <h1
          style={{
            fontSize: "1.35rem",
            fontWeight: 700,
            color: "var(--text-primary)",
            marginBottom: 8,
          }}
        >
          Page not found
        </h1>
        <p
          style={{
            color: "var(--text-muted)",
            fontSize: "0.9375rem",
            maxWidth: 400,
            lineHeight: 1.6,
          }}
        >
          The page you&apos;re looking for doesn&apos;t exist or may have been
          moved. Let&apos;s get you back on track.
        </p>
      </div>

      <div style={{ display: "flex", gap: 12, marginTop: 8 }}>
        <Link href="/dashboard" className="btn btn-primary">
          Go to Dashboard
        </Link>
        <Link href="/" className="btn btn-secondary">
          Back to Home
        </Link>
      </div>
    </div>
  );
}
