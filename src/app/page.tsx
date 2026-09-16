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
  Mic,
  Cpu,
  Layers,
  Download,
  ArrowRight,
  HelpCircle,
  Clock,
  Radio,
  ExternalLink,
  Bot,
  Flame,
  CheckCircle2,
} from "lucide-react";

// ── Hero Use-Case Rotation ──
const HERO_USE_CASES = [
  "Quranic Scholars & Tajweed Educators",
  "Medical & Clinical Researchers",
  "Legal & Compliance Advisors",
  "Multilingual Course Creators",
  "Enterprise Technical Teams",
  "Financial & Investment Analysts",
  "Acoustic & Speech Researchers",
  "Global Knowledge Organizations",
];

// ── 140+ Languages Showcase Data ──
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
    title: "Arabic & Tajweed Phonetics",
    items: [
      { name: "Classical Quranic Arabic", native: "العربية الفصحى التراثية", flag: "📖", tag: "QPS Tajweed Engine", detail: "Phoneme + Sifat Makharij articulation" },
      { name: "Modern Standard Arabic", native: "العربية الفصحى المعاصرة", flag: "🌐", tag: "Full OCR & RAG", detail: "Formal documents, books & research" },
      { name: "Egyptian Dialect", native: "اللهجة المصرية", flag: "🇪🇬", tag: "Speech & Audio", detail: "Acoustic transfer & conversational AI" },
      { name: "Gulf & Saudi Arabic", native: "اللهجة الخليجية", flag: "🇸🇦", tag: "Speech & Audio", detail: "Speech recognition & local terms" },
      { name: "Levantine (Shami)", native: "اللهجة الشامية", flag: "🇱🇧", tag: "Speech & Audio", detail: "Jordanian, Syrian, Lebanese, Palestinian" },
      { name: "Maghrebi (North African)", native: "الدارجة المغربية", flag: "🇲🇦", tag: "Speech & Audio", detail: "Moroccan, Algerian & Tunisian dialects" },
      { name: "Sudanese Arabic", native: "اللهجة السودانية", flag: "🇸🇩", tag: "Speech & Audio", detail: "Speech-to-text & phonetic mapping" },
      { name: "Yemeni Arabic", native: "اللهجة اليمنية", flag: "🇾🇪", tag: "Speech & Audio", detail: "Classical phonetic conservation" },
    ],
  },
  asian: {
    title: "Asian & South Asian (XLS-R / w2v-BERT)",
    items: [
      { name: "Urdu", native: "اردو", flag: "🇵🇰", tag: "Speech + Docs", detail: "Nastaliq & phonetic recitation mapping" },
      { name: "Bahasa Indonesia", native: "Bahasa Indonesia", flag: "🇮🇩", tag: "140+ Pre-trained", detail: "Full document extraction & speech ASR" },
      { name: "Bahasa Melayu", native: "Bahasa Melayu", flag: "🇲🇾", tag: "140+ Pre-trained", detail: "Islamic education materials & audio" },
      { name: "Bengali", native: "বাংলা", flag: "🇧🇩", tag: "Speech + Docs", detail: "Sub-continental phonetic alignment" },
      { name: "Hindi", native: "हिन्दी", flag: "🇮🇳", tag: "Speech + Docs", detail: "Devanagari document OCR & speech" },
      { name: "Mandarin Chinese", native: "简体中文", flag: "🇨🇳", tag: "Multimodal Vision", detail: "High-density diagram & text parsing" },
      { name: "Japanese", native: "日本語", flag: "🇯🇵", tag: "Multimodal Vision", detail: "Technical manuals & lecture transcription" },
      { name: "Korean", native: "한국어", flag: "🇰🇷", tag: "140+ Pre-trained", detail: "High-accuracy embedding & retrieval" },
    ],
  },
  european: {
    title: "European & Global Languages",
    items: [
      { name: "English (US, UK, Global)", native: "English", flag: "🇬🇧", tag: "Global Benchmark", detail: "Full multimodal speed & reasoning" },
      { name: "French", native: "Français", flag: "🇫🇷", tag: "140+ Pre-trained", detail: "Legal and academic literature parsing" },
      { name: "Spanish", native: "Español", flag: "🇪🇸", tag: "140+ Pre-trained", detail: "Latin America & European dialects" },
      { name: "German", native: "Deutsch", flag: "🇩🇪", tag: "140+ Pre-trained", detail: "Dense compound text extraction" },
      { name: "Turkish", native: "Türkçe", flag: "🇹🇷", tag: "Speech + Docs", detail: "Ottoman-rooted & modern Turkish ASR" },
      { name: "Russian", native: "Русский", flag: "🇷🇺", tag: "140+ Pre-trained", detail: "Cyrillic OCR & vector search" },
      { name: "Italian", native: "Italiano", flag: "🇮🇹", tag: "140+ Pre-trained", detail: "Academic publications & audio" },
      { name: "Portuguese", native: "Português", flag: "🇧🇷", tag: "140+ Pre-trained", detail: "Brazilian & European Portuguese" },
    ],
  },
  african: {
    title: "Middle Eastern & African Languages",
    items: [
      { name: "Persian (Farsi)", native: "فارسی", flag: "🇮🇷", tag: "Speech + Docs", detail: "Perso-Arabic script & classical poetry" },
      { name: "Swahili", native: "Kiswahili", flag: "🇰🇪", tag: "140+ Pre-trained", detail: "East African education & audio" },
      { name: "Hausa", native: "Harshen Hausa", flag: "🇳🇬", tag: "Speech + Docs", detail: "West African Islamic scholarship" },
      { name: "Somali", native: "Af-Soomaali", flag: "🇸🇴", tag: "Speech + Docs", detail: "Oral recitation & written records" },
      { name: "Kurdish (Sorani & Kurmanji)", native: "کوردی", flag: "☀️", tag: "140+ Pre-trained", detail: "Dialectal speech & document parsing" },
      { name: "Amharic", native: "አማርኛ", flag: "🇪🇹", tag: "Ge'ez Script", detail: "Ethiopian script OCR & embeddings" },
      { name: "Pashto", native: "پښتو", flag: "🇦🇫", tag: "Speech + Docs", detail: "Complex phonetic consonants" },
      { name: "Uzbek", native: "Oʻzbekcha", flag: "🇺🇿", tag: "Central Asian", detail: "Latin & Cyrillic dual-alphabet RAG" },
    ],
  },
};

