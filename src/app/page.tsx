"use client";

import Link from "next/link";
import { useState, useEffect, useRef, useCallback } from "react";
import styles from "./landing.module.css";
import { FikraLogo } from "@/components/FikraLogo";

const HERO_USE_CASES = [
  "Medical Consultants",
  "Legal Advisors",
  "Fitness Coaches",
  "Course Creators",
  "Financial Analysts",
  "Tech Support Teams",
  "Real Estate Agents",
  "Marketing Strategists",
];

const FEATURES = [
  {
    badge: "Instant Setup",
    title: "Knowledge Base in 30 Seconds",
    desc: "Upload your PDFs, documents, or course materials. Our AI automatically extracts, indexes, and makes your knowledge searchable.",
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
        <polyline points="13 2 13 9 20 9" />
      </svg>
    )
  },
  {
    badge: "Citations",
    title: "Answers You Can Trust",
    desc: "Every response is grounded in your actual content with source citations. No hallucinations — just accurate, verifiable answers.",
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z" />
        <path d="m9 12 2 2 4-4" />
      </svg>
    )
  },
  {
    badge: "Multimodal",
    title: "Beyond Text — Images, Audio & Video",
    desc: "Upload images, audio files, or video content. Your RAG AI Expert understands and answers questions across all media types.",
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect width="18" height="18" x="3" y="3" rx="2" />
        <circle cx="9" cy="9" r="2" />
        <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
      </svg>
    )
  },
  {
    badge: "Privacy",
    title: "Your Data, Your AI",
    desc: "Your content stays private and secure. Each RAG AI Expert is isolated to your account with enterprise-grade encryption.",
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
      </svg>
    )
  }
];

const STEPS = [
  {
    num: "01",
    title: "Upload Your Content",
    desc: "Drop your PDFs, images, audio, or video files. Our AI extracts and indexes every piece of knowledge automatically.",
  },
  {
    num: "02",
    title: "AI Builds Your Knowledge Base",
    desc: "In under 30 seconds, your content is transformed into a searchable knowledge base with intelligent embeddings.",
  },
  {
    num: "03",
    title: "Chat & Share",
    desc: "Ask your AI anything about your content. Get accurate, citation-backed answers instantly. Share it with your audience.",
  },
];

const FRONTIER_MODELS = [
  { name: "Llama 3", icon: "/models/llama.svg" },
  { name: "Mistral", icon: "/models/mistral.svg" },
  { name: "Command R", icon: "/models/cohere.svg" },
  { name: "DBRX", icon: "/models/dbrx.svg" },
  { name: "DeepSeek", icon: "/models/deepseek.svg" },
  { name: "Yi", icon: "/models/yi.svg" },
  { name: "Zephyr", icon: "/models/huggingface.svg" },
];

const LIGHTWEIGHT_MODELS = [
  { name: "Phi-3", icon: "/models/phi.svg" },
  { name: "Gemma 2", icon: "/models/gemma.svg" },
  { name: "Qwen 2", icon: "/models/qwen.svg" },
  { name: "Stable LM", icon: "/models/stability.svg" },
  { name: "Solar", icon: "/models/upstage.svg" },
  { name: "Baichuan", icon: "/models/baichuan.svg" },
  { name: "Ollama", icon: "/models/ollama.svg" },
];

const STATS = [
  { value: "30s", label: "Avg Setup Time" },
  { value: "50", label: "Free Credits at Signup" },
  { value: "∞", label: "Document Types" },
  { value: "100%", label: "Citation-Backed" }
];

const LOG_LINES = [
  { text: '✓ Uploaded "nutrition-guide.pdf" (42 pages)', type: "success" },
  { text: "→ Extracting and embedding knowledge...", type: "info" },
  { text: "  127 knowledge chunks indexed", type: "dim" },
  { text: '? "What foods are best for recovery?"', type: "info" },
  { text: "  Found 3 relevant sources...", type: "dim" },
  { text: "✓ Answer generated with citations [p.12, p.34]", type: "success" },
  { text: "✓ RAG AI Expert ready to share", type: "success" },
];

