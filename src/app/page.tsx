"use client";

import Link from "next/link";
import { useState, useEffect, useRef, useCallback } from "react";
import styles from "./landing.module.css";
import { FikraLogo } from "@/components/FikraLogo";

const HERO_MODELS = [
  "Llama 3.1 8B",
  "Mistral 7B",
  "Gemma 2 9B",
  "Phi-3 Mini",
  "Qwen2 7B",
  "DeepSeek-R1",
  "CodeLlama 13B",
  "Falcon 7B",
];

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
  { value: "100",  label: "Free Credits at Signup" },
  { value: "< 2min", label: "Avg Setup Time" },
  { value: "99.9%", label: "Platform Uptime" },
];

const MODEL_SHOWCASE = [
  {
    name: "Llama 3",
    icon: "/models/llama.svg",
  },
  {
    name: "Mistral",
    icon: "/models/mistral.svg",
  },
  {
    name: "Gemma 2",
    icon: "/models/gemma.svg",
  },
  {
    name: "Qwen 2",
    icon: "/models/qwen.svg",
  },
  {
    name: "DeepSeek",
    icon: "/models/deepseek.svg",
  },
  {
    name: "Phi-3",
    icon: "/models/phi.svg",
  },
  {
    name: "Zephyr",
    icon: "/models/huggingface.svg",
  },
];

const LOG_LINES = [
  { text: "✓ Dataset validated (1,240 rows)", type: "success" },
  { text: "→ LoRA adapters initialized", type: "info" },
  { text: "  Epoch 1/3 — loss: 1.42", type: "dim" },
  { text: "  Epoch 2/3 — loss: 0.87", type: "dim" },
  { text: "  Epoch 3/3 — loss: 0.61", type: "dim" },
  { text: "✓ Model saved to storage", type: "success" },
  { text: "✓ Ready to deploy or download", type: "success" },
];