// ── Proprietary Advantages ──
const ADVANTAGES = [
  {
    badge: "Multimodal Knowledge Ingestion",
    title: "Not Just Text — Audio, Video & Scanned OCR",
    desc: "Ingest voice notes, MP4 lecture recordings, scanned handwritten books, high-res diagrams, and raw datasets. Fikram automatically transcribes, segments, and embeds across all formats.",
    icon: <Layers size={24} />,
    tag: "PDF · Video · Audio · OCR",
  },
  {
    badge: "Proprietary Speech Engine",
    title: "Sub-Phonemic Articulation & Tajweed (QPS)",
    desc: "Generic ASR only guesses rough words. Fikram's two-level phoneme + sifat engine checks exact articulation points (Makharij, Qalqalah, Ghunnah, Madd) to catch errors no other AI can detect.",
    icon: <Mic size={24} />,
    tag: "Exclusive QPS Checkpoint",
  },
  {
    badge: "Verifiable Accuracy",
    title: "100% Citation Grounding — Zero Hallucination",
    desc: "Every answer cites exact document page numbers ([p. 14]) or audio/video timestamps ([04:22]) with source snippet previews. Easily audit and trust every word your assistant outputs.",
    icon: <Shield size={24} />,
    tag: "Timestamp & Page Citations",
  },
  {
    badge: "Open Weights & Zero Lock-in",
    title: "Export to Ollama (GGUF) & Hugging Face",
    desc: "Fine-tune models on our cloud GPU clusters (LoRA / CTC) and download the weights to run privately on your local Mac, PC, or private server. You own 100% of your trained model.",
    icon: <Download size={24} />,
    tag: "GGUF · HF Hub · Local Run",
  },
  {
    badge: "Hybrid Zero-Cold-Start Engine",
    title: "Sub-Second Groq Streaming + Gemini Flash",
    desc: "Lightning-fast responses via Groq Llama 3 with automatic key rotation (<200ms latency), resilient Google Gemini Flash vision fallback, and enterprise Google Vertex AI SLA.",
    icon: <Zap size={24} />,
    tag: "<200ms TTFT Latency",
  },
  {
    badge: "Enterprise Security",
    title: "Tenant Isolation in pgvector — Never Trained On",
    desc: "Your knowledge base is partitioned using PostgreSQL row-level tenant security. Your proprietary materials, datasets, and recordings are never shared or used to train public models.",
    icon: <Cpu size={24} />,
    tag: "pgvector · Private Tenant",
  },
];

