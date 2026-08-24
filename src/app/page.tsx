"use client";

import Link from "next/link";
import { useState, useEffect } from "react";
import styles from "./landing.module.css";
import { MODELS as MODEL_REGISTRY } from "@/lib/models";

const FEATURES = [
  {
    icon: "◆",
    title: "Smart Assistants",
    desc: "Upload your content and get an AI assistant that answers questions with source citations — ready in seconds, no training needed.",
    badge: "Recommended",
  },
  {
    icon: "◈",
    title: "Custom Model Training",
    desc: "Fine-tune open-source LLMs on your data to create models that capture your unique voice, style, and expertise.",
    badge: "Premium",
  },
  {
    icon: "▣",
    title: "500+ Base Models",
    desc: "Choose from Llama, Mistral, Gemma, Phi, and hundreds more open-source models as your foundation.",
    badge: "Open Source",
  },
  {
    icon: "◎",
    title: "Source Citations",
    desc: "Every answer from Smart Assistants includes citations showing exactly which part of your content the answer came from.",
    badge: "Grounded",
  },
  {
    icon: "▧",
    title: "Private & Secure",
    desc: "Your data and models are encrypted at rest. Training jobs run in isolated containers. Your content stays yours.",
    badge: "Enterprise Ready",
  },
  {
    icon: "◇",
    title: "Credit-Based Pricing",
    desc: "Smart Assistants are free to create. Fine-tuning uses credits — start with 100 free, pay only for what you use.",
    badge: "Free to Start",
  },
];

const STEPS = [
  {
    num: "01",
    title: "Upload Your Content",
    desc: "Drop your PDFs, documents, or course materials. Our system extracts and indexes your knowledge automatically.",
  },
  {
    num: "02",
    title: "Choose Your Approach",
    desc: "Create a Smart Assistant for instant, accurate Q&A — or train a Custom Model for a fully personalized AI.",
  },
  {
    num: "03",
    title: "Publish & Share",
    desc: "Your AI is ready. Share it with your audience, embed it on your site, or keep it private for your team.",
  },
];

const STATS = [
  { value: "500+", label: "Supported Models" },
  { value: "100", label: "Free Credits at Signup" },
  { value: "< 2min", label: "Avg Setup Time" },
  { value: "99.9%", label: "Platform Uptime" },
];

const MODELS = MODEL_REGISTRY.filter((m) => m.popular || m.recommended).map((m) => m.name);

