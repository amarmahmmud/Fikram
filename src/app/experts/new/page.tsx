"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import styles from "./page.module.css";
import { apiClient } from "@/lib/apiClient";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";
import {
  ShieldCheck,
  Flame,
  Scale,
  Globe,
  Sparkles,
  Link2,
  FileText,
  Check,
  X,
  ArrowRight,
  ArrowLeft,
  UploadCloud,
  CheckCircle2,
  Image,
  FileAudio,
  Film,
  Target,
  Sliders,
  SkipForward,
  Coins,
  RotateCcw,
  WifiOff,
} from "lucide-react";
import { BuyCreditsModal } from "@/components/BuyCreditsModal";
import { InsufficientCreditsBanner } from "@/components/InsufficientCreditsBanner";
import { uploadFileToStorage } from "@/lib/upload-client";

type Step = 1 | 2 | 3 | 4;

interface AlignmentOption {
  id: string;
  label: string;
  description: string;
}

interface AlignmentQuestion {
  id: string;
  category: "audience" | "boundaries" | "structure";
  categoryLabel: string;
  question: string;
  description: string;
  options: AlignmentOption[];
}

const DEFAULT_ALIGNMENT_QUESTIONS: AlignmentQuestion[] = [
  {
    id: "q_audience",
    category: "audience",
    categoryLabel: "Target Audience",
    question: "Who is the primary audience consulting this knowledge base?",
    description: "Calibrates terminology, explanation depth, and prerequisite assumptions.",
    options: [
      {
        id: "opt_clients",
        label: "Direct Clients & Customers",
        description: "Clear, practical explanations focused on solutions without internal complexity.",
      },
      {
        id: "opt_team",
        label: "Internal Team & Practitioners",
        description: "Technical precision, operational workflows, and rigorous source cross-referencing.",
      },
      {
        id: "opt_general",
        label: "General Public & Learners",
        description: "Approachable, foundational guidance with step-by-step conceptual clarity.",
      },
    ],
  },
  {
    id: "q_boundaries",
    category: "boundaries",
    categoryLabel: "Grounding Boundaries",
    question: "How should the assistant handle queries not found in the documents?",
    description: "Establishes retrieval containment to protect against ungrounded extrapolation.",
    options: [
      {
        id: "opt_strict",
        label: "Strict Document Grounding",
        description: "Decline immediately if unstated in the files. Never extrapolate or assume.",
      },
      {
        id: "opt_bounded",
        label: "Bounded Contextual Guidance",
        description: "Synthesize from the documents; clearly state when bridging with general knowledge.",
      },
      {
        id: "opt_referral",
        label: "Summary with Human Referral",
        description: "Offer a high-level summary and explicitly recommend consulting a verified expert.",
      },
    ],
  },
  {
    id: "q_structure",
    category: "structure",
    categoryLabel: "Response Structure",
    question: "What format best serves your users' day-to-day decision making?",
    description: "Determines the layout, citation density, and information hierarchy of replies.",
    options: [
      {
        id: "opt_actionable",
        label: "Actionable Checklists & Key Points",
        description: "Bullet points, bold takeaways, and explicit source citation references.",
      },
      {
        id: "opt_detailed",
        label: "In-Depth Analytical Walkthrough",
        description: "Thorough paragraphs explaining underlying logic, mechanics, and nuance.",
      },
      {
        id: "opt_executive",
        label: "Executive Briefing",
        description: "Distilled bottom-line synthesis upfront followed by essential supporting facts.",
      },
    ],
  },
];

interface UploadedFile {
  file: File;
  sourceType: "file" | "url";
  sourceUrl?: string;
  status: "pending" | "uploading" | "done" | "error";
  chunksStored?: number;
  error?: string;
}

const TONE_PRESETS = [
  "Friendly & Encouraging",
  "Professional & Precise",
  "Direct & Concise",
  "Academic & Detailed",
  "Casual & Conversational",
];