// ── Comparison Matrix Data ──
const COMPARISON_ROWS = [
  {
    feature: "Full-Spectrum Multimodal Ingestion",
    sub: "Direct upload of Video (MP4), Audio (WAV/MP3), Scanned OCR, and PDFs",
    fikram: "Yes (Automatic OCR & Whisper/Gemini audio parsing)",
    generic: "Partial (Text & basic images only)",
    cloudDiy: "Complex custom pipeline required",
  },
  {
    feature: "140+ Languages & Dialect Phonetics",
    sub: "Meta XLS-R & w2v-BERT speech pre-training across global languages",
    fikram: "143 Languages Pre-trained",
    generic: "Limited / Basic text translation",
    cloudDiy: "Manual fine-tuning & config",
  },
  {
    feature: "Sub-Phonemic Tajweed & Sifat Recognition",
    sub: "Two-level phoneme + articulation rules (Makharij, Ghunnah, Qalqalah)",
    fikram: "Exclusive QPS Architecture",
    generic: "None (Word-level text only)",
    cloudDiy: "None (Standard ASR only)",
  },
  {
    feature: "Verifiable Page & Timestamp Citations",
    sub: "Every claim anchored to verifiable source page or media timestamp",
    fikram: "Yes ([p. 14], [04:22] previews)",
    generic: "Vague / Prone to hallucinations",
    cloudDiy: "Requires custom RAG dev",
  },
  {
    feature: "In-Browser Waveform & Label Editor",
    sub: "Interactive waveform alignment and phoneme error correction",
    fikram: "Built-in Waveform Corrector",
    generic: "No",
    cloudDiy: "No (Requires third-party tools)",
  },
  {
    feature: "Open Model Export (Ollama / HuggingFace)",
    sub: "Download fine-tuned GGUF weights to run locally offline",
    fikram: "Yes (1-Click HF & Ollama)",
    generic: "Locked into proprietary SaaS",
    cloudDiy: "Manual bucket download",
  },
  {
    feature: "Time to First Working Assistant",
    sub: "From raw files to deployed chat assistant",
    fikram: "Under 30 Seconds",
    generic: "5 - 15 Minutes",
    cloudDiy: "Weeks of engineering",
  },
  {
    feature: "Free Starter Tier",
    sub: "Start building immediately without entering payment info",
    fikram: "50 Free Credits on Signup",
    generic: "Restricted free tier",
    cloudDiy: "Credit card required upfront",
  },
];

// ── Live Pricing Tiers ──
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
    desc: "For professionals, educators, and creators who need continuous knowledge updates and speech training.",
    credits: "2,000 Monthly Credits",
    highlight: true,
    badge: "Most Popular",
    cta: "Upgrade to Pro",
    ctaLink: "/credits",
    features: [
      "2,000 monthly credits included",
      "Unlimited knowledge assistants",
      "Full video lecture & audio ingestion",
      "Google Document AI OCR for scanned docs",
      "Custom LoRA model fine-tuning on GPUs",
      "In-browser waveform & phoneme editor",
      "Priority GPU training queue",
      "Community model sharing & publishing",
    ],
  },
  {
    name: "Business",
    price: "$79",
    period: "/ month",
    desc: "For institutions, research labs, and enterprises requiring dedicated throughput and model weight export.",
    credits: "10,000 Monthly Credits",
    highlight: false,
    cta: "Get Business Plan",
    ctaLink: "/credits",
    features: [
      "10,000 monthly credits included",
      "Dedicated Google Vertex AI throughput",
      "Export model weights (Ollama GGUF / HuggingFace)",
      "Multi-seat team workspace",
      "Highest priority GPU cluster access",
      "API & Webhook programmatic access",
      "Custom vocabulary & Tajweed rule presets",
      "Dedicated onboarding & SLA support",
    ],
  },
];

