"use client";

import Link from "next/link";
import { useState, useEffect, useRef, useCallback } from "react";
import styles from "./landing.module.css";
import { FikraLogo } from "@/components/FikraLogo";
import {
  Check,
  X,
  ChevronDown,
  Globe,
  FileText,
  Sparkles,
  Shield,
  Zap,
  Layers,
  ArrowRight,
  Video,
  FileSearch,
  Languages,
  CheckCircle2,
  Lock,
} from "lucide-react";

// ── Hero Use-Case Rotation ──
const HERO_USE_CASES = [
  "Quranic & Islamic Scholars",
  "Legal & Regulatory Counsel",
  "Medical & Clinical Researchers",
  "University Educators & Course Creators",
  "Technical Support & Engineering Teams",
  "Financial & Investment Analysts",
  "Executive Strategy Consultants",
  "Global Multilingual Organizations",
];

// ── 140+ Multilingual RAG Showcase Data ──
type LangCategory = "arabic" | "asian" | "european" | "african";

interface LanguageItem {
  name: string;
  native: string;
  flag: string;
  tag: string;
  detail: string;
}

const LANGUAGES_DATA: Record<LangCategory, { title: string; items: LanguageItem[] }> = {
  arabic: {
    title: "Arabic & Regional Dialects",
    items: [
      { name: "Classical Arabic (Fusha)", native: "العربية الفصحى التراثية", flag: "📖", tag: "Full Tashkeel RAG", detail: "Diacritic-tolerant semantic search & citations" },
      { name: "Modern Standard Arabic", native: "العربية الفصحى المعاصرة", flag: "🌐", tag: "Document OCR", detail: "Formal legal, academic & financial texts" },
      { name: "Egyptian Arabic", native: "اللهجة المصرية", flag: "🇪🇬", tag: "Audio & Video", detail: "Transcribes lectures & conversational audio" },
      { name: "Gulf & Saudi Arabic", native: "اللهجة الخليجية", flag: "🇸🇦", tag: "Audio & Video", detail: "Local regulatory terminology & speech" },
      { name: "Levantine (Shami)", native: "اللهجة الشامية", flag: "🇱🇧", tag: "Audio & Video", detail: "Jordanian, Syrian, Lebanese & Palestinian" },
      { name: "Maghrebi (North African)", native: "الدارجة المغربية", flag: "🇲🇦", tag: "Cross-Lingual", detail: "Moroccan, Algerian & Tunisian documents" },
      { name: "Sudanese Arabic", native: "اللهجة السودانية", flag: "🇸🇩", tag: "Audio & Docs", detail: "Academic literature & recorded lectures" },
      { name: "Yemeni Arabic", native: "اللهجة اليمنية", flag: "🇾🇪", tag: "Classical Texts", detail: "Traditional manuscripts & scanned books" },
    ],
  },
  asian: {
    title: "Asian & South Asian Languages",
    items: [
      { name: "Urdu", native: "اردو", flag: "🇵🇰", tag: "Nastaliq & Urdu Docs", detail: "Complex script OCR & cross-lingual search" },
      { name: "Bahasa Indonesia", native: "Bahasa Indonesia", flag: "🇮🇩", tag: "Full Multimodal", detail: "Government decrees, education & audio" },
      { name: "Bahasa Melayu", native: "Bahasa Melayu", flag: "🇲🇾", tag: "Full Multimodal", detail: "Academic literature & recorded seminars" },
      { name: "Bengali", native: "বাংলা", flag: "🇧🇩", tag: "Complex Script", detail: "Sub-continental text & audio comprehension" },
      { name: "Hindi", native: "हिन्दी", flag: "🇮🇳", tag: "Devanagari OCR", detail: "Dense document extraction & video RAG" },
      { name: "Mandarin Chinese", native: "简体中文", flag: "🇨🇳", tag: "Vision & OCR", detail: "High-density technical manuals & charts" },
      { name: "Japanese", native: "日本語", flag: "🇯🇵", tag: "Vision & OCR", detail: "Vertical text, diagrams & slide decks" },
      { name: "Korean", native: "한국어", flag: "🇰🇷", tag: "Multimodal RAG", detail: "High-speed semantic search & citations" },
    ],
  },
  european: {
    title: "European & Global Languages",
    items: [
      { name: "English (US, UK, Global)", native: "English", flag: "🇬🇧", tag: "Full Multimodal", detail: "Sub-second Groq streaming & vision" },
      { name: "French", native: "Français", flag: "🇫🇷", tag: "Full Multimodal", detail: "Legal treatises, contracts & lecture audio" },
      { name: "Spanish", native: "Español", flag: "🇪🇸", tag: "Full Multimodal", detail: "Latin American & European publications" },
      { name: "German", native: "Deutsch", flag: "🇩🇪", tag: "Compound Words", detail: "Compound noun parsing & dense research" },
      { name: "Turkish", native: "Türkçe", flag: "🇹🇷", tag: "Agglutinative", detail: "Ottoman history & modern legal codes" },
      { name: "Russian", native: "Русский", flag: "🇷🇺", tag: "Cyrillic OCR", detail: "Scanned research papers & technical docs" },
      { name: "Italian", native: "Italiano", flag: "🇮🇹", tag: "Full Multimodal", detail: "Academic archives & audio interviews" },
      { name: "Portuguese", native: "Português", flag: "🇧🇷", tag: "Full Multimodal", detail: "Brazilian & European documentation" },
    ],
  },
  african: {
    title: "Middle Eastern & African Languages",
    items: [
      { name: "Persian (Farsi)", native: "فارسی", flag: "🇮🇷", tag: "Perso-Arabic", detail: "Manuscripts, literature & historical files" },
      { name: "Swahili", native: "Kiswahili", flag: "🇰🇪", tag: "East African", detail: "Regional policy, education & audio memos" },
      { name: "Hausa", native: "Harshen Hausa", flag: "🇳🇬", tag: "West African", detail: "Islamic scholarship & local transcripts" },
      { name: "Somali", native: "Af-Soomaali", flag: "🇸🇴", tag: "Oral & Text", detail: "Recorded oral lectures & modern documents" },
      { name: "Kurdish (Sorani & Kurmanji)", native: "کوردی", flag: "☀️", tag: "Dialect Support", detail: "Bilingual documentation & audio notes" },
      { name: "Amharic", native: "አማርኛ", flag: "🇪🇹", tag: "Ge'ez Script", detail: "Ethiopian script OCR & knowledge retrieval" },
      { name: "Pashto", native: "پښتو", flag: "🇦🇫", tag: "Regional Dialects", detail: "Central Asian archives & transcripts" },
      { name: "Uzbek", native: "Oʻzbekcha", flag: "🇺🇿", tag: "Dual Alphabet", detail: "Latin & Cyrillic dual-alphabet RAG" },
    ],
  },
};