function MarqueeRow({ items, direction = 1 }: { items: typeof FRONTIER_MODELS, direction?: number }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollPos = useRef(0);
  const isDragging = useRef(false);
  const dragStartX = useRef(0);
  const dragStartScroll = useRef(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    // Seed starting position
    if (direction === -1) {
      el.scrollLeft = el.scrollWidth / 3;
    }
    scrollPos.current = el.scrollLeft;

    let rafId: number;
    const tick = () => {
      if (!isDragging.current) {
        scrollPos.current += 0.7 * direction;
        const third = el.scrollWidth / 3;

        if (direction === 1) {
          if (scrollPos.current >= third * 2) scrollPos.current -= third;
          else if (scrollPos.current < 0) scrollPos.current += third;
        } else {
          if (scrollPos.current <= 0) scrollPos.current += third;
          else if (scrollPos.current >= third * 2) scrollPos.current -= third;
        }

        // Direct DOM write — no React re-render
        el.scrollLeft = scrollPos.current;
      }
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [direction]); // ← only direction, never restarts due to drag changes

  const onMouseDown = (e: React.MouseEvent) => {
    isDragging.current = true;
    dragStartX.current = e.pageX;
    dragStartScroll.current = scrollPos.current;
    containerRef.current?.classList.add(styles.isDragging);
  };

  const onMouseUp = () => {
    isDragging.current = false;
    containerRef.current?.classList.remove(styles.isDragging);
  };

  const onMouseLeave = () => {
    isDragging.current = false;
    containerRef.current?.classList.remove(styles.isDragging);
  };

  const onMouseMove = (e: React.MouseEvent) => {
    if (!isDragging.current || !containerRef.current) return;
    e.preventDefault();
    const walk = (e.pageX - dragStartX.current) * 1.5;
    scrollPos.current = dragStartScroll.current - walk;
    containerRef.current.scrollLeft = scrollPos.current;
  };

  return (
    <div
      className={styles.marqueeContainer}
      ref={containerRef}
      onMouseDown={onMouseDown}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseLeave}
      onMouseMove={onMouseMove}
      data-reveal
    >
      {[...items, ...items, ...items].map((m, i) => (
        <div key={`${m.name}-${i}`} className={styles.showcaseCard}>
          <div className={styles.showcaseCardInner}>
            <div className={styles.showcaseIconRing}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={m.icon} alt={m.name} className={styles.showcaseIcon} loading="lazy" width={36} height={36} />
            </div>
            <span className={styles.showcaseName}>{m.name}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function LandingPage() {
  const [scrolled, setScrolled] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [useCaseIdx, setUseCaseIdx] = useState(0);
  const [visibleLogs, setVisibleLogs] = useState(0);
  const [progressWidth, setProgressWidth] = useState(0);
  const heroCardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const t = setInterval(() => setUseCaseIdx((i) => (i + 1) % HERO_USE_CASES.length), 2400);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (visibleLogs < LOG_LINES.length) {
      const t = setTimeout(() => setVisibleLogs((v) => v + 1), 600);
      return () => clearTimeout(t);
    }
  }, [visibleLogs]);

  useEffect(() => {
    const t = setTimeout(() => setProgressWidth(100), 400);
    return () => clearTimeout(t);
  }, []);

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
    node.querySelectorAll("[data-reveal]").forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  return (
    <div className={styles.page}>
      <nav className={`${styles.nav} ${scrolled || mobileNavOpen ? styles.navScrolled : ""}`}>
        <div className={styles.navInner}>
          <div className={styles.navLogo}>
            <FikraLogo size={28} showText />
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
          <button
            className={styles.mobileNavToggle}
            onClick={() => setMobileNavOpen(!mobileNavOpen)}
            aria-label="Toggle navigation menu"
          >
            {mobileNavOpen ? (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 12h18M3 6h18M3 18h18" /></svg>
            )}
          </button>
        </div>

        {/* Mobile dropdown */}
        {mobileNavOpen && (
          <div className={styles.mobileNavMenu}>
            <a href="#features" className={styles.mobileNavLink} onClick={() => setMobileNavOpen(false)}>Features</a>
            <a href="#how-it-works" className={styles.mobileNavLink} onClick={() => setMobileNavOpen(false)}>How It Works</a>
            <a href="#pricing" className={styles.mobileNavLink} onClick={() => setMobileNavOpen(false)}>Pricing</a>
            <div className={styles.mobileNavDivider} />
            <div className={styles.mobileNavActions}>
              <Link href="/auth/signin" className="btn btn-secondary btn-sm" onClick={() => setMobileNavOpen(false)} style={{ width: "100%", justifyContent: "center" }}>Sign In</Link>
              <Link href="/auth/signup" className="btn btn-primary btn-sm" onClick={() => setMobileNavOpen(false)} style={{ width: "100%", justifyContent: "center" }}>Get Started Free</Link>
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
            Upload your documents, and get an intelligent RAG AI Expert powered by your
            own knowledge — ready in seconds. No code, no ML expertise needed.
          </p>

          {/* Animated use-case ticker */}
          <div className={styles.modelTicker}>
            <span className={styles.modelTickerLabel}>Built for</span>
            <span key={useCaseIdx} className={styles.modelTickerName}>
              {HERO_USE_CASES[useCaseIdx]}
            </span>
            <span className={styles.modelTickerSuffix}>and many more</span>
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
            No credit card required · 50 free credits · Ready in 30 seconds
          </p>
        </div>

        {/* Full-width visual card below */}
        <div className={styles.heroVisual} ref={heroCardRef}>
          <div className={styles.heroCard}>
            <div className={styles.heroCardHeader}>
              <div className="terminal-dot red" />
              <div className="terminal-dot yellow" />
              <div className="terminal-dot green" />
              <span className={styles.heroCardTitle}>RAG AI Expert — Live Demo</span>
              <span className="badge badge-success" style={{ marginLeft: "auto" }}>
                <span className="status-dot done" />
                Ready
              </span>
            </div>
            <div className={styles.heroCardBody}>
              <div className={styles.heroCardRow}>
                <span className={styles.heroCardLabel}>RAG Expert</span>
                <span className={styles.heroCardValue}>
                  <span key={useCaseIdx} className={styles.valueSwap}>{HERO_USE_CASES[useCaseIdx]}</span>
                </span>
              </div>
              <div className={styles.heroCardRow}>
                <span className={styles.heroCardLabel}>Knowledge Base</span>
                <span className={styles.heroCardValue}>42 pages indexed</span>
              </div>
              <div className={styles.heroCardRow}>
                <span className={styles.heroCardLabel}>Accuracy</span>
                <span className={styles.heroCardValue}>Citation-backed</span>
              </div>
              <div className={styles.heroCardRow}>
                <span className={styles.heroCardLabel}>Media Support</span>
                <span className={styles.heroCardValue}>PDF, Images, Audio, Video</span>
              </div>
              <div className={styles.heroCardRow}>
                <span className={styles.heroCardLabel}>Credits used</span>
                <span className={styles.heroCardValue}>6 / 50</span>
              </div>

              <div className={styles.heroProgressSection}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                  <span className={styles.heroCardLabel}>Knowledge Indexed</span>
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

      {/* ── Coming Soon: Fine-Tuning Teaser ── */}
      <section className={styles.showcaseSection} ref={observeReveal}>
        <div className={styles.showcaseGlow} />
        <div className="container">
          <div className={styles.sectionHead} data-reveal>
            <span className="section-label">Coming Soon</span>
            <h2>Custom AI Model Training<br />is on the way</h2>
            <p>Train models that capture your unique voice and expertise using LoRA fine-tuning on GPU clusters. Stay tuned.</p>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '30px' }}>
            <div>
              <div style={{ paddingLeft: '24px', marginBottom: '12px', opacity: 0.6, fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '1px' }}>Supported Model Providers</div>
              <MarqueeRow items={FRONTIER_MODELS} direction={1} />
            </div>
            <div>
              <div style={{ paddingLeft: '24px', marginBottom: '12px', opacity: 0.6, fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '1px' }}>Lightweight & Edge Models</div>
              <MarqueeRow items={LIGHTWEIGHT_MODELS} direction={-1} />
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
      <section id="features" className="section" ref={observeReveal}>
        <div className="container">
          <div className={styles.sectionHead} data-reveal>
            <span className="section-label">Features</span>
            <h2>Everything you need to<br />build your expert AI</h2>
            <p>
              From document to deployed RAG AI Expert in seconds —
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
            <h2>Three steps to your<br />RAG AI Expert</h2>
            <p>No ML expertise. No infrastructure headaches. Upload your content and start chatting in seconds.</p>
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
              Get 50 free credits when you sign up — enough to create your first RAG AI Expert
              and chat 45+ times. No credit card. No commitment.
            </p>

            <div className={styles.pricingFeatures}>
              {[
                "50 free credits on signup",
                "Upload PDFs, images, audio & video",
                "Citation-backed AI answers",
                "Multimodal chat support",
                "Private knowledge base",
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
              Pro plans with more credits & custom model training coming soon. Early users get priority access.
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
                The platform where experts build RAG AI Experts powered by their own knowledge.
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