// ── Interactive FAQ ──
const FAQS = [
  {
    q: "How does Fikram support 140+ languages and Arabic phonetics?",
    a: "Fikram incorporates state-of-the-art foundation models: Meta XLS-R (pre-trained on 128 languages) and Meta w2v-BERT 2.0 (pre-trained on 143 languages), combined with multimodal Gemini and Groq embeddings. For Arabic and Quranic recitation, we implement the obadx QPS acoustic architecture, which operates at the sub-phonemic acoustic level to track Makharij (points of articulation) and Sifat (phonetic characteristics like Qalqalah, Ghunnah, and Tafkheem/Tarqeeq) that standard speech engines completely overlook.",
  },
  {
    q: "What file formats can I upload into my knowledge base?",
    a: "You can upload PDFs, Word documents, scanned paper books (via Google Document AI OCR), high-resolution images, audio recordings (MP3, WAV, M4A, OGG, FLAC), video lectures (MP4, WebM), and structured JSONL datasets. Everything is automatically processed, transcribed, section-chunked, and embedded.",
  },
  {
    q: "How do credits work and what can I do with the 50 free credits?",
    a: "Credits power AI processing: 1 credit per knowledge query, ~1 credit per document chunk embedded, and ~8 to 35 credits for GPU model training jobs depending on model size. The 50 free credits you receive at signup allow you to index a complete document or audio file and chat with your assistant 40+ times with zero commitment.",
  },
  {
    q: "Can I export my fine-tuned models to run locally in Ollama or HuggingFace?",
    a: "Yes! Unlike closed chatbots where your assistant is permanently locked to a third-party platform, Fikram allows Business and Pro users to export trained model checkpoints. You can convert weights to GGUF format to run locally on your own machine using Ollama, or push them directly to your Hugging Face repository.",
  },
  {
    q: "Is my uploaded proprietary data safe and private?",
    a: "Absolutely. Each assistant's knowledge base is strictly isolated inside PostgreSQL using pgvector row-level tenant security. Your documents, transcripts, and recordings are encrypted in transit and at rest, and are NEVER used to train external public foundation models.",
  },
  {
    q: "How does citation grounding prevent AI hallucinations?",
    a: "Instead of letting an LLM guess answers from general internet training data, Fikram uses Section-Aware Retrieval Augmented Generation (RAG). Before answering, it finds the exact matching chunks in your uploaded content and forces the model to construct its answer strictly from those sources, citing the specific page number or audio timestamp for every claim.",
  },
];