// ── 6 Proprietary RAG Unfair Advantages ──
const ADVANTAGES = [
  {
    badge: "Full-Spectrum Multimodal Ingestion",
    title: "Video, Audio, Scanned OCR & PDFs",
    desc: "Don't settle for simple text copy-paste. Upload MP4 lecture videos, MP3 audio recordings, scanned books via Google Document AI OCR, and diagrams. Fikram automatically transcribes, segments, and indexes every frame and page.",
    icon: <Video size={24} />,
    tag: "Video · Audio · OCR · PDF",
  },
  {
    badge: "Document Architecture",
    title: "Section-Aware Hierarchical Chunking",
    desc: "Naive RAG chops text blindly every 500 characters, severing sentences and mixing topics. Fikram detects document headings, chapter titles, and numbered legal/academic clauses, guaranteeing zero fragmented context.",
    icon: <Layers size={24} />,
    tag: "Heading & Clause Preserving",
  },
  {
    badge: "Verifiable Accuracy",
    title: "100% Citation Grounding — Zero Hallucinations",
    desc: "Every answer is strictly anchored with clickable citations: exact page numbers ([p. 18]), media timestamps ([12:45]), and source preview snippets. Never wonder if your AI is making things up.",
    icon: <Shield size={24} />,
    tag: "Page & Timestamp Proofs",
  },
  {
    badge: "Global Reach",
    title: "140+ Multilingual & Cross-Lingual RAG",
    desc: "Ask questions in English or Urdu, and Fikram retrieves facts from Arabic, French, or Turkish documents, synthesizing the answer in your chosen language. Seamless diacritic handling for classical Arabic.",
    icon: <Languages size={24} />,
    tag: "Cross-Lingual Semantic Search",
  },
  {
    badge: "Intelligent Retrieval",
    title: "Adaptive Top-K & Live Web Search Grounding",
    desc: "Broad queries ('summarize all', 'list every') automatically pull more context for exhaustive overviews, while factual queries pull high-precision chunks. Augmented with real-time Google Web Search when needed.",
    icon: <FileSearch size={24} />,
    tag: "Dynamic Top-K + Web Search",
  },
  {
    badge: "Enterprise Security",
    title: "Private Tenant Isolation in pgvector",
    desc: "Your knowledge base is partitioned using PostgreSQL row-level tenant security. Your proprietary documents, transcripts, and recordings are encrypted and never used to train public foundation models.",
    icon: <Lock size={24} />,
    tag: "pgvector · Private Tenant",
  },
];

// ── Comparison Matrix Data ──
const COMPARISON_ROWS = [
  {
    feature: "Full-Spectrum Multimodal Ingestion",
    sub: "Direct upload of Video (MP4), Audio (WAV/MP3), Scanned Books (OCR), and PDFs",
    fikram: "Yes (Automatic transcription, OCR & indexing)",
    generic: "Partial (Text & basic images only)",
    cloudDiy: "Complex custom pipeline required",
  },
  {
    feature: "Section-Aware Hierarchical Chunking",
    sub: "Splits on headings, chapters, and numbered clauses instead of blind character cuts",
    fikram: "Yes (Preserves structure & section titles)",
    generic: "No (Fixed character chunking)",
    cloudDiy: "Requires custom parser coding",
  },
  {
    feature: "140+ Multilingual & Cross-Lingual RAG",
    sub: "Ask in one language, retrieve and synthesize from documents written in another",
    fikram: "Yes (140+ languages pre-trained)",
    generic: "Limited / Basic translation",
    cloudDiy: "Requires multiple translation models",
  },
  {
    feature: "Scanned Paper & Book OCR Quality",
    sub: "High-accuracy OCR for scanned manuscripts, double-column books, and tables",
    fikram: "Google Document AI OCR Engine",
    generic: "Fails or scrambles dense text",
    cloudDiy: "Separate AWS Textract / DocAI cost",
  },
  {
    feature: "Verifiable Page & Timestamp Citations",
    sub: "Clickable exact page numbers ([p. 18]) and video timestamps ([04:22]) with source previews",
    fikram: "Yes (Exact [p.X] & [t:ss] previews)",
    generic: "Vague / Prone to hallucinations",
    cloudDiy: "Requires complex custom RAG dev",
  },
  {
    feature: "Adaptive Top-K & Live Web Grounding",
    sub: "Expands retrieval depth for summaries + real-time Google Web Search fallback",
    fikram: "Built-in Adaptive Top-K + Web Search",
    generic: "Static top-K (Misses broader context)",
    cloudDiy: "Requires custom reranking pipeline",
  },
  {
    feature: "Time to First Working Assistant",
    sub: "From raw media upload to shareable, interactive AI assistant",
    fikram: "Under 30 Seconds",
    generic: "5 - 15 Minutes",
    cloudDiy: "Weeks of engineering & devops",
  },
  {
    feature: "Free Starter Tier",
    sub: "Immediate access to upload content and test without entering a credit card",
    fikram: "50 Free Credits on Signup",
    generic: "Restricted free tier / Paid Plus",
    cloudDiy: "Credit card required upfront",
  },
];

