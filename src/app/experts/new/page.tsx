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
} from "lucide-react";

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

  // Verify user is authenticated on mount
  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) {
        toast.error("Please sign in to create a RAG AI Expert.");
        router.push("/auth/signin?redirectTo=/experts/new");
      } else {
        setCheckingAuth(false);
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
  async function handleGeneratePrompt() {
    if (!name.trim()) {
      toast.error("Please enter an Expert Name first.");
      return;
    }
    setGeneratingPrompt(true);
    try {
      const res = await apiClient.post<any>("/api/experts/suggest-prompt", {
        name: name.trim(),
        description: description.trim(),
        tone: selectedTone,
      });
      if (res.ok && res.systemPrompt) {
        setSystemPrompt(res.systemPrompt);
        setShowAiHelper(false);
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

        // Direct-to-R2 Architecture with Server Fallback
        let finalDownloadUrl: string | undefined;

        try {
          const uploadRes = await fetch("/api/upload", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ filename: file.name, contentType: mimeType || file.type }),
          });

          if (uploadRes.ok) {
            const { uploadUrl, downloadUrl } = await uploadRes.json();
            const putRes = await fetch(uploadUrl, {
              method: "PUT",
              body: file,
              headers: mimeType ? { "Content-Type": mimeType } : undefined,
            });
            if (putRes.ok) {
              finalDownloadUrl = downloadUrl;
            }
          }
        } catch (directErr) {
          console.warn("[Upload] Direct browser R2 upload failed, trying server fallback:", directErr);
        }

        // Seamless fallback to server-side upload if direct browser upload was blocked
        if (!finalDownloadUrl) {
          const formData = new FormData();
          formData.append("file", file);
          const fallbackRes = await fetch("/api/upload/file", {
            method: "POST",
            body: formData,
          });
          if (!fallbackRes.ok) {
            const errData = await fallbackRes.json().catch(() => ({}));
            throw new Error(errData.error || "Storage upload failed");
          }
          const fbData = await fallbackRes.json();
          finalDownloadUrl = fbData.downloadUrl;
        }

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
        setFiles((prev) =>
          prev.map((f, idx) =>
            idx === i ? { ...f, status: "error", error: err.message || "Upload failed" } : f
          )
        );
      }
    }

    setIngesting(false);
    if (!hasErrors) {
      setStep(4);
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
            <h2 className={styles.cardTitle}>Create Your Expert Profile</h2>
            <p className={styles.cardDesc}>
              Define who your AI expert is. This shapes how it communicates and presents itself to users.
            </p>

            <div className={styles.field}>
              <label className={styles.label}>Expert Name *</label>
              <input
                className={styles.input}
                placeholder="e.g., Coach Ahmed, Dr. Sara, Marketing Pro"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <div className={styles.field}>
              <label className={styles.label}>Short Description</label>
              <input
                className={styles.input}
                placeholder="e.g., Fitness coach specializing in strength training"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>

            {/* Reasoning & Grounding Mode */}
            <div className={styles.field}>
              <label className={styles.label}>Reasoning &amp; Knowledge Mode</label>
              <div className={styles.modeGrid}>
                <div
                  className={`${styles.modeOption} ${reasoningMode === "strict" ? styles.modeOptionActive : ""}`}
                  onClick={() => setReasoningMode("strict")}
                >
                  <div className={styles.modeTitle}>
                    <ShieldCheck size={16} />
                    <span>Strict Grounding</span>
                  </div>
                  <div className={styles.modeDesc}>
                    Answers strictly from your uploaded files with exact citations.
                  </div>
                </div>

                <div
                  className={`${styles.modeOption} ${reasoningMode === "evaluative" ? styles.modeOptionActive : ""}`}
                  onClick={() => setReasoningMode("evaluative")}
                >
                  <div className={styles.modeTitle}>
                    <Flame size={16} />
                    <span>Critical Thinker</span>
                  </div>
                  <div className={styles.modeDesc}>
                    Uses your documents as benchmarks to evaluate ideas with critical analysis.
                  </div>
                </div>

                <div
                  className={`${styles.modeOption} ${reasoningMode === "hybrid" ? styles.modeOptionActive : ""}`}
                  onClick={() => setReasoningMode("hybrid")}
                >
                  <div className={styles.modeTitle}>
                    <Scale size={16} />
                    <span>Balanced Hybrid</span>
                  </div>
                  <div className={styles.modeDesc}>
                    Combines your files with general knowledge for broader conversational context.
                  </div>
                </div>
              </div>

              {/* Live Web Search Toggle */}
              <div
                className={`${styles.webToggleCard} ${webSearchEnabled ? styles.webToggleActive : ""}`}
                onClick={() => setWebSearchEnabled(!webSearchEnabled)}
              >
                <div className={styles.webToggleInfo}>
                  <div className={styles.webToggleTitle}>
                    <Globe size={15} style={{ display: "inline-block", verticalAlign: "text-bottom", marginRight: 6 }} />
                    <span>Live Web Search &amp; Market Intelligence</span>
                  </div>
                  <div className={styles.webToggleDesc}>
                    Allows the AI to search the web in real-time for latest news, competitors, and industry trends.
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={webSearchEnabled}
                  onChange={(e) => setWebSearchEnabled(e.target.checked)}
                  style={{ width: 18, height: 18, accentColor: "var(--accent-primary)", cursor: "pointer" }}
                  onClick={(e) => e.stopPropagation()}
                />
              </div>
            </div>

            <div className={styles.field}>
              <div className={styles.labelRow}>
                <label className={styles.label} style={{ marginBottom: 0 }}>Style Instructions (optional)</label>
                <button
                  type="button"
                  className={styles.aiHelperBtn}
                  onClick={() => setShowAiHelper(!showAiHelper)}
                  style={{ display: "inline-flex", alignItems: "center", gap: 5 }}
                >
                  <Sparkles size={13} />
                  <span>{showAiHelper ? "Hide AI Helper" : "Generate with AI"}</span>
                </button>
              </div>

              {showAiHelper && (
                <div className={styles.aiGeneratorBox}>
                  <div className={styles.aiGeneratorHeader}>Pick a tone &amp; generate custom instructions:</div>
                  <div className={styles.toneChips}>
                    {TONE_PRESETS.map((t) => (
                      <button
                        type="button"
                        key={t}
                        className={`${styles.toneChip} ${selectedTone === t ? styles.toneChipActive : ""}`}
                        onClick={() => setSelectedTone(t)}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={handleGeneratePrompt}
                    disabled={generatingPrompt || !name.trim()}
                  >
                    {generatingPrompt ? "Generating..." : "Apply AI Instructions →"}
                  </button>
                </div>
              )}

              <textarea
                className={styles.textarea}
                placeholder="e.g., Speak in a friendly, encouraging tone. Base answers strictly on the knowledge base. Always cite sources."
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                rows={3}
              />
              <p className={styles.hint}>
                Tell the AI how this expert should talk — tone, formality, language preferences.
              </p>
            </div>

            <button
              className="btn btn-primary"
              onClick={handleCreateExpert}
              disabled={!name.trim() || creating}
              style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
            >
              <span>{creating ? "Creating..." : "Continue"}</span>
              {!creating && <ArrowRight size={14} />}
            </button>
          </div>
        )}

        {/* Step 2: Upload */}
        {step === 2 && (
          <div className={styles.card}>
            <h2 className={styles.cardTitle}>Upload Knowledge Content</h2>
            <p className={styles.cardDesc}>
              Upload the expert&apos;s content — PDFs, documents, images, audio, video, or web links. The AI will extract and index knowledge from them.
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
              <p className={styles.dropzoneHint}>PDF, Documents, Images, Audio, Video supported (up to 50MB)</p>
            </div>

            {/* URL Ingestion Section */}
            <div className={styles.urlSection}>
              {!showUrlInput ? (
                <button
                  type="button"
                  className={styles.urlToggle}
                  onClick={() => setShowUrlInput(true)}
                  style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
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

            {/* File & Source list */}
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
                        <span
                          style={{ display: "inline-flex", alignItems: "center", gap: 4, maxWidth: "100%" }}
                          title={f.error}
                        >
                          <X size={12} style={{ flexShrink: 0 }} />
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {f.error}
                          </span>
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

            <div style={{ display: "flex", gap: 12, marginTop: 16, flexWrap: "wrap" }}>
              <button
                className="btn btn-primary"
                onClick={handleProceedToAlignment}
                disabled={files.length === 0}
                style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
              >
                <span>Proceed to Goal Alignment</span>
                <ArrowRight size={14} />
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleSkipAlignment}
                disabled={files.length === 0 || ingesting}
                style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
                title="Skip alignment questions and immediately index knowledge with standard defaults"
              >
                <SkipForward size={14} />
                <span>Skip Alignment &amp; Build</span>
              </button>
              {totalChunks > 0 && (
                <button
                  className="btn btn-secondary"
                  onClick={() => setStep(4)}
                  style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
                >
                  <span>Continue to Ready ({totalChunks} chunks)</span>
                  <ArrowRight size={14} />
                </button>
              )}
            </div>
          </div>
        )}

        {/* Step 3: Goal & Purpose Alignment */}
        {step === 3 && (
          <div className={styles.card} style={{ maxWidth: 720 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8, flexWrap: "wrap", gap: 8 }}>
              <div>
                <div className={styles.alignmentHeaderBadge}>
                  <span className={styles.alignmentHeaderBadgeDot} />
                  <span>Pre-Indexing Alignment</span>
                </div>
                <h2 className={styles.cardTitle} style={{ marginTop: 4 }}>Goal Alignment</h2>
              </div>
              {!ingesting && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={handleSkipAlignment}
                  style={{ display: "inline-flex", alignItems: "center", gap: 5, color: "var(--text-muted)", padding: "4px 8px" }}
                  title="Skip question customization and build with defaults"
                >
                  <SkipForward size={13} />
                  <span>Skip this step</span>
                </button>
              )}
            </div>
            <p className={styles.cardDesc}>
              Set the purpose, target audience, and response boundaries for your AI expert, or skip to build with standard defaults.
            </p>

            {loadingQuestions ? (
              <div className={styles.alignmentLoadingBox}>
                <div className={styles.alignmentLoadingSpinner} />
                <div className={styles.alignmentLoadingTitle}>Analyzing uploaded documents...</div>
                <div className={styles.alignmentLoadingDesc}>
                  Preparing alignment questions based on your content.
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
                          <span className={styles.alignmentStepIndicator}>Step 3 of 4</span>
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

                        {/* Custom input override */}
                        <div>
                          {!showCustomInput[q.id] ? (
                            <button
                              type="button"
                              className={styles.alignmentCustomToggle}
                              onClick={() => setShowCustomInput((prev) => ({ ...prev, [q.id]: true }))}
                            >
                              Specify custom rule for this criteria
                            </button>
                          ) : (
                            <input
                              className={styles.alignmentCustomInput}
                              placeholder={`Custom ${q.categoryLabel.toLowerCase()} instruction...`}
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

                {/* Additional Guardrails & Disclaimers */}
                <div className={styles.alignmentDirectivesCard}>
                  <label className={styles.alignmentDirectivesLabel}>
                    <ShieldCheck size={14} />
                    <span>Additional Guardrails &amp; Disclaimers (Optional)</span>
                  </label>
                  <textarea
                    className={styles.textarea}
                    placeholder="e.g., Do not cite confidential pricing; Always append standard clinical disclaimer for health questions."
                    value={customDirectives}
                    onChange={(e) => setCustomDirectives(e.target.value)}
                    rows={2}
                  />
                  <p className={styles.hint}>
                    Explicit negative constraints, disclaimers, or mandatory citations to enforce on every reply.
                  </p>
                </div>

                {/* Ingestion progress if active */}
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
                      Processing: {ingestCurrentFile || "Embedding text chunks..."}
                    </div>
                  </div>
                )}

                {/* Action buttons */}
                <div className={styles.alignmentActions}>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => setStep(2)}
                    disabled={ingesting}
                    style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
                  >
                    <ArrowLeft size={14} />
                    <span>Back to Sources</span>
                  </button>

                  <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={handleSkipAlignment}
                      disabled={ingesting}
                      style={{ display: "inline-flex", alignItems: "center", gap: 5 }}
                      title="Bypass alignment and start indexing with balanced defaults"
                    >
                      <SkipForward size={14} />
                      <span>Skip Alignment</span>
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
                        toast.success("Applied recommended enterprise defaults.");
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
          <div className={styles.card} style={{ textAlign: "center", maxWidth: 640 }}>
            <div style={{ display: "flex", justifyContent: "center", marginBottom: 16, color: "var(--accent-primary)" }}>
              <CheckCircle2 size={46} />
            </div>
            <h2 className={styles.cardTitle}>Your RAG AI Expert is Ready</h2>
            <p className={styles.cardDesc}>
              <strong>{name}</strong> is ready with <strong>{totalChunks} indexed knowledge chunks</strong>.
            </p>

            <div className={styles.summaryPills}>
              {skippedAlignment || alignmentQuestions.length === 0 ? (
                <>
                  <div className={styles.summaryPill}>
                    <span>Alignment:</span>
                    <span className={styles.summaryPillStrong}>Standard Balanced Defaults</span>
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
                style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
              >
                <span>Start Chatting</span>
                <ArrowRight size={14} />
              </Link>
              <Link href="/browse" className="btn btn-secondary" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <Globe size={14} />
                <span>Browse Models</span>
              </Link>
              <Link href="/dashboard" className="btn btn-ghost">
                Back to Dashboard
              </Link>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