export default function LandingPage() {
  const [scrolled, setScrolled] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [modelIdx, setModelIdx] = useState(0);
  const [visibleLogs, setVisibleLogs] = useState(0);
  const [progressWidth, setProgressWidth] = useState(0);
  const heroCardRef = useRef<HTMLDivElement>(null);
  
  // Marquee drag and scroll state
  const marqueeRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [startX, setStartX] = useState(0);
  const [startScrollLeft, setStartScrollLeft] = useState(0);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Cycle through model names
  useEffect(() => {
    const t = setInterval(() => setModelIdx((i) => (i + 1) % HERO_MODELS.length), 2400);
    return () => clearInterval(t);
  }, []);

  // Animate log lines appearing one by one
  useEffect(() => {
    if (visibleLogs < LOG_LINES.length) {
      const t = setTimeout(() => setVisibleLogs((v) => v + 1), 600);
      return () => clearTimeout(t);
    }
  }, [visibleLogs]);

  // Animate progress bar
  useEffect(() => {
    const t = setTimeout(() => setProgressWidth(100), 400);
    return () => clearTimeout(t);
  }, []);

  // Infinite Auto-Scroll Logic
  useEffect(() => {
    let animationId: number;
    const animate = () => {
      if (marqueeRef.current && !isDragging && !isHovered) {
        marqueeRef.current.scrollLeft += 0.5; // Auto-scroll speed
        
        // Seamless loop checking (3 identical sets rendered)
        // We reset when scroll reaches 1/3 of total scroll width
        const singleSetWidth = marqueeRef.current.scrollWidth / 3;
        if (marqueeRef.current.scrollLeft >= singleSetWidth) {
          marqueeRef.current.scrollLeft -= singleSetWidth;
        } else if (marqueeRef.current.scrollLeft <= 0) {
          // In case they drag backwards past 0
          marqueeRef.current.scrollLeft += singleSetWidth;
        }
      }
      animationId = requestAnimationFrame(animate);
    };
    animationId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animationId);
  }, [isDragging, isHovered]);

  // Drag handlers for marquee
  const handleMouseDown = (e: React.MouseEvent) => {
    if (!marqueeRef.current) return;
    setIsDragging(true);
    setStartX(e.pageX - marqueeRef.current.offsetLeft);
    setStartScrollLeft(marqueeRef.current.scrollLeft);
  };
  const handleMouseLeave = () => {
    setIsDragging(false);
    setIsHovered(false);
  };
  const handleMouseUp = () => setIsDragging(false);
  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging || !marqueeRef.current) return;
    e.preventDefault();
    const x = e.pageX - marqueeRef.current.offsetLeft;
    const walk = (x - startX) * 1.5; // Drag speed multiplier
    marqueeRef.current.scrollLeft = startScrollLeft - walk;
  };

  // Intersection observer for scroll-reveal
  const observeReveal = useCallback((node: HTMLElement | null) => {
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add(styles.revealed);
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.15 }
    );
    // Observe all children with [data-reveal]
    node.querySelectorAll("[data-reveal]").forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  return (
    <div className={styles.page}>

      {/* ── Navbar ── */}
      <nav className={`${styles.nav} ${scrolled || mobileNavOpen ? styles.navScrolled : ""}`}>
        <div className={styles.navInner}>
          <div className={styles.navLogo}>
            <FikraLogo size={28} showText />
          </div>
          <div className={styles.navLinks}>
            <a href="#features"    className={styles.navLink}>Features</a>
            <a href="#how-it-works" className={styles.navLink}>How It Works</a>
            <a href="#pricing"     className={styles.navLink}>Pricing</a>
          </div>
          <div className={styles.navActions}>
            <Link href="/auth/signin" className="btn btn-ghost btn-sm">Sign In</Link>
            <Link href="/auth/signup" className="btn btn-primary btn-sm">Get Started Free</Link>
          </div>
          <button
            className={styles.mobileNavToggle}
            onClick={() => setMobileNavOpen(!mobileNavOpen)}
            aria-label="Toggle navigation menu"
          >
            {mobileNavOpen ? (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 12h18M3 6h18M3 18h18"/></svg>
            )}
          </button>
        </div>

        {/* Mobile dropdown */}
        {mobileNavOpen && (
          <div className={styles.mobileNavMenu}>
            <a href="#features"    className={styles.mobileNavLink} onClick={() => setMobileNavOpen(false)}>Features</a>
            <a href="#how-it-works" className={styles.mobileNavLink} onClick={() => setMobileNavOpen(false)}>How It Works</a>
            <a href="#pricing"     className={styles.mobileNavLink} onClick={() => setMobileNavOpen(false)}>Pricing</a>
            <div className={styles.mobileNavDivider} />
            <div className={styles.mobileNavActions}>
              <Link href="/auth/signin" className="btn btn-secondary btn-sm" onClick={() => setMobileNavOpen(false)} style={{ width: "100%", justifyContent: "center" }}>Sign In</Link>
              <Link href="/auth/signup" className="btn btn-primary btn-sm"   onClick={() => setMobileNavOpen(false)} style={{ width: "100%", justifyContent: "center" }}>Get Started Free</Link>
            </div>
          </div>
        )}
      </nav>

      {/* ── Hero ── */}
      <section className={styles.hero}>
        {/* Subtle ambient glow */}
        <div className={styles.heroOrb1} />

        {/* Centered copy */}
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
            Fikram is the platform where experts create AI assistants powered by their
            own knowledge. Upload your content, get an intelligent assistant in seconds —
            or train a fully custom model.
          </p>

          {/* Animated model ticker */}
          <div className={styles.modelTicker}>
            <span className={styles.modelTickerLabel}>Supports</span>
            <span key={modelIdx} className={styles.modelTickerName}>
              {HERO_MODELS[modelIdx]}
            </span>
            <span className={styles.modelTickerSuffix}>and 500+ more</span>
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

        {/* Full-width visual card below */}
        <div className={styles.heroVisual} ref={heroCardRef}>
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
                <span className={styles.heroCardValue}>
                  <span key={modelIdx} className={styles.valueSwap}>{HERO_MODELS[modelIdx]}</span>
                </span>
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
                  <span className={styles.heroCardValue}>{progressWidth}%</span>
                </div>
                <div className="progress-bar">
                  <div
                    className="progress-fill"
                    style={{
                      width: `${progressWidth}%`,
                      transition: "width 2.5s cubic-bezier(0.4, 0, 0.2, 1)",
                    }}
                  />
                </div>
              </div>

              <div className={styles.heroLogs}>
                {LOG_LINES.map((line, i) => (
                  <span
                    key={i}
                    className={`terminal-line ${line.type} ${styles.logLine}`}
                    style={{
                      opacity: i < visibleLogs ? 1 : 0,
                      transform: i < visibleLogs ? "translateY(0)" : "translateY(8px)",
                      transition: `opacity 0.4s ease ${i * 0.05}s, transform 0.4s ease ${i * 0.05}s`,
                    }}
                  >
                    {line.text}
                  </span>
                ))}
                {visibleLogs < LOG_LINES.length && (
                  <span className={styles.cursor}>▋</span>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Model Ecosystem Showcase ── */}
      <section className={styles.showcaseSection} ref={observeReveal}>
        <div className={styles.showcaseGlow} />
        <div className="container">
          <div className={styles.sectionHead} data-reveal>
            <span className="section-label">Ecosystem</span>
            <h2>Built on the world&apos;s best<br />open-source models</h2>
            <p>Fine-tune or deploy from the leading model providers — all from one unified platform.</p>
          </div>

          <div 
            className={`${styles.marqueeContainer} ${isDragging ? styles.isDragging : ''}`}
            ref={marqueeRef}
            onMouseDown={handleMouseDown}
            onMouseLeave={handleMouseLeave}
            onMouseUp={handleMouseUp}
            onMouseMove={handleMouseMove}
            onMouseEnter={() => setIsHovered(true)}
            data-reveal
          >
            {/* Duplicate for infinite seamless scrolling */}
            {[...MODEL_SHOWCASE, ...MODEL_SHOWCASE, ...MODEL_SHOWCASE].map((m, i) => (
              <div
                key={`${m.name}-${i}`}
                className={styles.showcaseCard}
              >
                <div className={styles.showcaseCardInner}>
                  <div className={styles.showcaseIconRing}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={m.icon}
                      alt={m.name}
                      className={styles.showcaseIcon}
                      loading="lazy"
                      width={36}
                      height={36}
                    />
                  </div>
                  <span className={styles.showcaseName}>{m.name}</span>
                </div>
              </div>
            ))}
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
      <section id="features" className="section" ref={observeReveal}>
        <div className="container">
          <div className={styles.sectionHead} data-reveal>
            <span className="section-label">Features</span>
            <h2>Everything you need to<br />build your expert AI</h2>
            <p>
              From document to deployed assistant in seconds —
              Fikram handles the complexity so you can focus on your expertise.
            </p>
          </div>

          <div className={styles.featuresGrid}>
            {FEATURES.map((f, i) => (
              <div key={f.title} className={`${styles.featureCard} ${styles.revealItem}`} data-reveal style={{ transitionDelay: `${i * 0.08}s` }}>
                <div className={styles.featureIconWrap}>{f.icon}</div>
                <span className="badge badge-gradient" style={{ marginBottom: 14 }}>{f.badge}</span>
                <h4 style={{ marginBottom: 10 }}>{f.title}</h4>
                <p style={{ fontSize: "0.9375rem" }}>{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── How It Works ── */}
      <section id="how-it-works" className={`section ${styles.howSection}`} ref={observeReveal}>
        <div className="container">
          <div className={styles.sectionHead} data-reveal>
            <span className="section-label">How It Works</span>
            <h2>Three steps to your<br />custom AI model</h2>
            <p>No ML expertise. No infrastructure headaches. Just describe your goal and let our AI do the heavy lifting.</p>
          </div>

          <div className={styles.stepsGrid}>
            {STEPS.map((s, i) => (
              <div key={s.num} className={`${styles.stepCard} ${styles.revealItem}`} data-reveal style={{ transitionDelay: `${i * 0.12}s` }}>
                <div className={styles.stepNum}>{s.num}</div>
                <h3 style={{ fontSize: "1.25rem", marginBottom: 14, marginTop: 18, fontFamily: "var(--font-display)" }}>{s.title}</h3>
                <p style={{ fontSize: "0.9375rem" }}>{s.desc}</p>
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
            <h2 style={{ marginTop: 18 }}>Start free.<br />Scale when you&apos;re ready.</h2>
            <p style={{ marginTop: 18, fontSize: "1.0625rem" }}>
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

            <Link href="/auth/signup" className="btn btn-primary btn-lg" style={{ marginTop: 40 }}>
              Create Free Account
            </Link>

            <p style={{ marginTop: 18, fontSize: "0.8rem", color: "var(--text-muted)" }}>
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
                <FikraLogo size={32} showText />
              </div>
              <p className={styles.footerTagline}>
                The platform where experts build AI assistants powered by their own knowledge.
              </p>
            </div>
            <div className={styles.footerLinks}>
              <div className={styles.footerCol}>
                <div className={styles.footerColTitle}>Product</div>
                <a href="#features"    className={styles.footerLink}>Features</a>
                <a href="#how-it-works" className={styles.footerLink}>How It Works</a>
                <a href="#pricing"     className={styles.footerLink}>Pricing</a>
              </div>
              <div className={styles.footerCol}>
                <div className={styles.footerColTitle}>Account</div>
                <Link href="/auth/signup" className={styles.footerLink}>Sign Up</Link>
                <Link href="/auth/signin" className={styles.footerLink}>Sign In</Link>
              </div>
            </div>
          </div>
          <div className={styles.footerBottom}>
            <span>© 2026 Fikram. All rights reserved.</span>
            <span style={{ color: "var(--text-disabled)", fontSize: "0.8125rem" }}>
              Built for experts, by experts.
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}