// ── Live Polar Pricing Tiers ──
const PRICING_TIERS = [
  {
    name: "Starter",
    price: "$0",
    period: "forever free",
    desc: "Perfect for testing Fikram with your first documents, recordings, and audio files.",
    credits: "50 Free Credits on Signup",
    highlight: false,
    cta: "Start Free Now",
    ctaLink: "/auth/signup",
    features: [
      "50 free credits instantly credited",
      "1 intelligent knowledge assistant",
      "PDF, image, and audio transcription",
      "100% citation-backed verification",
      "Access to 140+ language models",
      "No credit card required",
    ],
  },
  {
    name: "Pro",
    price: "$19",
    period: "/ month",
    desc: "For professionals, educators, and creators who need unlimited knowledge bases and full video ingestion.",
    credits: "2,000 Monthly Credits",
    highlight: true,
    badge: "Most Popular",
    cta: "Upgrade to Pro",
    ctaLink: "/credits",
    features: [
      "2,000 monthly credits included",
      "Unlimited knowledge assistants",
      "Full video lecture & audio ingestion",
      "Google Document AI OCR for scanned books",
      "Section-aware hierarchical chunking",
      "Cross-lingual search across 140+ languages",
      "Sub-second Groq Llama 3 streaming",
      "Shareable assistant public links",
    ],
  },
  {
    name: "Business",
    price: "$79",
    period: "/ month",
    desc: "For institutions, research labs, and enterprises requiring dedicated throughput and multi-seat workspaces.",
    credits: "10,000 Monthly Credits",
    highlight: false,
    cta: "Get Business Plan",
    ctaLink: "/credits",
    features: [
      "10,000 monthly credits included",
      "Dedicated Google Vertex AI enterprise throughput",
      "Multi-seat team workspace & permissions",
      "Highest priority embedding & inference queue",
      "Custom domain & white-label embedding",
      "API & Webhook programmatic access",
      "Private pgvector tenant isolation",
      "Dedicated onboarding & SLA support",
    ],
  },
];

// ── Interactive FAQ ──
const FAQS = [
  {
    q: "How does Fikram's multimodal RAG work across 140+ languages?",
    a: "Fikram uses 768-dimensional multimodal embeddings paired with Groq and Gemini multilingual foundation models. When you upload content in any of the 140+ supported languages (Arabic, Urdu, French, Spanish, Bahasa, Turkish, etc.), the engine normalizes scripts, handles diacritics (like Arabic Tashkeel), and builds a semantic map. You can ask a question in English, and Fikram will seamlessly retrieve the answer from an Arabic or French document and reply in the language you requested.",
  },
  {
    q: "What file formats can I upload into my assistant's knowledge base?",
    a: "You can upload PDFs, Word documents, scanned paper books (via Google Document AI OCR), high-resolution diagrams and charts (via Gemini Flash vision), audio recordings (MP3, WAV, M4A, OGG), video lectures (MP4, WebM), and web URLs. Fikram automatically transcribes, segments, and indexes every piece of content.",
  },
  {
    q: "What is section-aware chunking and why does it beat standard RAG?",
    a: "Standard RAG slices text into arbitrary character blocks (e.g. 500 characters), which frequently cuts sentences in half and mixes unrelated paragraphs together. Fikram analyzes the structural hierarchy of your documents (chapters, headers, subheadings, and numbered legal/academic clauses) before chunking. Each chunk preserves its section title and tier, ensuring the AI assistant understands the exact structural context of every passage.",
  },
  {
    q: "How do citations work for video, audio, and scanned PDFs?",
    a: "Every response generated by Fikram includes clickable citation badges. For PDFs and scanned books, clicking a citation shows the exact page number ([p. 18]) and snippet. For video lectures and audio recordings, the citation anchors to the exact timestamp ([12:45]), allowing you or your users to jump straight to that moment in the media.",
  },
  {
    q: "How do credits work and what is included in the 50 free credits?",
    a: "Credits power AI processing: 1 credit per question answered, and ~1 credit per knowledge chunk embedded. The 50 free credits you receive at signup allow you to index a multi-page document or recording and chat with your assistant 40+ times with zero commitment and no credit card required.",
  },
  {
    q: "Is my uploaded proprietary data safe and private?",
    a: "Yes. Each assistant's knowledge base is strictly isolated inside PostgreSQL using pgvector row-level tenant partitioning. Your uploaded documents, transcripts, and media are encrypted in transit and at rest, and are NEVER shared or used to train public foundation models.",
  },
];