export default function NewExpertPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [reasoningMode, setReasoningMode] = useState<"strict" | "evaluative" | "hybrid">("hybrid");
  const [webSearchEnabled, setWebSearchEnabled] = useState(false);
  const [expertId, setExpertId] = useState<string | null>(null);
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [creating, setCreating] = useState(false);
  const [ingesting, setIngesting] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Goal & Purpose Alignment State
  const [alignmentQuestions, setAlignmentQuestions] = useState<AlignmentQuestion[]>(DEFAULT_ALIGNMENT_QUESTIONS);
  const [loadingQuestions, setLoadingQuestions] = useState(false);
  const [skippedAlignment, setSkippedAlignment] = useState(false);
  const [selectedAnswers, setSelectedAnswers] = useState<Record<string, string>>({
    q_audience: "opt_clients",
    q_boundaries: "opt_bounded",
    q_structure: "opt_actionable",
  });
  const [customAnswers, setCustomAnswers] = useState<Record<string, string>>({});
  const [showCustomInput, setShowCustomInput] = useState<Record<string, boolean>>({});
  const [customDirectives, setCustomDirectives] = useState("");
  const [ingestCurrentFile, setIngestCurrentFile] = useState<string>("");
  const [ingestProgressIndex, setIngestProgressIndex] = useState<number>(0);

  const [showAiHelper, setShowAiHelper] = useState(false);
  const [selectedTone, setSelectedTone] = useState(TONE_PRESETS[0]);
  const [generatingPrompt, setGeneratingPrompt] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [creditsBalance, setCreditsBalance] = useState<number | null>(null);
  const [showBuyModal, setShowBuyModal] = useState(false);
  const [insufficientCreditsError, setInsufficientCreditsError] = useState<{ required: number; balance: number; message?: string } | null>(null);

  const estimatedCredits = files.reduce((acc, f) => {
    const ext = f.file.name.toLowerCase().split(".").pop() || "";
    if (["mp4", "webm", "mov"].includes(ext) || f.file.type.startsWith("video/")) return acc + 10;
    if (["mp3", "wav", "ogg", "aac", "flac", "m4a"].includes(ext) || f.file.type.startsWith("audio/")) return acc + 5;
    return acc + 1;
  }, 0);

  // Verify user is authenticated on mount & load credit balance
  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) {
        toast.error("Please sign in to create a RAG AI Expert.");
        router.push("/auth/signin?redirectTo=/experts/new");
      } else {
        setCheckingAuth(false);
        supabase
          .from("profiles")
          .select("credits_balance, credits_held")
          .eq("id", user.id)
          .single()
          .then(({ data: profile }) => {
            if (profile) {
              const avail = Math.max(0, (profile.credits_balance ?? 0) - (profile.credits_held ?? 0));
              setCreditsBalance(avail);
            }
          });
      }
    });
  }, [router]);

  // Optional URL Ingestion state
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [urlInput, setUrlInput] = useState("");
  const [scrapingUrl, setScrapingUrl] = useState(false);

  // Step 1: Create expert profile
  async function handleCreateExpert() {
    if (!name.trim()) return;
    setCreating(true);
    try {
      const res = await fetch("/api/experts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim(),
          systemPrompt: systemPrompt.trim() || undefined,
          reasoningMode,
          webSearchEnabled,
        }),
      });
      if (res.status === 401) {
        toast.error("You must be signed in to create a RAG AI Expert. Redirecting to sign in...");
        router.push("/auth/signin?redirectTo=/experts/new");
        return;
      }

      const data = await res.json();
      if (data.ok && data.expert) {
        setExpertId(data.expert.id);
        setStep(2);
      } else {
        toast.error(data.error || "Failed to create expert");
      }
    } catch (error) {
      toast.error("Network error — please try again");
    } finally {
      setCreating(false);
    }
  }

  // AI Prompt Suggestion Helper
  async function handleGeneratePrompt(toneOverride?: string) {
    if (!name.trim()) {
      toast.error("Please enter an Expert Name first.");
      return;
    }
    const toneToUse = toneOverride || selectedTone;
    setGeneratingPrompt(true);
    try {
      const res = await apiClient.post<any>("/api/experts/suggest-prompt", {
        name: name.trim(),
        description: description.trim(),
        tone: toneToUse,
      });
      if (res.ok && res.systemPrompt) {
        setSystemPrompt(res.systemPrompt);
        setShowAiHelper(false);
        toast.success("AI Persona instructions applied!");
      } else {
        toast.error(res.error || "Could not generate prompt");
      }
    } catch (error) {
      toast.error("Failed to generate prompt — please try again");
    } finally {
      setGeneratingPrompt(false);
    }
  }

  // Step 2: Upload & ingest files
  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const dropped = Array.from(e.dataTransfer.files);
    addFiles(dropped);
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files) {
      addFiles(Array.from(e.target.files));
      e.target.value = "";
    }
  }

  function addFiles(newFiles: File[]) {
    const validExtensions = new Set([
      // Documents
      "pdf", "txt", "md", "csv", "json",
      // Images
      "png", "jpg", "jpeg", "webp", "gif", "heic", "heif",
      // Audio
      "mp3", "wav", "m4a", "ogg", "aac", "flac",
      // Video
      "mp4", "webm", "mov", "quicktime",
    ]);

    const valid = newFiles.filter((f) => {
      const ext = f.name.toLowerCase().split(".").pop() || "";
      const isMimeValid =
        f.type.startsWith("text/") ||
        f.type.startsWith("image/") ||
        f.type.startsWith("audio/") ||
        f.type.startsWith("video/") ||
        f.type === "application/pdf" ||
        f.type === "application/json";

      if (!validExtensions.has(ext) && !isMimeValid) {
        toast.error(`"${f.name}" is not a supported file type.`);
        return false;
      }

      const isVid = ext === "mp4" || ext === "webm" || ext === "mov" || f.type.startsWith("video/");
      const isAud = ext === "mp3" || ext === "wav" || ext === "m4a" || ext === "ogg" || ext === "flac" || f.type.startsWith("audio/");
      const isImg = ext === "png" || ext === "jpg" || ext === "jpeg" || ext === "webp" || ext === "gif" || ext === "heic" || f.type.startsWith("image/");
      const maxSize = isVid ? 50 * 1024 * 1024 : isAud ? 25 * 1024 * 1024 : isImg ? 20 * 1024 * 1024 : 25 * 1024 * 1024;

      if (f.size > maxSize) {
        toast.error(`"${f.name}" exceeds the maximum size of ${Math.round(maxSize / 1024 / 1024)}MB.`);
        return false;
      }

      return true;
    });

    if (valid.length > 0) {
      setFiles((prev) => [
        ...prev,
        ...valid.map((file) => ({ file, sourceType: "file" as const, status: "pending" as const })),
      ]);
    }
  }

  // Add scraped URL as a file
  async function handleAddUrl() {
    const trimmed = urlInput.trim();
    if (!trimmed) return;
    if (!/^https?:\/\//i.test(trimmed)) {
      setUrlInput("https://" + trimmed);
      return;
    }
    setScrapingUrl(true);
    try {
      const res = await apiClient.post<any>("/api/scrape-url", { url: trimmed });
      if (res.ok && res.text) {
        const titleClean = (res.title || "webpage").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 30);
        const virtualFile = new File([res.text], `${titleClean}.txt`, { type: "text/plain" });
        setFiles((prev) => [
          ...prev,
          {
            file: virtualFile,
            sourceType: "url",
            sourceUrl: trimmed,
            status: "pending",
          },
        ]);
        setUrlInput("");
        setShowUrlInput(false);
      } else {
        toast.error(res.error || "Failed to fetch content from URL");
      }
    } catch (error) {
      toast.error("Network error fetching URL");
    } finally {
      setScrapingUrl(false);
    }
  }

  function removeFile(index: number) {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleProceedToAlignment() {
    if (!expertId || files.length === 0) return;
    setStep(3);
    setLoadingQuestions(true);

    try {
      // Send FormData with files so the server can extract domain-specific context from PDFs and docs
      const formData = new FormData();
      formData.append("expertName", name.trim());
      formData.append("description", description.trim());
      files.forEach((f) => formData.append("filenames", f.file.name));
      // Append the first 2 files (PDF, document, or text) for server-side snippet extraction
      files.slice(0, 2).forEach((f) => formData.append("files", f.file));

      const res = await fetch("/api/experts/alignment-questions", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();
      if (data.ok && Array.isArray(data.questions) && data.questions.length > 0) {
        setAlignmentQuestions(data.questions);
        const defaults: Record<string, string> = {};
        data.questions.forEach((q: AlignmentQuestion) => {
          if (q.options && q.options.length > 0) {
            defaults[q.id] = q.options[0].id;
          }
        });
        setSelectedAnswers(defaults);
      }
    } catch (err) {
      console.warn("Could not fetch dynamic alignment questions, using enterprise fallbacks:", err);
    } finally {
      setLoadingQuestions(false);
    }
  }

  async function runFileIngestion() {
    if (!expertId || files.length === 0) return;

    setIngesting(true);
    let hasErrors = false;

    for (let i = 0; i < files.length; i++) {
      if (files[i].status === "done") continue;

      setIngestCurrentFile(files[i].file.name);
      setIngestProgressIndex(i + 1);

      setFiles((prev) =>
        prev.map((f, idx) => (idx === i ? { ...f, status: "uploading" } : f))
      );

      try {
        const file = files[i].file;
        
        // Infer MIME type if browser passed empty string or generic
        const ext = file.name.toLowerCase().split(".").pop() || "";
        let mimeType = file.type;
        if (!mimeType || mimeType === "application/octet-stream") {
          if (ext === "pdf") mimeType = "application/pdf";
          else if (["png", "jpg", "jpeg", "webp", "gif", "heic"].includes(ext)) mimeType = `image/${ext === "jpg" ? "jpeg" : ext}`;
          else if (["mp3", "wav", "ogg", "aac", "flac"].includes(ext)) mimeType = `audio/${ext}`;
          else if (ext === "m4a") mimeType = "audio/x-m4a";
          else if (["mp4", "webm"].includes(ext)) mimeType = `video/${ext}`;
          else if (ext === "mov") mimeType = "video/quicktime";
          else if (["txt", "md", "csv"].includes(ext)) mimeType = "text/plain";
          else if (ext === "json") mimeType = "application/json";
        }

        // Resilient upload: tries direct R2 and seamlessly falls back to server-side upload
        const { downloadUrl: finalDownloadUrl } = await uploadFileToStorage(file);

        // Send ingest request to backend
        const res = await fetch(`/api/experts/${expertId}/ingest`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            url: finalDownloadUrl,
            mimeType: mimeType || file.type,
            filename: file.name,
          }),
        });
        if (res.status === 401) {
          toast.error("Your session has expired. Please sign in again.");
          router.push("/auth/signin?redirectTo=/experts/new");
          return;
        }

        if (!res.ok) {
          if (res.status === 402) {
            hasErrors = true;
            const errJson = await res.json().catch(() => ({}));
            const reqCredits = errJson.credits_required || 1;
            const bal = errJson.credits_balance ?? (creditsBalance ?? 0);
            setInsufficientCreditsError({
              required: reqCredits,
              balance: bal,
              message: errJson.message || `Indexing ${file.name} requires ${reqCredits} credits.`,
            });
            setFiles((prev) =>
              prev.map((f, idx) =>
                idx === i ? { ...f, status: "error", error: `Insufficient credits (${reqCredits} required, ${bal} available)` } : f
              )
            );
            toast.error(`Insufficient credits to index ${file.name}. Please top up your balance.`);
            setShowBuyModal(true);
            break;
          }

          const text = await res.text();
          let errMsg = `Server returned ${res.status}`;
          if (text.trim().startsWith("<") || text.includes("<!DOCTYPE") || text.includes("<html")) {
            if (res.status === 504) {
              errMsg = "Processing timed out (504). File is too large for current plan.";
            } else if (res.status === 500) {
              errMsg = "Server processing error (500). Please try a smaller file or retry.";
            } else {
              errMsg = `Server error (${res.status}). Please try again.`;
            }
          } else {
            try {
              const parsed = JSON.parse(text);
              errMsg = parsed.error || parsed.message || errMsg;
            } catch {
              errMsg = text && text.length < 150 ? text : errMsg;
            }
          }
          throw new Error(errMsg);
        }
        
        const data = await res.json();

        if (data.ok) {
          setFiles((prev) =>
            prev.map((f, idx) =>
              idx === i ? { ...f, status: "done", chunksStored: data.chunksStored } : f
            )
          );
        } else {
          hasErrors = true;
          setFiles((prev) =>
            prev.map((f, idx) =>
              idx === i ? { ...f, status: "error", error: data.error } : f
            )
          );
        }
      } catch (err: any) {
        console.error("Upload error for file", files[i].file.name, err);
        hasErrors = true;
        const isNet =
          err?.isNetworkError ||
          err?.message?.toLowerCase().includes("failed to fetch");
        const errMsg = isNet
          ? "Network connection interrupted"
          : err.message || "Upload failed";
        setFiles((prev) =>
          prev.map((f, idx) =>
            idx === i ? { ...f, status: "error", error: errMsg } : f
          )
        );
      }
    }

    setIngesting(false);
    if (!hasErrors) {
      setStep(4);
    } else {
      const errorCount = files.filter((f) => f.status === "error").length;
      toast.error(`${errorCount || "Some"} file(s) encountered an issue. You can retry indexing them.`);
    }
  }

  async function handleConfirmAlignmentAndIngest() {
    if (!expertId || files.length === 0) return;

    // 1. Compile alignment directives
    const directiveLines: string[] = [];
    directiveLines.push("### OPERATIONAL RAG ALIGNMENT DIRECTIVES:");

    let updatedReasoningMode = reasoningMode;

    alignmentQuestions.forEach((q) => {
      const isCustom = showCustomInput[q.id] && customAnswers[q.id]?.trim();
      if (isCustom) {
        directiveLines.push(`- ${q.categoryLabel}: ${customAnswers[q.id].trim()}`);
      } else {
        const chosenOptId = selectedAnswers[q.id];
        const chosenOpt = q.options.find((o) => o.id === chosenOptId) || q.options[0];
        if (chosenOpt) {
          directiveLines.push(`- ${q.categoryLabel}: ${chosenOpt.label} — ${chosenOpt.description}`);
          if (q.category === "boundaries") {
            if (chosenOpt.id.includes("strict") || chosenOpt.label.toLowerCase().includes("strict")) {
              updatedReasoningMode = "strict";
            } else if (chosenOpt.id.includes("bounded") || chosenOpt.label.toLowerCase().includes("guidance")) {
              updatedReasoningMode = "hybrid";
            }
          }
        }
      }
    });

    if (customDirectives.trim()) {
      directiveLines.push(`- Operational Guardrails & Disclaimers: ${customDirectives.trim()}`);
    }

    const compiledDirectives = directiveLines.join("\n");
    const mergedSystemPrompt = systemPrompt.trim()
      ? `${systemPrompt.trim()}\n\n${compiledDirectives}`
      : compiledDirectives;

    // 2. Patch expert settings in database
    try {
      await fetch(`/api/experts/${expertId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemPrompt: mergedSystemPrompt,
          reasoningMode: updatedReasoningMode,
          webSearchEnabled,
        }),
      });
    } catch (patchErr) {
      console.warn("Failed to patch expert alignment directives:", patchErr);
    }

    // 3. Run direct ingestion and vectorization
    await runFileIngestion();
  }

  async function handleSkipAlignment() {
    if (!expertId || files.length === 0 || ingesting) return;
    setSkippedAlignment(true);
    setLoadingQuestions(false);
    setStep(3); // Display progress bar and status while indexing
    toast.info("Skipping goal alignment. Indexing with standard defaults...");

    try {
      await fetch(`/api/experts/${expertId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemPrompt: systemPrompt.trim() || undefined,
          reasoningMode: reasoningMode || "hybrid",
          webSearchEnabled,
        }),
      });
    } catch (patchErr) {
      console.warn("Failed to patch expert defaults on skip:", patchErr);
    }

    await runFileIngestion();
  }

  const totalChunks = files.reduce((a, f) => a + (f.chunksStored || 0), 0);
  const allDone = files.length > 0 && files.every((f) => f.status === "done");

  if (checkingAuth) {
    return (
      <div className="page-content" style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "60vh" }}>
        <div style={{ color: "var(--text-muted)", fontSize: "0.875rem" }}>
          Loading RAG AI Expert creator...
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="topbar">
        <span className="topbar-title">Create RAG AI Expert</span>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <Link href="/browse" className="btn btn-secondary btn-sm" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <Globe size={14} />
            <span>Browse Models</span>
          </Link>
          <Link href="/dashboard" className="btn btn-ghost btn-sm">Back to Dashboard</Link>
        </div>
      </div>

      <div className="page-content">
        {/* Progress steps */}
        <div className={styles.steps}>
          {["Expert Profile", "Knowledge Sources", "Goal Alignment", "Ready"].map((label, i) => (
            <div
              key={label}
              className={`${styles.step} ${i + 1 <= step ? styles.stepActive : ""} ${i + 1 < step ? styles.stepDone : ""}`}
            >
              <div className={styles.stepNumber}>
                {i + 1 < step ? <Check size={13} strokeWidth={3} /> : i + 1}
              </div>
              <span className={styles.stepLabel}>{label}</span>
            </div>
          ))}
        </div>

        {/* Step 1: Profile */}
        {step === 1 && (
          <div className={styles.card}>
            <h2 className={styles.cardTitle}>Expert Profile</h2>
            <p className={styles.cardDesc}>
              Define the identity, grounding behavior, and communication style of your AI expert.
            </p>

            <div className={styles.field}>
              <label className={styles.label}>Expert Name *</label>
              <input
                className={styles.input}
                placeholder="e.g., Bitcoin Scholar, Dr. Sara, Code Reviewer"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <div className={styles.field}>
              <label className={styles.label}>Domain or Specialty</label>
              <input
                className={styles.input}
                placeholder="e.g., Austrian economics, fitness coaching, fullstack engineering"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>

            {/* Knowledge Mode */}
            <div className={styles.field}>
              <label className={styles.label}>Knowledge Grounding Mode</label>
              <div className={styles.modeGrid}>
                <div
                  className={`${styles.modeOption} ${reasoningMode === "hybrid" ? styles.modeOptionActive : ""}`}
                  onClick={() => setReasoningMode("hybrid")}
                >
                  <div className={styles.modeTitle}>
                    <Scale size={15} />
                    <span>Balanced Hybrid</span>
                  </div>
                  <div className={styles.modeDesc}>
                    Blends verified files with general AI reasoning.
                  </div>
                </div>

                <div
                  className={`${styles.modeOption} ${reasoningMode === "strict" ? styles.modeOptionActive : ""}`}
                  onClick={() => setReasoningMode("strict")}
                >
                  <div className={styles.modeTitle}>
                    <ShieldCheck size={15} />
                    <span>Strict Grounding</span>
                  </div>
                  <div className={styles.modeDesc}>
                    Exclusively answers from provided files with citations.
                  </div>
                </div>

                <div
                  className={`${styles.modeOption} ${reasoningMode === "evaluative" ? styles.modeOptionActive : ""}`}
                  onClick={() => setReasoningMode("evaluative")}
                >
                  <div className={styles.modeTitle}>
                    <Flame size={15} />
                    <span>Critical Reviewer</span>
                  </div>
                  <div className={styles.modeDesc}>
                    Evaluates concepts against your source standards.
                  </div>
                </div>
              </div>

              {/* Live Web Search Switch */}
              <div
                className={`${styles.webToggleCard} ${webSearchEnabled ? styles.webToggleActive : ""}`}
                onClick={() => setWebSearchEnabled(!webSearchEnabled)}
              >
                <div className={styles.webToggleInfo}>
                  <div className={styles.webToggleTitle}>
                    <Globe size={15} />
                    <span>Real-Time Web Search</span>
                  </div>
                  <div className={styles.webToggleDesc}>
                    Permits live web searches alongside your uploaded documents.
                  </div>
                </div>
                <div className={styles.switchTrack}>
                  <div className={`${styles.switchThumb} ${webSearchEnabled ? styles.switchThumbActive : ""}`} />
                </div>
              </div>
            </div>

            {/* Persona & Style Instructions */}
            <div className={styles.field}>
              <div className={styles.labelRow}>
                <label className={styles.label} style={{ marginBottom: 0 }}>Behavior &amp; Persona Instructions</label>
                <button
                  type="button"
                  className={styles.aiHelperBtn}
                  onClick={() => {
                    if (!showAiHelper) {
                      if (!name.trim()) {
                        toast.error("Enter an Expert Name first to generate with AI.");
                        return;
                      }
                      setShowAiHelper(true);
                      handleGeneratePrompt();
                    } else {
                      setShowAiHelper(false);
                    }
                  }}
                  disabled={generatingPrompt}
                >
                  <Sparkles size={13} />
                  <span>{generatingPrompt ? "Generating..." : showAiHelper ? "Hide AI Generator" : "Generate with AI"}</span>
                </button>
              </div>

              {showAiHelper && (
                <div className={styles.aiGeneratorBox}>
                  <div className={styles.aiGeneratorHeader}>Tone preset:</div>
                  <div className={styles.toneChips}>
                    {TONE_PRESETS.map((t) => (
                      <button
                        type="button"
                        key={t}
                        className={`${styles.toneChip} ${selectedTone === t ? styles.toneChipActive : ""}`}
                        onClick={() => {
                          setSelectedTone(t);
                          handleGeneratePrompt(t);
                        }}
                        disabled={generatingPrompt}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <textarea
                className={styles.textarea}
                placeholder="e.g., Speak with clarity and rigor. Cite sections where available and state boundaries when unstated."
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                rows={3}
              />
              <p className={styles.hint}>
                Define communication demeanor, citation preferences, and response tone.
              </p>
            </div>

            <button
              className="btn btn-primary"
              onClick={handleCreateExpert}
              disabled={!name.trim() || creating}
              style={{ display: "inline-flex", alignItems: "center", gap: 8, width: "100%", justifyContent: "center", padding: "12px 18px", marginTop: 8 }}
            >
              <span>{creating ? "Creating Expert..." : "Continue to Knowledge Sources"}</span>
              {!creating && <ArrowRight size={15} />}
            </button>
          </div>
        )}

        {/* Step 2: Knowledge Sources */}
        {step === 2 && (
          <div className={styles.card}>
            <h2 className={styles.cardTitle}>Knowledge Sources</h2>
            <p className={styles.cardDesc}>
              Upload the documents, notes, or media that form your expert&apos;s knowledge base.
            </p>

            <div
              className={`${styles.dropzone} ${dragOver ? styles.dropzoneActive : ""}`}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileRef.current?.click()}
            >
              <input
                ref={fileRef}
                type="file"
                accept=".pdf,.txt,.md,.csv,.json,.png,.jpg,.jpeg,.webp,.gif,.heic,.mp3,.wav,.m4a,.ogg,.aac,.flac,.mp4,.webm,.mov,image/*,audio/*,video/*"
                multiple
                hidden
                onChange={handleFileSelect}
              />
              <div className={styles.dropzoneIcon}>
                <UploadCloud size={32} />
              </div>
              <p className={styles.dropzoneText}>
                Drop files here or <span className={styles.dropzoneLink}>browse</span>
              </p>
              <p className={styles.dropzoneHint}>PDF, TXT, MD, CSV, Audio, Video supported (up to 50MB)</p>
            </div>

            {/* URL Ingestion Section */}
            <div className={styles.urlSection}>
              {!showUrlInput ? (
                <button
                  type="button"
                  className={styles.urlToggle}
                  onClick={() => setShowUrlInput(true)}
                >
                  <Link2 size={14} />
                  <span>Add web links (optional)</span>
                </button>
              ) : (
                <div className={styles.urlInputRow}>
                  <input
                    className={styles.input}
                    placeholder="https://example.com/article"
                    value={urlInput}
                    onChange={(e) => setUrlInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleAddUrl()}
                  />
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={handleAddUrl}
                    disabled={scrapingUrl || !urlInput.trim()}
                  >
                    {scrapingUrl ? "Fetching..." : "Add"}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => { setShowUrlInput(false); setUrlInput(""); }}
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>

            {/* File list */}
            {files.length > 0 && (
              <>
                <div style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "8px 12px",
                  borderRadius: "8px",
                  background: "rgba(255, 255, 255, 0.03)",
                  border: "1px solid var(--border-subtle)",
                  fontSize: "0.8125rem",
                  marginBottom: 10,
                }}>
                  <span style={{ color: "var(--text-muted)" }}>
                    {files.length} file{files.length !== 1 ? "s" : ""} selected • Estimated cost: <strong style={{ color: "var(--text-primary)" }}>~{estimatedCredits} credits</strong>
                  </span>
                  {creditsBalance !== null && (
                    <button
                      type="button"
                      onClick={() => setShowBuyModal(true)}
                      style={{
                        background: "transparent",
                        border: "none",
                        color: creditsBalance < estimatedCredits ? "#fbbf24" : "var(--accent-primary)",
                        fontWeight: 600,
                        cursor: "pointer",
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                      }}
                      title="Click to refill credits"
                    >
                      <Coins size={13} />
                      <span>{creditsBalance.toLocaleString()} credits available</span>
                    </button>
                  )}
                </div>

                {insufficientCreditsError && (
                  <div style={{ marginBottom: 12 }}>
                    <InsufficientCreditsBanner
                      balance={insufficientCreditsError.balance}
                      required={insufficientCreditsError.required}
                      actionText="index files into this expert"
                      onTopUpClick={() => setShowBuyModal(true)}
                    />
                  </div>
                )}
              </>
            )}

            {files.length > 0 && (
              <div className={styles.fileList}>
                {files.map((f, i) => {
                  const lowerName = f.file.name.toLowerCase();
                  const isImg = lowerName.match(/\.(png|jpe?g|webp|gif|heic|heif)$/) || f.file.type.startsWith("image/");
                  const isAud = lowerName.match(/\.(mp3|wav|m4a|ogg|aac|flac)$/) || f.file.type.startsWith("audio/");
                  const isVid = lowerName.match(/\.(mp4|webm|mov)$/) || f.file.type.startsWith("video/");

                  return (
                    <div key={i} className={styles.fileRow}>
                      <span className={styles.fileIcon}>
                        {f.sourceType === "url" ? (
                          <Globe size={15} />
                        ) : isImg ? (
                          <Image size={15} />
                        ) : isAud ? (
                          <FileAudio size={15} />
                        ) : isVid ? (
                          <Film size={15} />
                        ) : (
                          <FileText size={15} />
                        )}
                      </span>
                      <span className={styles.fileName}>
                        {f.sourceType === "url" ? `${f.file.name} (${f.sourceUrl})` : f.file.name}
                      </span>
                      <span className={styles.fileSize}>
                        {(f.file.size / 1024).toFixed(0)} KB
                      </span>
                      <span className={`${styles.fileStatus} ${styles[`fileStatus_${f.status}`]}`}>
                        {f.status === "pending" && "Ready"}
                        {f.status === "uploading" && "Processing..."}
                        {f.status === "done" && (
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                            <Check size={12} /> {f.chunksStored} chunks
                          </span>
                        )}
                        {f.status === "error" && (
                          <span title={f.error}>
                            <X size={12} /> Error
                          </span>
                        )}
                      </span>
                      {f.status === "pending" && (
                        <button
                          type="button"
                          className={styles.fileRemoveBtn}
                          onClick={() => removeFile(i)}
                          title="Remove"
                          aria-label="Remove"
                        >
                          <X size={14} />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginTop: 20, flexWrap: "wrap" }}>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setStep(1)}
                disabled={ingesting}
                style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
              >
                <ArrowLeft size={14} />
                <span>Back</span>
              </button>

              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={handleSkipAlignment}
                  disabled={files.length === 0 || ingesting}
                  style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
                  title="Skip questions and build with defaults"
                >
                  <SkipForward size={14} />
                  <span>Skip &amp; Build</span>
                </button>
                <button
                  className="btn btn-primary btn-sm"
                  onClick={handleProceedToAlignment}
                  disabled={files.length === 0 || ingesting}
                  style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
                >
                  <span>Proceed to Alignment</span>
                  <ArrowRight size={14} />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Step 3: Goal Alignment */}
        {step === 3 && (
          <div className={styles.card} style={{ maxWidth: 720 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
              <div>
                <h2 className={styles.cardTitle} style={{ marginBottom: 4 }}>Goal Alignment</h2>
                <p className={styles.cardDesc} style={{ marginBottom: 0 }}>
                  Fine-tune how your expert reasons, cites sources, and structures replies.
                </p>
              </div>
              {!ingesting && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={handleSkipAlignment}
                  style={{ display: "inline-flex", alignItems: "center", gap: 5, color: "var(--text-muted)", fontSize: "0.8rem" }}
                  title="Skip customization and build with defaults"
                >
                  <SkipForward size={13} />
                  <span>Skip this step</span>
                </button>
              )}
            </div>

            {loadingQuestions ? (
              <div className={styles.alignmentLoadingBox}>
                <div className={styles.alignmentLoadingSpinner} />
                <div className={styles.alignmentLoadingTitle}>Analyzing source documents...</div>
                <div className={styles.alignmentLoadingDesc}>
                  Extracting key topics and structuring tailored alignment questions.
                </div>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={handleSkipAlignment}
                  style={{ marginTop: 8, display: "inline-flex", alignItems: "center", gap: 6 }}
                >
                  <SkipForward size={14} />
                  <span>Skip waiting &amp; build with defaults</span>
                </button>
              </div>
            ) : (
              <>
                <div className={styles.alignmentQuestionList}>
                  {alignmentQuestions.map((q) => {
                    const isAudience = q.category === "audience";
                    const isBoundaries = q.category === "boundaries";

                    return (
                      <div key={q.id} className={styles.alignmentQuestionCard}>
                        <div className={styles.alignmentCategoryRow}>
                          <div className={styles.alignmentCategoryTag}>
                            {isAudience ? (
                              <Target size={13} />
                            ) : isBoundaries ? (
                              <ShieldCheck size={13} />
                            ) : (
                              <Sliders size={13} />
                            )}
                            <span>{q.categoryLabel}</span>
                          </div>
                        </div>

                        <h4 className={styles.alignmentQuestionTitle}>{q.question}</h4>
                        <p className={styles.alignmentQuestionSubtitle}>{q.description}</p>

                        <div className={styles.alignmentOptionsGrid}>
                          {q.options.map((opt) => {
                            const isSelected = selectedAnswers[q.id] === opt.id && !showCustomInput[q.id];

                            return (
                              <div
                                key={opt.id}
                                className={`${styles.alignmentOptionCard} ${isSelected ? styles.alignmentOptionCardActive : ""}`}
                                onClick={() => {
                                  setSelectedAnswers((prev) => ({ ...prev, [q.id]: opt.id }));
                                  setShowCustomInput((prev) => ({ ...prev, [q.id]: false }));
                                }}
                              >
                                <div className={styles.alignmentOptionHeader}>
                                  <div className={styles.alignmentRadioCircle}>
                                    {isSelected && <div className={styles.alignmentRadioInner} />}
                                  </div>
                                  <span className={styles.alignmentOptionLabel}>{opt.label}</span>
                                </div>
                                <p className={styles.alignmentOptionDesc}>{opt.description}</p>
                              </div>
                            );
                          })}
                        </div>

                        {/* Custom rule toggle */}
                        <div>
                          {!showCustomInput[q.id] ? (
                            <button
                              type="button"
                              className={styles.alignmentCustomToggle}
                              onClick={() => setShowCustomInput((prev) => ({ ...prev, [q.id]: true }))}
                            >
                              + Custom rule for this criteria
                            </button>
                          ) : (
                            <input
                              className={styles.alignmentCustomInput}
                              placeholder={`Custom instruction for ${q.categoryLabel.toLowerCase()}...`}
                              value={customAnswers[q.id] || ""}
                              onChange={(e) =>
                                setCustomAnswers((prev) => ({ ...prev, [q.id]: e.target.value }))
                              }
                            />
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Optional Guardrails */}
                <div className={styles.alignmentDirectivesCard}>
                  <label className={styles.alignmentDirectivesLabel}>
                    <ShieldCheck size={14} />
                    <span>Custom Guardrails &amp; Disclaimers (Optional)</span>
                  </label>
                  <input
                    className={styles.input}
                    placeholder="e.g., Never give medical advice; Always cite chapter and section numbers."
                    value={customDirectives}
                    onChange={(e) => setCustomDirectives(e.target.value)}
                  />
                </div>

                {/* Ingestion active progress */}
                {ingesting && (
                  <div className={styles.ingestActiveCard}>
                    <div className={styles.ingestStatusHeader}>
                      <span>Vectorizing &amp; Indexing Knowledge ({ingestProgressIndex}/{files.length})</span>
                      <span>{Math.round((ingestProgressIndex / files.length) * 100)}%</span>
                    </div>
                    <div className={styles.ingestProgressBar}>
                      <div
                        className={styles.ingestProgressFill}
                        style={{ width: `${Math.max(10, (ingestProgressIndex / files.length) * 100)}%` }}
                      />
                    </div>
                    <div className={styles.ingestFileText}>
                      Processing: {ingestCurrentFile || "Vectorizing chunks..."}
                    </div>
                  </div>
                )}

                {insufficientCreditsError && (
                  <div style={{ marginTop: 12, marginBottom: 12 }}>
                    <InsufficientCreditsBanner
                      balance={insufficientCreditsError.balance}
                      required={insufficientCreditsError.required}
                      actionText="index files and create your expert"
                      onTopUpClick={() => setShowBuyModal(true)}
                    />
                  </div>
                )}

                {files.some((f) => f.status === "error") && !ingesting && !insufficientCreditsError && (
                  <div
                    style={{
                      marginTop: 12,
                      marginBottom: 12,
                      padding: "12px 14px",
                      borderRadius: "var(--radius-md)",
                      background: "rgba(239, 68, 68, 0.12)",
                      border: "1px solid rgba(239, 68, 68, 0.35)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 12,
                      flexWrap: "wrap",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#fca5a5", fontSize: "0.8125rem" }}>
                      <WifiOff size={16} />
                      <span>
                        {files.filter((f) => f.status === "error").length} file(s) failed to index. Check your connection and retry.
                      </span>
                    </div>
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      onClick={runFileIngestion}
                      style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
                    >
                      <RotateCcw size={13} />
                      <span>Retry Failed Files</span>
                    </button>
                  </div>
                )}

                {/* Actions */}
                <div className={styles.alignmentActions}>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => setStep(2)}
                    disabled={ingesting}
                    style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
                  >
                    <ArrowLeft size={14} />
                    <span>Back</span>
                  </button>

                  <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={handleSkipAlignment}
                      disabled={ingesting}
                      style={{ display: "inline-flex", alignItems: "center", gap: 5 }}
                    >
                      <SkipForward size={14} />
                      <span>Skip</span>
                    </button>

                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => {
                        const defaults: Record<string, string> = {};
                        alignmentQuestions.forEach((q) => {
                          if (q.options[0]) defaults[q.id] = q.options[0].id;
                        });
                        setSelectedAnswers(defaults);
                        setShowCustomInput({});
                        toast.success("Applied recommended defaults.");
                      }}
                      disabled={ingesting}
                    >
                      Recommended Defaults
                    </button>

                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={handleConfirmAlignmentAndIngest}
                      disabled={ingesting || files.length === 0}
                      style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
                    >
                      <span>{ingesting ? "Indexing..." : "Confirm & Build Expert"}</span>
                      {!ingesting && <ArrowRight size={14} />}
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* Step 4: Done */}
        {step === 4 && (
          <div className={styles.card} style={{ textAlign: "center", maxWidth: 580, padding: "40px 32px" }}>
            <div style={{ display: "flex", justifyContent: "center", marginBottom: 20 }}>
              <div className={styles.successIconWrapper}>
                <CheckCircle2 size={40} />
              </div>
            </div>
            <h2 className={styles.cardTitle} style={{ fontSize: "1.4rem", marginBottom: 8 }}>
              {name} is Ready
            </h2>
            <p className={styles.cardDesc} style={{ maxWidth: 440, margin: "0 auto 24px" }}>
              Successfully indexed <strong>{totalChunks} knowledge chunks</strong>. Your RAG AI Expert is online and ready to assist.
            </p>

            <div className={styles.summaryPills}>
              {skippedAlignment || alignmentQuestions.length === 0 ? (
                <>
                  <div className={styles.summaryPill}>
                    <span>Alignment:</span>
                    <span className={styles.summaryPillStrong}>Standard Balanced</span>
                  </div>
                  <div className={styles.summaryPill}>
                    <span>Grounding Mode:</span>
                    <span className={styles.summaryPillStrong}>
                      {reasoningMode === "strict" ? "Strict Grounding" : "Hybrid Synthesis"}
                    </span>
                  </div>
                  <div className={styles.summaryPill}>
                    <span>Live Web Search:</span>
                    <span className={styles.summaryPillStrong}>{webSearchEnabled ? "Active" : "Off"}</span>
                  </div>
                </>
              ) : (
                alignmentQuestions.map((q) => {
                  const isCustom = showCustomInput[q.id] && customAnswers[q.id]?.trim();
                  const chosenOpt = q.options.find((o) => o.id === selectedAnswers[q.id]);
                  const val = isCustom ? customAnswers[q.id].trim() : chosenOpt?.label || "Configured";

                  return (
                    <div key={q.id} className={styles.summaryPill}>
                      <span>{q.categoryLabel}:</span>
                      <span className={styles.summaryPillStrong}>{val}</span>
                    </div>
                  );
                })
              )}
            </div>

            <div style={{ display: "flex", gap: 12, justifyContent: "center", marginTop: 24, flexWrap: "wrap" }}>
              <Link
                href={`/experts/${expertId}/chat`}
                className="btn btn-primary"
                style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "10px 22px" }}
              >
                <span>Start Chatting</span>
                <ArrowRight size={15} />
              </Link>
              <Link href="/browse" className="btn btn-secondary" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <Globe size={14} />
                <span>Browse Models</span>
              </Link>
              <Link href="/dashboard" className="btn btn-ghost">
                Dashboard
              </Link>
            </div>
          </div>
        )}
      </div>

      <BuyCreditsModal
        isOpen={showBuyModal}
        onClose={() => setShowBuyModal(false)}
        creditsRequired={insufficientCreditsError?.required ?? (estimatedCredits > (creditsBalance ?? 0) ? estimatedCredits : undefined)}
        currentBalance={creditsBalance ?? 0}
        actionName="index documents and build your expert"
        returnUrl="/experts/new"
        onSuccess={(newBal) => {
          setCreditsBalance(newBal);
          setInsufficientCreditsError(null);
          toast.success("Credits refilled! You can now proceed to build your expert.");
        }}
      />
    </>
  );
}