export default function LandingPage() {
  const [scrolled, setScrolled] = useState(false);
  const [modelIdx, setModelIdx] = useState(0);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const t = setInterval(() => setModelIdx((i) => (i + 1) % MODELS.length), 2000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className={styles.page}>
      {/* ── Navbar ── */}
      <nav className={`${styles.nav} ${scrolled ? styles.navScrolled : ""}`}>
        <div className={styles.navInner}>
          <div className={styles.navLogo}>
            <div className={styles.navLogoMark}>F</div>
            <span className={styles.navLogoText}>Fikra</span>
          </div>
          <div className={styles.navLinks}>
            <a href="#features" className={styles.navLink}>Features</a>
            <a href="#how-it-works" className={styles.navLink}>How It Works</a>
            <a href="#pricing" className={styles.navLink}>Pricing</a>
          </div>
          <div className={styles.navActions}>
            <Link href="/auth/signin" className="btn btn-ghost btn-sm">Sign In</Link>
            <Link href="/auth/signup" className="btn btn-primary btn-sm">Get Started Free</Link>
          </div>
        </div>
      </nav>

      {/* ── Hero ── */}
      <section className={styles.hero}>
        <div className={styles.heroGlow} />
        <div className={styles.heroGrid} />

        <div className={styles.heroContent}>
          <div className={styles.heroBadge}>
            <span className={styles.heroBadgeDot} />
            Now in Beta — Free to Start
          </div>

          <h1 className={styles.heroHeadline}>
            Turn your expertise into<br />
            <span className="text-gradient">an AI that knows it all</span>
          </h1>

          <p className={styles.heroSubline}>
            Fikra is the platform where experts create AI assistants powered by their
            own knowledge. Upload your content, get an intelligent assistant in seconds —
            or train a fully custom model.
          </p>

          <div className={styles.heroModelTicker}>
            <span className={styles.heroTickerLabel}>Powering experts on:</span>
            <span className={styles.heroTickerModel}>{MODELS[modelIdx]}</span>
          </div>

          <div className={styles.heroCta}>
            <Link href="/auth/signup" className="btn btn-primary btn-lg">
              Get Started Free
            </Link>
            <a href="#how-it-works" className="btn btn-secondary btn-lg">
              How It Works
            </a>
          </div>

          <p className={styles.heroNote}>
            No credit card required · Smart Assistants are free · Cancel anytime
          </p>
        </div>

        {/* Hero visual: fake terminal card */}
        <div className={styles.heroVisual}>
          <div className={styles.heroCard}>
            <div className={styles.heroCardHeader}>
              <div className="terminal-dot red" />
              <div className="terminal-dot yellow" />
              <div className="terminal-dot green" />
              <span className={styles.heroCardTitle}>Fine-Tuning Job #1847</span>
              <span className="badge badge-success" style={{ marginLeft: "auto" }}>
                <span className="status-dot done" />
                Completed
              </span>
            </div>
            <div className={styles.heroCardBody}>
              <div className={styles.heroCardRow}>
                <span className={styles.heroCardLabel}>Base Model</span>
                <span className={styles.heroCardValue}>Llama 3.1 8B</span>
              </div>
              <div className={styles.heroCardRow}>
                <span className={styles.heroCardLabel}>Method</span>
                <span className={styles.heroCardValue}>LoRA (auto-selected)</span>
              </div>
              <div className={styles.heroCardRow}>
                <span className={styles.heroCardLabel}>Dataset</span>
                <span className={styles.heroCardValue}>1,240 examples</span>
              </div>
              <div className={styles.heroCardRow}>
                <span className={styles.heroCardLabel}>Training time</span>
                <span className={styles.heroCardValue}>14 min 32s</span>
              </div>
              <div className={styles.heroCardRow}>
                <span className={styles.heroCardLabel}>Credits used</span>
                <span className={styles.heroCardValue}>28 / 100</span>
              </div>

              <div className={styles.heroProgressSection}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                  <span className={styles.heroCardLabel}>Training Progress</span>
                  <span className={styles.heroCardValue}>100%</span>
                </div>
                <div className="progress-bar">
                  <div className="progress-fill" style={{ width: "100%" }} />
                </div>
              </div>

              <div className={styles.heroLogs}>
                <span className="terminal-line success">✓ Dataset validated (1,240 rows)</span>
                <span className="terminal-line info">→ LoRA adapters initialized</span>
                <span className="terminal-line dim">  Epoch 1/3 — loss: 1.42</span>
                <span className="terminal-line dim">  Epoch 2/3 — loss: 0.87</span>
                <span className="terminal-line dim">  Epoch 3/3 — loss: 0.61</span>
                <span className="terminal-line success">✓ Model saved to storage</span>
                <span className="terminal-line success">✓ Ready to deploy or download</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Stats ── */}
      <section className={styles.statsSection}>
        <div className="container">
          <div className={styles.statsGrid}>
            {STATS.map((s) => (
              <div key={s.label} className={styles.statItem}>
                <div className={styles.statValue}>{s.value}</div>
                <div className={styles.statLabel}>{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Features ── */}
      <section id="features" className="section">
        <div className="container">
          <div className={styles.sectionHead}>
            <span className="section-label">Features</span>
            <h2>Everything you need to<br />build your expert AI</h2>
            <p>
              From document to deployed assistant in seconds —
              Fikra handles the complexity so you can focus on your expertise.
            </p>
          </div>

          <div className={styles.featuresGrid}>
            {FEATURES.map((f) => (
              <div key={f.title} className={`card card-hover card-gradient ${styles.featureCard}`}>
                <div className={styles.featureIcon}>{f.icon}</div>
                <span className="badge badge-indigo" style={{ marginBottom: 12 }}>{f.badge}</span>
                <h4>{f.title}</h4>
                <p style={{ fontSize: "0.875rem", marginTop: 8 }}>{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── How It Works ── */}
      <section id="how-it-works" className={`section ${styles.howSection}`}>
        <div className={styles.howGlow} />
        <div className="container">
          <div className={styles.sectionHead}>
            <span className="section-label">How It Works</span>
            <h2>Three steps to your<br />custom AI model</h2>
            <p>No ML expertise. No infrastructure headaches. Just describe your goal and let our AI do the heavy lifting.</p>
          </div>

          <div className={styles.stepsGrid}>
            {STEPS.map((s, i) => (
              <div key={s.num} className={styles.stepCard}>
                <div className={styles.stepNum}>{s.num}</div>
                <div className={styles.stepConnector} style={{ display: i < STEPS.length - 1 ? "block" : "none" }} />
                <h3 style={{ fontSize: "1.125rem", marginBottom: 12, marginTop: 16 }}>{s.title}</h3>
                <p style={{ fontSize: "0.875rem" }}>{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Pricing / CTA ── */}
      <section id="pricing" className="section">
        <div className="container-sm">
          <div className={styles.pricingCard}>
            <div className={styles.pricingGlow} />
            <span className="section-label">Pricing</span>
            <h2 style={{ marginTop: 16 }}>Start free.<br />Scale when you&apos;re ready.</h2>
            <p style={{ marginTop: 16, fontSize: "1rem" }}>
              Get 100 free credits when you sign up — enough to fine-tune 2–3 real models.
              No credit card. No commitment.
            </p>

            <div className={styles.pricingFeatures}>
              {[
                "100 free credits on signup",
                "AI-guided fine-tuning wizard",
                "Llama, Mistral, Phi & more",
                "Real-time training logs",
                "Download model weights",
                "No credit card required",
              ].map((f) => (
                <div key={f} className={styles.pricingFeature}>
                  <span className={styles.pricingCheck}>✓</span>
                  {f}
                </div>
              ))}
            </div>

            <Link href="/auth/signup" className="btn btn-primary btn-lg" style={{ marginTop: 32 }}>
              Create Free Account
            </Link>

            <p style={{ marginTop: 16, fontSize: "0.8125rem", color: "var(--text-muted)" }}>
              Paid plans with more credits coming soon. Early users get priority access.
            </p>
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className={styles.footer}>
        <div className="container">
          <div className={styles.footerTop}>
            <div className={styles.footerBrand}>
              <div className={styles.footerLogo}>
                <div className={styles.navLogoMark}>F</div>
                <span className={styles.navLogoText}>Fikra</span>
              </div>
              <p style={{ fontSize: "0.875rem", maxWidth: 280 }}>
                The platform where experts build AI assistants powered by their own knowledge.
              </p>
            </div>
            <div className={styles.footerLinks}>
              <div className={styles.footerCol}>
                <div className={styles.footerColTitle}>Product</div>
                <a href="#features" className={styles.footerLink}>Features</a>
                <a href="#how-it-works" className={styles.footerLink}>How It Works</a>
                <a href="#pricing" className={styles.footerLink}>Pricing</a>
              </div>
              <div className={styles.footerCol}>
                <div className={styles.footerColTitle}>Account</div>
                <Link href="/auth/signup" className={styles.footerLink}>Sign Up</Link>
                <Link href="/auth/signin" className={styles.footerLink}>Sign In</Link>
              </div>
            </div>
          </div>
          <div className={styles.footerBottom}>
            <span>© 2026 Fikra. All rights reserved.</span>
            <span style={{ color: "var(--text-muted)", fontSize: "0.8125rem" }}>
              Built for experts, by experts.
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}
