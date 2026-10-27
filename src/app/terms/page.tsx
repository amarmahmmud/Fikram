import type { Metadata } from "next";
import Link from "next/link";
import { FikraLogo } from "@/components/FikraLogo";

export const metadata: Metadata = {
  title: "Terms of Service — Fikram",
  description: "Read the Terms of Service for using the Fikram platform.",
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

export default function TermsPage() {
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
            Terms of Service
          </h1>
          <p style={{ color: "var(--text-secondary, #8b8b9e)", fontSize: "0.9375rem" }}>
            Last updated: October 2026
          </p>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 40 }}>
          <Section title="1. Acceptance of Terms">
            <p>By accessing or using <strong>Fikram</strong> at <a href="https://fikram.live" style={{ color: "#a78bfa" }}>fikram.live</a>, you agree to be bound by these Terms of Service. If you do not agree, please do not use our platform.</p>
          </Section>

          <Section title="2. Description of Service">
            <p>Fikram is a RAG-as-a-Service platform that allows users to create AI Experts powered by their own uploaded knowledge. Features include document ingestion, semantic search, and AI-powered Q&A — with fine-tuning capabilities coming soon.</p>
          </Section>

          <Section title="3. Account Registration">
            <ul>
              <li>You must be at least 13 years old to use Fikram.</li>
              <li>You are responsible for maintaining the security of your account credentials.</li>
              <li>You must provide accurate and complete information when creating your account.</li>
              <li>You are responsible for all activity that occurs under your account.</li>
            </ul>
          </Section>

          <Section title="4. Acceptable Use">
            <p>You agree not to use Fikram to:</p>
            <ul>
              <li>Upload content that is illegal, harmful, abusive, or violates third-party rights.</li>
              <li>Attempt to reverse-engineer, hack, or disrupt the platform.</li>
              <li>Use the platform to generate spam, misinformation, or malicious content.</li>
              <li>Resell or sublicense access to Fikram without written permission.</li>
              <li>Upload copyrighted content you do not have the right to use.</li>
            </ul>
          </Section>

          <Section title="5. Credits and Payments">
            <ul>
              <li>Fikram operates on a credit-based system. Credits are consumed when using AI features.</li>
              <li>Free accounts receive 50 credits upon registration.</li>
              <li>Paid plans and credit top-ups are processed via Polar. All payments are subject to Polar's terms.</li>
              <li>Credits are non-refundable once consumed.</li>
              <li>Subscription cancellations take effect at the end of the billing period.</li>
            </ul>
          </Section>

          <Section title="6. Your Content">
            <ul>
              <li>You retain full ownership of all content you upload to Fikram.</li>
              <li>By uploading content, you grant Fikram a limited license to process it solely to provide the service to you.</li>
              <li>We do not use your content to train general AI models or share it with other users.</li>
              <li>You are solely responsible for the content you upload and its compliance with applicable laws.</li>
            </ul>
          </Section>

          <Section title="7. Intellectual Property">
            <p>The Fikram platform, including its design, code, and AI infrastructure, is owned by Fikram and protected by applicable intellectual property laws. You may not copy, modify, or distribute any part of the platform without explicit written permission.</p>
          </Section>

          <Section title="8. Service Availability">
            <p>We strive to maintain high availability but do not guarantee uninterrupted service. We may perform maintenance, updates, or experience downtime. We are not liable for losses resulting from service interruptions.</p>
          </Section>

          <Section title="9. Limitation of Liability">
            <p>To the maximum extent permitted by law, Fikram shall not be liable for any indirect, incidental, special, or consequential damages arising from your use of or inability to use the platform. Our total liability shall not exceed the amount you paid to Fikram in the 12 months preceding the claim.</p>
          </Section>

          <Section title="10. Termination">
            <p>We reserve the right to suspend or terminate your account if you violate these terms. You may delete your account at any time. Upon termination, your data will be handled in accordance with our Privacy Policy.</p>
          </Section>

          <Section title="11. Changes to Terms">
            <p>We may update these Terms from time to time. We will notify you of significant changes. Continued use of Fikram after changes constitutes your acceptance of the updated Terms.</p>
          </Section>

          <Section title="12. Governing Law">
            <p>These Terms are governed by applicable laws. Any disputes shall be resolved in good faith through direct communication before pursuing legal action.</p>
          </Section>

          <Section title="13. Contact Us">
            <p>For questions, support, or partnership inquiries regarding these Terms:</p>
            <ul>
              <li><strong>Support & Customer Care:</strong> <a href="mailto:support@fikram.live" style={{ color: "#a78bfa" }}>support@fikram.live</a></li>
              <li><strong>Founders & Legal Office:</strong> <a href="mailto:founder@fikram.live" style={{ color: "#a78bfa" }}>founder@fikram.live</a></li>
              <li><strong>Official Website:</strong> <a href="https://fikram.live" style={{ color: "#a78bfa" }}>fikram.live</a></li>
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
        <span>© 2026 Fikram. All rights reserved. · Contact: </span>
        <a href="mailto:support@fikram.live" style={{ color: "#a78bfa", textDecoration: "none" }}>support@fikram.live</a>
        <span> · </span>
        <Link href="/privacy" style={{ color: "#a78bfa", textDecoration: "none" }}>Privacy Policy</Link>
        <span> · </span>
        <Link href="/terms" style={{ color: "#a78bfa", textDecoration: "none" }}>Terms of Service</Link>
      </footer>
    </div>
  );
}