const STEPS = [
  {
    num: "01",
    title: "Upload Any Document, Video, or Audio",
    desc: "Drop your PDFs, video lectures, voice memos, scanned books, or web URLs. Fikram's multimodal pipeline transcribes and parses every detail automatically.",
  },
  {
    num: "02",
    title: "Section-Aware Embedding in Under 30s",
    desc: "Your content is mapped into a vector knowledge base that preserves chapter headers, clauses, and timestamps without cutting sentences in half.",
  },
  {
    num: "03",
    title: "Chat with 100% Verified Citations",
    desc: "Ask any question and receive accurate answers with clickable page and timestamp proofs. Share your assistant via link or embed it anywhere.",
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
  { value: "140+", label: "Languages Supported" },
  { value: "30s", label: "Instant Setup Time" },
  { value: "50", label: "Free Signup Credits" },
  { value: "0.0%", label: "Hallucination Rate" },
];

const RAG_LOG_LINES = [
  { text: '✓ Ingested "fiqh-foundations.pdf" (64 pages) + "lecture-04.mp4" (48 mins)', type: "success" },
  { text: "→ Google Document AI OCR & Whisper speech transcription active...", type: "info" },
  { text: "  Section-aware chunking: 184 hierarchical sections indexed", type: "dim" },
  { text: '? "What are the core consensus rules on contracts discussed in Chapter 3?"', type: "info" },
  { text: "  Adaptive Top-K retrieval matched 4 high-confidence sources in pgvector...", type: "dim" },
  { text: "✓ Answer synthesized with exact citations [p. 18, p. 42, video 14:22]", type: "success" },
  { text: "✓ Assistant verified and ready to query or share publicly", type: "success" },
];

function MarqueeRow({ items, direction = 1 }: { items: typeof FRONTIER_MODELS; direction?: number }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollPos = useRef(0);
  const isDragging = useRef(false);
  const dragStartX = useRef(0);
  const dragStartScroll = useRef(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

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

        el.scrollLeft = scrollPos.current;
      }
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [direction]);

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
  const [selectedLangCategory, setSelectedLangCategory] = useState<LangCategory>("arabic");
  const [activeFaqIndex, setActiveFaqIndex] = useState<number | null>(0);
  const heroCardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const t = setInterval(() => setUseCaseIdx((i) => (i + 1) % HERO_USE_CASES.length), 2800);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setProgressWidth(100), 300);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (visibleLogs < RAG_LOG_LINES.length) {
      const t = setTimeout(() => setVisibleLogs((v) => v + 1), 500);
      return () => clearTimeout(t);
    }
  }, [visibleLogs]);

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
      { threshold: 0.12 }
    );
    node.querySelectorAll("[data-reveal]").forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  return (
    <div className={styles.page}>
      {/* ── Navigation Bar ── */}
      <nav className={`${styles.nav} ${scrolled || mobileNavOpen ? styles.navScrolled : ""}`}>
        <div className={styles.navInner}>
          <div className={styles.navLogo}>
            <FikraLogo size={28} showText />
          </div>
          <div className={styles.navLinks}>
            <a href="#languages" className={styles.navLink}>140+ Languages</a>
            <a href="#advantages" className={styles.navLink}>RAG Advantages</a>
            <a href="#comparison" className={styles.navLink}>Why Fikram</a>
            <a href="#how-it-works" className={styles.navLink}>How It Works</a>
            <a href="#pricing" className={styles.navLink}>Pricing</a>
            <a href="#faq" className={styles.navLink}>FAQ</a>
          </div>
          <div className={styles.navActions}>
            <Link href="/auth/signin" className="btn btn-ghost btn-sm">Sign In</Link>
            <Link href="/auth/signup" className="btn btn-primary btn-sm">
              <Sparkles size={14} style={{ marginRight: 6 }} />
              Get 50 Free Credits
            </Link>
          </div>
          <button
            className={styles.mobileNavToggle}
            onClick={() => setMobileNavOpen(!mobileNavOpen)}
            aria-label="Toggle navigation menu"
          >
            {mobileNavOpen ? (
              <X size={20} />
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 12h18M3 6h18M3 18h18" />
              </svg>
            )}
          </button>
        </div>

        {/* Mobile dropdown menu */}
        {mobileNavOpen && (
          <div className={styles.mobileNavMenu}>
            <a href="#languages" className={styles.mobileNavLink} onClick={() => setMobileNavOpen(false)}>140+ Languages</a>
            <a href="#advantages" className={styles.mobileNavLink} onClick={() => setMobileNavOpen(false)}>RAG Advantages</a>
            <a href="#comparison" className={styles.mobileNavLink} onClick={() => setMobileNavOpen(false)}>Why Fikram</a>
            <a href="#how-it-works" className={styles.mobileNavLink} onClick={() => setMobileNavOpen(false)}>How It Works</a>
            <a href="#pricing" className={styles.mobileNavLink} onClick={() => setMobileNavOpen(false)}>Pricing</a>
            <a href="#faq" className={styles.mobileNavLink} onClick={() => setMobileNavOpen(false)}>FAQ</a>
            <div className={styles.mobileNavDivider} />
            <div className={styles.mobileNavActions}>
              <Link href="/auth/signin" className="btn btn-secondary btn-sm" onClick={() => setMobileNavOpen(false)} style={{ width: "100%", justifyContent: "center" }}>Sign In</Link>
              <Link href="/auth/signup" className="btn btn-primary btn-sm" onClick={() => setMobileNavOpen(false)} style={{ width: "100%", justifyContent: "center" }}>Get Started Free (50 Credits)</Link>
            </div>
          </div>
        )}
      </nav>

      {/* ── Hero Section ── */}
      <section className={styles.hero}>
        <div className={styles.heroOrb1} />

        <div className={styles.heroContent}>
          <div className={styles.heroBadge}>
            <span className={styles.heroBadgeDot} />
            Multimodal Knowledge Intelligence · 140+ Languages
          </div>

          <h1 className={styles.heroHeadline}>
            Turn Any Document, Video, or Audio<br />
            <span className="text-gradient">into an AI That Truly Knows It All</span>
          </h1>

          <p className={styles.heroSubline}>
            Ingest PDFs, video lectures, voice notes, and scanned books.
            Our section-aware RAG preserves chapter context and provides 100% verified citations across 140+ languages.
            Zero hallucinations. Ready in 30 seconds.
          </p>

          <div className={styles.modelTicker}>
            <span className={styles.modelTickerLabel}>Trusted by</span>
            <span key={useCaseIdx} className={styles.modelTickerName}>
              {HERO_USE_CASES[useCaseIdx]}
            </span>
            <span className={styles.modelTickerSuffix}>worldwide</span>
          </div>

          <div className={styles.heroCta}>
            <Link href="/auth/signup" className="btn btn-primary btn-lg">
              <Sparkles size={18} style={{ marginRight: 8 }} />
              Start Free (50 Credits)
            </Link>
            <a href="#advantages" className="btn btn-secondary btn-lg">
              Explore RAG Features
            </a>
          </div>

          <p className={styles.heroNote}>
            No credit card required · Instant 50 credits · Upload video, audio, OCR &amp; PDFs in 30 seconds
          </p>
        </div>

        {/* Live Multimodal RAG Demo Card */}
        <div className={styles.heroVisual} ref={heroCardRef}>
          <div className={styles.heroCard}>
            <div className={styles.heroCardHeader}>
              <div className="terminal-dot red" />
              <div className="terminal-dot yellow" />
              <div className="terminal-dot green" />
              <span className={styles.heroCardTitle}>
                Multimodal RAG Engine — Live Knowledge Ingestion
              </span>
              <span className="badge badge-success" style={{ marginLeft: "auto" }}>
                <span className="status-dot done" />
                Ready
              </span>
            </div>

            <div className={styles.heroCardBody}>
              <div className={styles.heroCardRow}>
                <span className={styles.heroCardLabel}>Supported Ingestion</span>
                <span className={styles.heroCardValue}>Video (MP4), Audio (WAV/MP3), Scanned OCR, PDFs</span>
              </div>
              <div className={styles.heroCardRow}>
                <span className={styles.heroCardLabel}>Chunking Engine</span>
                <span className={styles.heroCardValue}>Section-Aware (Preserves Headings &amp; Chapters)</span>
              </div>
              <div className={styles.heroCardRow}>
                <span className={styles.heroCardLabel}>Verification</span>
                <span className={styles.heroCardValue}>Exact Page [p. 18] &amp; Video Timestamp [14:22]</span>
              </div>
              <div className={styles.heroCardRow}>
                <span className={styles.heroCardLabel}>Hallucination Rate</span>
                <span className={styles.heroCardValue} style={{ color: "#00E5C8", fontWeight: 700 }}>0.0% (Ground truth cited)</span>
              </div>

              <div className={styles.heroProgressSection}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                  <span className={styles.heroCardLabel}>Hierarchical Knowledge Indexing</span>
                  <span className={styles.heroCardValue}>{progressWidth}%</span>
                </div>
                <div className="progress-bar">
                  <div
                    className="progress-fill"
                    style={{
                      width: `${progressWidth}%`,
                      transition: "width 2.2s cubic-bezier(0.4, 0, 0.2, 1)",
                    }}
                  />
                </div>
              </div>

              <div className={styles.heroLogs}>
                {RAG_LOG_LINES.map((line, i) => (
                  <span
                    key={i}
                    className={`terminal-line ${line.type} ${styles.logLine}`}
                    style={{
                      opacity: i < visibleLogs ? 1 : 0,
                      transform: i < visibleLogs ? "translateY(0)" : "translateY(8px)",
                      transition: `opacity 0.35s ease ${i * 0.04}s, transform 0.35s ease ${i * 0.04}s`,
                    }}
                  >
                    {line.text}
                  </span>
                ))}
                {visibleLogs < RAG_LOG_LINES.length && <span className={styles.cursor}>▋</span>}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Stats Bar ── */}
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

      {/* ── Section: Global Reach & 140+ Languages for RAG ── */}
      <section id="languages" className={`section ${styles.langSection}`} ref={observeReveal}>
        <div className="container">
          <div className={styles.sectionHead} data-reveal>
            <span className="section-label">Global Language Intelligence</span>
            <h2>140+ Languages Supported for Multilingual<br />&amp; Cross-Lingual Knowledge Search</h2>
            <p>
              Upload documents, recorded lectures, or books in Arabic, Urdu, French, Spanish, Bahasa, or English.
              Ask in one language, search across documents in another. Fikram handles complex scripts, diacritics, and regional dialects effortlessly.
            </p>
          </div>

          {/* Category Tabs */}
          <div className={styles.langTabs} data-reveal>
            {(["arabic", "asian", "european", "african"] as LangCategory[]).map((cat) => (
              <button
                key={cat}
                className={`${styles.langTab} ${selectedLangCategory === cat ? styles.langTabActive : ""}`}
                onClick={() => setSelectedLangCategory(cat)}
              >
                <Globe size={16} />
                {LANGUAGES_DATA[cat].title}
              </button>
            ))}
          </div>

          {/* Languages Grid */}
          <div className={styles.langGrid} data-reveal>
            {LANGUAGES_DATA[selectedLangCategory].items.map((lang, idx) => (
              <div key={lang.name} className={styles.langCard} style={{ transitionDelay: `${idx * 0.04}s` }}>
                <div className={styles.langCardTop}>
                  <span className={styles.langFlag}>{lang.flag}</span>
                  <span className={styles.langTag}>{lang.tag}</span>
                </div>
                <div className={styles.langNative}>{lang.native}</div>
                <div className={styles.langEnglish}>{lang.name}</div>
                <div className={styles.langDetail}>{lang.detail}</div>
              </div>
            ))}
          </div>

          {/* Multilingual RAG Spotlight Card */}
          <div className={styles.langSpotlightCard} data-reveal>
            <div className={styles.langSpotlightGrid}>
              <div>
                <span className="badge badge-gradient" style={{ marginBottom: 12 }}>Proprietary Multilingual Pipeline</span>
                <h3 className={styles.langSpotlightHead}>
                  Why Standard RAG Fails at Complex Scripts — and How Fikram Solves It
                </h3>
                <p className={styles.langSpotlightText}>
                  Generic search engines choke on Arabic diacritics (Tashkeel), Urdu Nastaliq, and compound languages. They blindly slice sentences across arbitrary character limits and fail to match queries if word endings differ.
                  <br /><br />
                  Fikram uses <strong>768-dimensional multimodal embeddings with diacritic-tolerant semantic matching</strong>. You can ask a question in English or Urdu, and Fikram retrieves the precise truth from Arabic or French source documents with 100% verified citations.
                </p>
                <div className={styles.langPillsRow}>
                  <span className={styles.langPill}><Check size={14} /> Cross-Lingual Search</span>
                  <span className={styles.langPill}><Check size={14} /> Arabic Tashkeel Normalization</span>
                  <span className={styles.langPill}><Check size={14} /> Scanned Book OCR</span>
                  <span className={styles.langPill}><Check size={14} /> Nastaliq &amp; Devanagari Parsing</span>
                </div>
              </div>

              <div className={styles.langSimBox}>
                <div className={styles.simHeader}>
                  <span>CROSS-LINGUAL RETRIEVAL PREVIEW</span>
                  <span className={styles.simMatchTag}>COSINE SIMILARITY: 0.94</span>
                </div>
                <div className={styles.simRow}>
                  <span>User Query (English)</span>
                  <span style={{ color: "#fff" }}>&quot;What are the rules of compensation?&quot;</span>
                </div>
                <div className={styles.simRow}>
                  <span>Source Text (Arabic)</span>
                  <span style={{ color: "#00E5C8" }}>ضوابط التعويض في الفقه الإسلامي</span>
                </div>
                <div className={styles.simRow}>
                  <span>Document Anchor</span>
                  <span style={{ color: "#00E5C8" }}>fiqh-foundations.pdf [p. 18]</span>
                </div>
                <div className={styles.simRow}>
                  <span>Synthesized Answer</span>
                  <span style={{ color: "#00E5C8" }}>English response with [p. 18] badge</span>
                </div>
                <div style={{ marginTop: 14, paddingTop: 10, borderTop: "1px solid rgba(255,255,255,0.08)", fontSize: "0.72rem", color: "var(--text-muted)" }}>
                  Powered by Gemini 768-dim embeddings &amp; Groq Llama 3 streaming
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Section: Proprietary RAG Advantages ("Built Different") ── */}
      <section id="advantages" className="section" ref={observeReveal}>
        <div className="container">
          <div className={styles.sectionHead} data-reveal>
            <span className="section-label">Proprietary Advantages</span>
            <h2>Built Different: What You Won&apos;t Find<br />in Any Generic Chatbot</h2>
            <p>
              Most platforms wrap basic ChatGPT in a simple text box. Fikram is an enterprise-grade multimodal RAG studio
              handling videos, audio lectures, scanned books, and section-aware chunking with zero hallucinations.
            </p>
          </div>

          <div className={styles.advantagesGrid}>
            {ADVANTAGES.map((adv, i) => (
              <div key={adv.title} className={`${styles.advantageCard} ${styles.revealItem}`} data-reveal style={{ transitionDelay: `${i * 0.08}s` }}>
                <div className={styles.advantageIconWrap}>{adv.icon}</div>
                <span className={styles.advantageBadge}>{adv.badge}</span>
                <h3 className={styles.advantageTitle}>{adv.title}</h3>
                <p className={styles.advantageDesc}>{adv.desc}</p>
                <div className={styles.advantageFooter}>
                  <CheckCircle2 size={16} />
                  <span>{adv.tag}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Section: "Why Fikram" Comparison Matrix ── */}
      <section id="comparison" className="section" ref={observeReveal}>
        <div className="container">
          <div className={styles.sectionHead} data-reveal>
            <span className="section-label">Honest Comparison</span>
            <h2>How Fikram Stacks Up Against Alternatives</h2>
            <p>
              See why experts, educators, and organizations choose Fikram over generic chatbots or DIY cloud infrastructure.
            </p>
          </div>

          <div className={styles.compWrap} data-reveal>
            <table className={styles.compTable}>
              <thead>
                <tr>
                  <th className={styles.compTh} style={{ width: "35%" }}>Feature Capability</th>
                  <th className={`${styles.compTh} ${styles.compThFikram}`} style={{ width: "25%" }}>
                    Fikram Platform
                  </th>
                  <th className={styles.compTh} style={{ width: "20%" }}>Generic Chatbots<br /><span style={{ fontSize: "0.75rem", fontWeight: 400, color: "var(--text-muted)" }}>(ChatGPT / Custom GPTs)</span></th>
                  <th className={styles.compTh} style={{ width: "20%" }}>Cloud DIY<br /><span style={{ fontSize: "0.75rem", fontWeight: 400, color: "var(--text-muted)" }}>(AWS Bedrock / Azure)</span></th>
                </tr>
              </thead>
              <tbody>
                {COMPARISON_ROWS.map((row) => (
                  <tr key={row.feature} className={styles.compTr}>
                    <td className={styles.compTd}>
                      <div className={styles.compTdFeature}>
                        <span>{row.feature}</span>
                        <span className={styles.compTdFeatureSub}>{row.sub}</span>
                      </div>
                    </td>
                    <td className={`${styles.compTd} ${styles.compTdFikram}`}>
                      <div className={styles.compCheck}>
                        <Check size={16} />
                        <span>{row.fikram}</span>
                      </div>
                    </td>
                    <td className={styles.compTd}>
                      <div className={row.generic.startsWith("No") || row.generic.startsWith("None") || row.generic.startsWith("Locked") ? styles.compCross : styles.compPartial}>
                        {row.generic.startsWith("No") || row.generic.startsWith("None") || row.generic.startsWith("Locked") ? <X size={16} /> : <span style={{ fontSize: "0.75rem" }}>⚠️</span>}
                        <span>{row.generic}</span>
                      </div>
                    </td>
                    <td className={styles.compTd}>
                      <div className={row.cloudDiy.startsWith("No") || row.cloudDiy.startsWith("None") ? styles.compCross : styles.compPartial}>
                        {row.cloudDiy.startsWith("No") || row.cloudDiy.startsWith("None") ? <X size={16} /> : <span style={{ fontSize: "0.75rem" }}>⚙️</span>}
                        <span>{row.cloudDiy}</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ── Section: How It Works ── */}
      <section id="how-it-works" className={`section ${styles.howSection}`} ref={observeReveal}>
        <div className="container">
          <div className={styles.sectionHead} data-reveal>
            <span className="section-label">How It Works</span>
            <h2>Three Simple Steps to an Expert AI</h2>
            <p>No machine learning knowledge needed. No servers to maintain. Upload your content and launch in seconds.</p>
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

      {/* ── Section: Model Ecosystem Marquee ── */}
      <section className={styles.showcaseSection} ref={observeReveal}>
        <div className={styles.showcaseGlow} />
        <div className="container">
          <div className={styles.sectionHead} data-reveal>
            <span className="section-label">Inference Engine</span>
            <h2>Powered by Frontier &amp; Edge LLM Architectures</h2>
            <p>Sub-second Groq Llama 3 streaming, Google Gemini Flash multimodal vision, and resilient enterprise Vertex AI fallbacks.</p>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "30px" }}>
            <div>
              <div style={{ paddingLeft: "24px", marginBottom: "12px", opacity: 0.6, fontSize: "0.85rem", textTransform: "uppercase", letterSpacing: "1px" }}>High-Speed Inference &amp; Reasoning Engines</div>
              <MarqueeRow items={FRONTIER_MODELS} direction={1} />
            </div>
            <div>
              <div style={{ paddingLeft: "24px", marginBottom: "12px", opacity: 0.6, fontSize: "0.85rem", textTransform: "uppercase", letterSpacing: "1px" }}>Lightweight &amp; Multimodal Vision Models</div>
              <MarqueeRow items={LIGHTWEIGHT_MODELS} direction={-1} />
            </div>
          </div>
        </div>
      </section>

      {/* ── Section: Live Polar Pricing Table ── */}
      <section id="pricing" className="section" ref={observeReveal}>
        <div className="container">
          <div className={styles.sectionHead} data-reveal>
            <span className="section-label">Transparent Pricing</span>
            <h2>Start Free. Upgrade as You Grow.</h2>
            <p>
              Receive 50 free credits instantly when you sign up. No credit card required.
              Upgrade anytime for unlimited assistants, full video RAG, and dedicated enterprise compute.
            </p>
          </div>

          <div className={styles.pricingCardsGrid} data-reveal>
            {PRICING_TIERS.map((tier) => (
              <div
                key={tier.name}
                className={`${styles.pricingTierCard} ${tier.highlight ? styles.pricingTierCardPopular : ""}`}
              >
                {tier.badge && <div className={styles.popularBadge}>{tier.badge}</div>}

                <div className={styles.tierHead}>
                  <h3 className={styles.tierName}>{tier.name}</h3>
                  <p className={styles.tierDesc}>{tier.desc}</p>
                </div>

                <div className={styles.tierPriceRow}>
                  <span className={styles.tierPrice}>{tier.price}</span>
                  <span className={styles.tierPeriod}>{tier.period}</span>
                </div>

                <div style={{ marginBottom: 24 }}>
                  <span className="badge badge-gradient" style={{ width: "100%", justifyContent: "center", padding: "8px 12px" }}>
                    <Sparkles size={14} style={{ marginRight: 6 }} />
                    {tier.credits}
                  </span>
                </div>

                <ul className={styles.tierFeatures}>
                  {tier.features.map((feat) => (
                    <li key={feat} className={styles.tierFeature}>
                      <span className={styles.tierFeatureCheck}>✓</span>
                      <span>{feat}</span>
                    </li>
                  ))}
                </ul>

                <Link
                  href={tier.ctaLink}
                  className={`btn ${tier.highlight ? "btn-primary" : "btn-secondary"} ${styles.tierBtn}`}
                >
                  {tier.cta}
                  <ArrowRight size={16} style={{ marginLeft: 8 }} />
                </Link>
              </div>
            ))}
          </div>

          {/* On-Demand Credit Top-Ups Callout */}
          <div className={styles.topupNotice} data-reveal>
            <div>
              <div className={styles.topupNoticeTitle}>Need extra credits on demand?</div>
              <div className={styles.topupNoticeSub}>
                Top up your balance anytime with non-expiring credit packs: <strong>Starter Pack</strong> (800 credits for $10) or <strong>Power Pack</strong> (4,000 credits for $40).
              </div>
            </div>
            <Link href="/credits" className="btn btn-secondary btn-sm">
              View Credit Packs
            </Link>
          </div>
        </div>
      </section>

      {/* ── Section: Interactive FAQ ── */}
      <section id="faq" className="section" ref={observeReveal}>
        <div className="container">
          <div className={styles.sectionHead} data-reveal>
            <span className="section-label">Got Questions?</span>
            <h2>Frequently Asked Questions</h2>
            <p>Everything you need to know about our multilingual RAG, citations, media formats, and data security.</p>
          </div>

          <div className={styles.faqGrid} data-reveal>
            {FAQS.map((item, idx) => {
              const isOpen = activeFaqIndex === idx;
              return (
                <div key={item.q} className={`${styles.faqItem} ${isOpen ? styles.faqItemOpen : ""}`}>
                  <button
                    className={styles.faqQuestion}
                    onClick={() => setActiveFaqIndex(isOpen ? null : idx)}
                    aria-expanded={isOpen}
                  >
                    <span>{item.q}</span>
                    <ChevronDown
                      size={18}
                      className={`${styles.faqChevron} ${isOpen ? styles.faqChevronRotated : ""}`}
                    />
                  </button>
                  {isOpen && <div className={styles.faqAnswer}>{item.a}</div>}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── Section: Final Call To Action ── */}
      <section className={styles.finalCtaSection}>
        <div className="container">
          <div className={styles.finalCtaCard}>
            <h2 className={styles.finalCtaTitle}>
              Turn your expertise into<br />an AI that knows every detail.
            </h2>
            <p className={styles.finalCtaDesc}>
              Join scholars, educators, medical specialists, and researchers building verified,
              hallucination-free AI assistants powered by their own knowledge.
            </p>
            <div className={styles.finalCtaBtns}>
              <Link href="/auth/signup" className="btn btn-primary btn-lg">
                <Sparkles size={18} style={{ marginRight: 8 }} />
                Get Started Free (50 Credits)
              </Link>
              <a href="#advantages" className="btn btn-secondary btn-lg">
                Explore RAG Advantages
              </a>
            </div>
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
                The AI platform where experts build verified, citation-backed knowledge assistants from video, audio, OCR, and documents across 140+ languages.
              </p>
            </div>
            <div className={styles.footerLinks}>
              <div className={styles.footerCol}>
                <div className={styles.footerColTitle}>Capabilities</div>
                <a href="#languages" className={styles.footerLink}>140+ Languages</a>
                <a href="#advantages" className={styles.footerLink}>RAG Advantages</a>
                <a href="#comparison" className={styles.footerLink}>Why Fikram</a>
                <a href="#how-it-works" className={styles.footerLink}>How It Works</a>
              </div>
              <div className={styles.footerCol}>
                <div className={styles.footerColTitle}>Pricing &amp; Account</div>
                <a href="#pricing" className={styles.footerLink}>Plans &amp; Pricing</a>
                <Link href="/credits" className={styles.footerLink}>Credit Top-ups</Link>
                <Link href="/auth/signup" className={styles.footerLink}>Sign Up Free</Link>
                <Link href="/auth/signin" className={styles.footerLink}>Sign In</Link>
              </div>
              <div className={styles.footerCol}>
                <div className={styles.footerColTitle}>Product</div>
                <Link href="/browse" className={styles.footerLink}>Browse Community Assistants</Link>
                <Link href="/models" className={styles.footerLink}>Model Registry</Link>
                <a href="#faq" className={styles.footerLink}>FAQ</a>
              </div>
            </div>
          </div>
          <div className={styles.footerBottom}>
            <span>© 2026 Fikram. All rights reserved.</span>
            <span style={{ color: "var(--text-disabled)", fontSize: "0.8125rem" }}>
              Engineered with citation-backed precision for global experts.
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}