const STEPS = [
  {
    num: "01",
    title: "Upload Any Content or Speech",
    desc: "Drop your PDFs, video lectures, voice memos, scanned books, or audio datasets. Fikram's multimodal pipeline transcribes and parses every detail.",
  },
  {
    num: "02",
    title: "Intelligent Embeddings & Acoustic Alignment",
    desc: "In under 30 seconds, your content is mapped into a vector knowledge base, or aligned phonetically with sub-phonemic Makharij detection.",
  },
  {
    num: "03",
    title: "Chat with Citations or Export Weights",
    desc: "Deploy a verified assistant that never hallucinates, or export your custom fine-tuned model directly to Ollama or Hugging Face Hub.",
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
  { value: "0%", label: "Vendor Lock-in (Ollama/HF)" },
];

const RAG_LOG_LINES = [
  { text: '✓ Uploaded "fiqh-foundations.pdf" (64 pages) + "lecture-04.mp3"', type: "success" },
  { text: "→ Google Document AI & Whisper transcription active...", type: "info" },
  { text: "  184 hierarchical knowledge chunks indexed", type: "dim" },
  { text: '? "What are the rules of phonetic articulation in Surah Al-Baqarah?"', type: "info" },
  { text: "  Found 4 high-confidence sources with pgvector cosine similarity...", type: "dim" },
  { text: "✓ Answer generated with verifiable citations [p. 18, p. 42, audio 12:45]", type: "success" },
  { text: "✓ Knowledge Assistant ready for public or private deployment", type: "success" },
];

const ASR_LOG_LINES = [
  { text: '✓ Audio waveform ingested: "recitation-sample-surah-fatiha.wav"', type: "success" },
  { text: "→ Running obadx QPS Multi-Level CTC Acoustic Model...", type: "info" },
  { text: "  Acoustic Frame Rate: 50Hz · Context Window: 30,000ms", type: "dim" },
  { text: "→ Phonetic Alignment: [b-i-s-m-i-l-l-a-a-h-i-r-r-a-h-m-a-a-n]", type: "info" },
  { text: "✓ Makharij Check: Halq (Throat) & Jowf (Cavity) verified", type: "success" },
  { text: "✓ Sifat Analysis: Hams, Jahr, Qalqalah matched with 98.6% confidence", type: "success" },
  { text: "✓ Phoneme Error Rate (PER): 1.8% · Ready to export to GGUF/Ollama", type: "success" },
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
  const [activePreviewMode, setActivePreviewMode] = useState<"rag" | "asr">("rag");
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
    setVisibleLogs(0);
    setProgressWidth(0);
    const logTimer = setTimeout(() => {
      setProgressWidth(100);
    }, 200);
    return () => clearTimeout(logTimer);
  }, [activePreviewMode]);

  useEffect(() => {
    const currentLogs = activePreviewMode === "rag" ? RAG_LOG_LINES : ASR_LOG_LINES;
    if (visibleLogs < currentLogs.length) {
      const t = setTimeout(() => setVisibleLogs((v) => v + 1), 500);
      return () => clearTimeout(t);
    }
  }, [visibleLogs, activePreviewMode]);

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

  const activeLogs = activePreviewMode === "rag" ? RAG_LOG_LINES : ASR_LOG_LINES;

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
            <a href="#advantages" className={styles.navLink}>Advantages</a>
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
            <a href="#advantages" className={styles.mobileNavLink} onClick={() => setMobileNavOpen(false)}>Advantages</a>
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
            Proprietary Multimodal & Acoustic AI Engine
          </div>

          <h1 className={styles.heroHeadline}>
            Turn Your Knowledge & Speech into<br />
            <span className="text-gradient">an AI That Truly Understands</span>
          </h1>

          <p className={styles.heroSubline}>
            Ingest PDFs, audio recordings, video lectures, and scanned books with 100% verified citations.
            Train custom speech and phonetic models across 140+ languages. Zero hallucinations. Ready in 30 seconds.
          </p>

          <div className={styles.modelTicker}>
            <span className={styles.modelTickerLabel}>Engineered for</span>
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
            <a href="#languages" className="btn btn-secondary btn-lg">
              Explore 140+ Languages
            </a>
          </div>

          <p className={styles.heroNote}>
            No credit card required · Instant 50 credits · Open weights export to Ollama & Hugging Face
          </p>
        </div>

        {/* Dual-Mode Live Demo Card */}
        <div className={styles.heroVisual} ref={heroCardRef}>
          {/* Mode Switcher */}
          <div className={styles.heroToggleWrap}>
            <button
              className={`${styles.heroToggleBtn} ${activePreviewMode === "rag" ? styles.heroToggleBtnActive : ""}`}
              onClick={() => setActivePreviewMode("rag")}
            >
              <FileText size={14} />
              Multimodal RAG & Citations
            </button>
            <button
              className={`${styles.heroToggleBtn} ${activePreviewMode === "asr" ? styles.heroToggleBtnActive : ""}`}
              onClick={() => setActivePreviewMode("asr")}
            >
              <Mic size={14} />
              Acoustic Phonetics & Tajweed
            </button>
          </div>

          <div className={styles.heroCard}>
            <div className={styles.heroCardHeader}>
              <div className="terminal-dot red" />
              <div className="terminal-dot yellow" />
              <div className="terminal-dot green" />
              <span className={styles.heroCardTitle}>
                {activePreviewMode === "rag" ? "Smart Assistant — Citation Grounding Engine" : "Acoustic Alignment — QPS Tajweed Model"}
              </span>
              <span className="badge badge-success" style={{ marginLeft: "auto" }}>
                <span className="status-dot done" />
                Live Engine
              </span>
            </div>

            <div className={styles.heroCardBody}>
              {activePreviewMode === "rag" ? (
                <>
                  <div className={styles.heroCardRow}>
                    <span className={styles.heroCardLabel}>Knowledge Source</span>
                    <span className={styles.heroCardValue}>PDFs, Scanned OCR, MP4 Video, MP3 Audio</span>
                  </div>
                  <div className={styles.heroCardRow}>
                    <span className={styles.heroCardLabel}>Indexing Speed</span>
                    <span className={styles.heroCardValue}>184 Chunks in 2.8s (Hierarchical)</span>
                  </div>
                  <div className={styles.heroCardRow}>
                    <span className={styles.heroCardLabel}>Verification</span>
                    <span className={styles.heroCardValue}>Exact Page numbers & Audio Timestamps</span>
                  </div>
                  <div className={styles.heroCardRow}>
                    <span className={styles.heroCardLabel}>Hallucination Rate</span>
                    <span className={styles.heroCardValue} style={{ color: "#00E5C8", fontWeight: 700 }}>0.0% (Ground truth cited)</span>
                  </div>
                </>
              ) : (
                <>
                  <div className={styles.heroCardRow}>
                    <span className={styles.heroCardLabel}>Acoustic Backbone</span>
                    <span className={styles.heroCardValue}>obadx QPS / Meta w2v-BERT 2.0 (143 langs)</span>
                  </div>
                  <div className={styles.heroCardRow}>
                    <span className={styles.heroCardLabel}>Articulation Precision</span>
                    <span className={styles.heroCardValue}>Makharij + Sifat (Qalqalah, Ghunnah, Hams)</span>
                  </div>
                  <div className={styles.heroCardRow}>
                    <span className={styles.heroCardLabel}>Phoneme Error Rate (PER)</span>
                    <span className={styles.heroCardValue} style={{ color: "#00E5C8", fontWeight: 700 }}>1.8% (Industry Lowest)</span>
                  </div>
                  <div className={styles.heroCardRow}>
                    <span className={styles.heroCardLabel}>Model Export</span>
                    <span className={styles.heroCardValue}>Ollama GGUF & Hugging Face Hub ready</span>
                  </div>
                </>
              )}

              <div className={styles.heroProgressSection}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                  <span className={styles.heroCardLabel}>
                    {activePreviewMode === "rag" ? "Multimodal Indexing & Verification" : "Acoustic Alignment & Sifat Check"}
                  </span>
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
                {activeLogs.map((line, i) => (
                  <span
                    key={`${activePreviewMode}-${i}`}
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
                {visibleLogs < activeLogs.length && <span className={styles.cursor}>▋</span>}
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

      {/* ── Section: Global Reach & 140+ Languages ── */}
      <section id="languages" className={`section ${styles.langSection}`} ref={observeReveal}>
        <div className="container">
          <div className={styles.sectionHead} data-reveal>
            <span className="section-label">Global Language Intelligence</span>
            <h2>140+ Languages Supported Worldwide<br />with Sub-Phonetic Precision</h2>
            <p>
              Pre-trained on Meta XLS-R (128 languages) and Meta w2v-BERT 2.0 (143 languages).
              From classical Arabic recitation rules to Asian, European, and African dialects — Fikram understands what other models miss.
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

          {/* Sub-Phonetic Technical Spotlight Card */}
          <div className={styles.langSpotlightCard} data-reveal>
            <div className={styles.langSpotlightGrid}>
              <div>
                <span className="badge badge-gradient" style={{ marginBottom: 12 }}>Exclusive Deep Tech</span>
                <h3 className={styles.langSpotlightHead}>
                  Why Standard AI Fails at Recitation & Dialects — and How Fikram Solves It
                </h3>
                <p className={styles.langSpotlightText}>
                  Generic models (Whisper, Siri, Google Speech) only predict rough dictionary words. They cannot tell if a speaker articulated from the throat (Halq) or tongue (Lisan), whether heavy letters (Tafkheem) were flattened, or if Madd durations were respected.
                  <br /><br />
                  Fikram uses <strong>two-level acoustic CTC alignment</strong> (Phonemes + Sifat). It listens at 50 frames per second to evaluate acoustic resonance and pinpoint exact articulation discrepancies down to the millisecond.
                </p>
                <div className={styles.langPillsRow}>
                  <span className={styles.langPill}><Check size={14} /> Makharij Alignment</span>
                  <span className={styles.langPill}><Check size={14} /> Qalqalah & Ghunnah Detection</span>
                  <span className={styles.langPill}><Check size={14} /> Tafkheem / Tarqeeq Tracking</span>
                  <span className={styles.langPill}><Check size={14} /> 140+ Cross-Lingual Transfer</span>
                </div>
              </div>

              <div className={styles.langSimBox}>
                <div className={styles.simHeader}>
                  <span>ACOUSTIC FRAME ANALYSIS</span>
                  <span className={styles.simMatchTag}>99.4% CONFIDENCE</span>
                </div>
                <div className={styles.simRow}>
                  <span>Makhraj (Articulation)</span>
                  <span style={{ color: "#00E5C8" }}>أدنى الحلق (Adna Al-Halq) ✓</span>
                </div>
                <div className={styles.simRow}>
                  <span>Sifat: Hams vs Jahr</span>
                  <span style={{ color: "#00E5C8" }}>مهموس (Whispered) ✓</span>
                </div>
                <div className={styles.simRow}>
                  <span>Sifat: Isti&apos;la (Elevation)</span>
                  <span style={{ color: "#00E5C8" }}>مستفل (Lowered) ✓</span>
                </div>
                <div className={styles.simRow}>
                  <span>Madd Elongation</span>
                  <span style={{ color: "#00E5C8" }}>2 Harakah (412ms) ✓</span>
                </div>
                <div style={{ marginTop: 14, paddingTop: 10, borderTop: "1px solid rgba(255,255,255,0.08)", fontSize: "0.72rem", color: "var(--text-muted)" }}>
                  Powered by obadx QPS &amp; Meta w2v-BERT 2.0 acoustic engine
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Section: Proprietary Advantages ("Built Different") ── */}
      <section id="advantages" className="section" ref={observeReveal}>
        <div className="container">
          <div className={styles.sectionHead} data-reveal>
            <span className="section-label">Proprietary Advantages</span>
            <h2>Built Different: What You Won&apos;t Find<br />in Any Generic Chatbot</h2>
            <p>
              Most platforms wrap basic OpenAI APIs in a chat window. Fikram is a complete AI studio and factory
              giving you multimodal ingestion, sub-phonetic accuracy, and open model weight export.
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
            <h2>Three Simple Steps to Production AI</h2>
            <p>No machine learning degree. No servers to maintain. Upload your material and launch in seconds.</p>
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

      {/* ── Section: Live Model Marketplace Marquee ── */}
      <section className={styles.showcaseSection} ref={observeReveal}>
        <div className={styles.showcaseGlow} />
        <div className="container">
          <div className={styles.sectionHead} data-reveal>
            <span className="section-label">Model Ecosystem</span>
            <h2>Pre-Integrated Foundation Models &amp; Architectures</h2>
            <p>Fine-tune with LoRA, run high-speed inference, or export open weights to run locally on your own hardware.</p>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "30px" }}>
            <div>
              <div style={{ paddingLeft: "24px", marginBottom: "12px", opacity: 0.6, fontSize: "0.85rem", textTransform: "uppercase", letterSpacing: "1px" }}>Supported Frontier LLMs &amp; Speech Backbones</div>
              <MarqueeRow items={FRONTIER_MODELS} direction={1} />
            </div>
            <div>
              <div style={{ paddingLeft: "24px", marginBottom: "12px", opacity: 0.6, fontSize: "0.85rem", textTransform: "uppercase", letterSpacing: "1px" }}>Edge &amp; Local Runtimes (Ollama, Gemma, Qwen)</div>
              <MarqueeRow items={LIGHTWEIGHT_MODELS} direction={-1} />
            </div>
          </div>
        </div>
      </section>

      {/* ── Section: Live Pricing Table ── */}
      <section id="pricing" className="section" ref={observeReveal}>
        <div className="container">
          <div className={styles.sectionHead} data-reveal>
            <span className="section-label">Transparent Pricing</span>
            <h2>Start Free. Upgrade as You Grow.</h2>
            <p>
              Receive 50 free credits instantly when you sign up. No credit card required.
              Upgrade anytime for dedicated enterprise compute, video RAG, and custom GPU training.
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
            <p>Everything you need to know about our language models, citations, file formats, and data security.</p>
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
              hallucination-free AI assistants and custom speech models today.
            </p>
            <div className={styles.finalCtaBtns}>
              <Link href="/auth/signup" className="btn btn-primary btn-lg">
                <Sparkles size={18} style={{ marginRight: 8 }} />
                Get Started Free (50 Credits)
              </Link>
              <a href="#languages" className="btn btn-secondary btn-lg">
                Explore 140+ Languages
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
                The AI factory and studio where experts build citation-backed knowledge assistants and fine-tune speech models across 140+ languages.
              </p>
            </div>
            <div className={styles.footerLinks}>
              <div className={styles.footerCol}>
                <div className={styles.footerColTitle}>Capabilities</div>
                <a href="#languages" className={styles.footerLink}>140+ Languages</a>
                <a href="#advantages" className={styles.footerLink}>Proprietary Advantages</a>
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
              Engineered with sub-phonemic precision for global experts.
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}
