import type { Metadata } from "next";
import Link from "next/link";
import { FikraLogo } from "@/components/FikraLogo";

export const metadata: Metadata = {
  title: "Privacy Policy — Fikram",
  description: "Learn how Fikram collects, uses, and protects your personal data.",
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 style={{
        fontSize: "1.125rem",
        fontWeight: 600,
        marginBottom: 16,
        paddingBottom: 12,
        borderBottom: "1px solid rgba(255,255,255,0.06)",
        fontFamily: "Outfit, sans-serif",
        color: "#e8e8f0",
      }}>
        {title}
      </h2>
      <div style={{
        color: "var(--text-secondary, #8b8b9e)",
        lineHeight: 1.8,
        fontSize: "0.9375rem",
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}>
        {children}
      </div>
    </section>
  );
}

export default function PrivacyPage() {
  return (
    <div style={{ minHeight: "100vh", background: "var(--bg-primary, #0a0a0f)", color: "var(--text-primary, #f0f0f5)" }}>
      <nav style={{
        borderBottom: "1px solid rgba(255,255,255,0.06)",
        padding: "16px 0",
        position: "sticky",
        top: 0,
        background: "rgba(10,10,15,0.85)",
        backdropFilter: "blur(16px)",
        zIndex: 100,
      }}>
        <div style={{ maxWidth: 800, margin: "0 auto", padding: "0 24px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <Link href="/" style={{ textDecoration: "none" }}>
            <FikraLogo size={28} showText />
          </Link>
          <Link href="/" style={{ color: "var(--text-secondary, #8b8b9e)", fontSize: "0.875rem", textDecoration: "none" }}>
            Back to Home
          </Link>
        </div>
      </nav>

      <main style={{ maxWidth: 800, margin: "0 auto", padding: "64px 24px 96px" }}>
        <div style={{ marginBottom: 48 }}>
          <div style={{
            display: "inline-block",
            background: "rgba(139,92,246,0.12)",
            border: "1px solid rgba(139,92,246,0.25)",
            color: "#a78bfa",
            borderRadius: 20,
            padding: "4px 14px",
            fontSize: "0.8rem",
            fontWeight: 500,
            marginBottom: 20,
          }}>Legal</div>
          <h1 style={{ fontSize: "2.5rem", fontWeight: 700, marginBottom: 16, fontFamily: "Outfit, sans-serif" }}>
            Privacy Policy
          </h1>
          <p style={{ color: "var(--text-secondary, #8b8b9e)", fontSize: "0.9375rem" }}>
            Last updated: September 21, 2026
          </p>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 40 }}>
          <Section title="1. Introduction">
            <p>Welcome to <strong>Fikram</strong>. We are committed to protecting your personal information. This policy explains how we collect, use, and safeguard your data when you use our platform at <a href="https://fikram.live" style={{ color: "#a78bfa" }}>fikram.live</a>.</p>
          </Section>

          <Section title="2. Information We Collect">
            <p>We collect information you provide directly:</p>
            <ul>
              <li><strong>Account info:</strong> Name, email when signing up via Google OAuth or email.</li>
              <li><strong>Uploaded content:</strong> Documents, PDFs, audio, video used to build RAG AI Experts.</li>
              <li><strong>Usage data:</strong> Platform interactions, features used, queries made.</li>
              <li><strong>Payment info:</strong> Processed securely via Polar. We do not store raw card data.</li>
            </ul>
          </Section>

          <Section title="3. How We Use Your Information">
            <ul>
              <li>To provide and improve the Fikram platform.</li>
              <li>To process payments and manage your subscription or credits.</li>
              <li>To power your RAG AI Experts using your uploaded content.</li>
              <li>To send important service notifications.</li>
              <li>To detect and prevent fraud or abuse.</li>
            </ul>
          </Section>

          <Section title="4. Your Content & Data Isolation">
            <p>Your uploaded content is <strong>private by default</strong>. Each RAG AI Expert is isolated to your account. We do not use your content to train general models or share it with other users.</p>
          </Section>

          <Section title="5. Third-Party Services">
            <p>We use trusted providers to operate Fikram:</p>
            <ul>
              <li><strong>Supabase</strong> — Authentication and database.</li>
              <li><strong>Polar</strong> — Payment and subscription processing.</li>
              <li><strong>Google</strong> — OAuth login and AI APIs.</li>
              <li><strong>Vercel</strong> — Hosting and deployment.</li>
            </ul>
          </Section>

          <Section title="6. Data Retention">
            <p>We retain your data as long as your account is active. You may request deletion at any time. Backups may persist for up to 30 days after deletion.</p>
          </Section>

          <Section title="7. Cookies">
            <p>We use cookies to maintain your session and improve your experience. You can control cookies through your browser settings.</p>
          </Section>

          <Section title="8. Your Rights">
            <p>You may have the right to access, correct, or delete your personal data. Contact us at <a href="mailto:amarsuadbusiness@gmail.com" style={{ color: "#a78bfa" }}>amarsuadbusiness@gmail.com</a> to exercise these rights.</p>
          </Section>

          <Section title="9. Security">
            <p>We implement industry-standard security including encryption in transit (TLS) and at rest.</p>
          </Section>

          <Section title="10. Changes to This Policy">
            <p>We may update this policy from time to time. Continued use of Fikram after changes constitutes acceptance of the updated policy.</p>
          </Section>

          <Section title="11. Contact Us">
            <ul>
              <li><strong>Email:</strong> <a href="mailto:amarsuadbusiness@gmail.com" style={{ color: "#a78bfa" }}>amarsuadbusiness@gmail.com</a></li>
              <li><strong>Website:</strong> <a href="https://fikram.live" style={{ color: "#a78bfa" }}>fikram.live</a></li>
            </ul>
          </Section>
        </div>
      </main>

      <footer style={{
        borderTop: "1px solid rgba(255,255,255,0.06)",
        padding: "24px",
        textAlign: "center",
        color: "var(--text-muted, #555568)",
        fontSize: "0.8125rem",
      }}>
        <span>© 2026 Fikram. All rights reserved. · </span>
        <Link href="/privacy" style={{ color: "#a78bfa", textDecoration: "none" }}>Privacy Policy</Link>
        <span> · </span>
        <Link href="/terms" style={{ color: "#a78bfa", textDecoration: "none" }}>Terms of Service</Link>
      </footer>
    </div>
  );
}
