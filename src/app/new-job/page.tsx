"use client";

import { useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import styles from "./page.module.css";
import { MODELS } from "@/lib/models";
import { apiClient } from "@/lib/apiClient";
import type { WizardContext, GoldExample } from "@/lib/wizard-types";

/* ── Types ── */
type Step = 1 | 2 | 3 | 4 | 5;

interface ChatMessage {
  role: "ai" | "user";
  content: string;
}

interface AiQuestion {
  id: string;
  text: string;
  options: string[];
  allowCustom: boolean;
  multiSelect: boolean;
}

interface AiIdentity {
  persona: string;
  audience: string;
  style: string;
  format: string;
  boundaries: string;
  reasoning: string;
}

interface TrainingConfig {
  baseModel: string;
  method: string;
  epochs: number;
  learningRate: number;
  batchSize: number;
  warmupSteps: number;
  estimatedCredits: number;
  estimatedTime: string;
}

interface UrlEntry {
  url: string;
  status: "loading" | "done" | "error";
  text?: string;
  title?: string;
  error?: string;
}

interface PreviewPair {
  prompt: string;
  completion: string;
  status: "pending" | "approved" | "rejected";
}

const STEP_LABELS = ["Upload & Sources", "AI Interview", "Model Identity", "Preview", "Launch"];

const BOUNDARY_PRESETS = [
  "Never give medical advice",
  "Always cite sources",
  "Don't claim certainty",
  "Never provide legal counsel",
  "Never guarantee financial returns",
  "Always recommend consulting a professional",
];

export default function NewJobPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);

  // ── Step 1: Upload & Sources ──
  const [files, setFiles] = useState<File[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [goalText, setGoalText] = useState("");
  const [urls, setUrls] = useState<UrlEntry[]>([]);
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [urlInput, setUrlInput] = useState("");
  const [documentText, setDocumentText] = useState(""); // extracted text from files+URLs
  const fileRef = useRef<HTMLInputElement>(null);

  // ── Step 2: AI Interview ──
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    { role: "ai", content: "Hello, I'm your AI fine-tuning assistant. Tell me what you'd like your custom AI model to do, and I'll help you set everything up." },
  ]);
  const [currentQuestion, setCurrentQuestion] = useState<AiQuestion | null>(null);
  const [selectedOptions, setSelectedOptions] = useState<string[]>([]);
  const [customInput, setCustomInput] = useState("");
  const [aiLoading, setAiLoading] = useState(false);

  // ── Step 3: Model Identity (Smart Summary Card) ──
  const [identity, setIdentity] = useState<AiIdentity | null>(null);
  const [editingField, setEditingField] = useState<string | null>(null);
  const [showAllFields, setShowAllFields] = useState(false);
  const [goldExamples, setGoldExamples] = useState<GoldExample[]>([{ question: "", answer: "" }]);
  const [showExamples, setShowExamples] = useState(false);
  const [boundaries, setBoundaries] = useState("");
  const [showBoundaries, setShowBoundaries] = useState(false);
  const [activeBoundaryPresets, setActiveBoundaryPresets] = useState<string[]>([]);

  // ── Step 4: Preview ──
  const [previewPairs, setPreviewPairs] = useState<PreviewPair[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewFeedback, setPreviewFeedback] = useState("");

  // ── Step 5: Config & Launch ──
  const [aiConfig, setAiConfig] = useState<TrainingConfig | null>(null);
  const [selectedModel, setSelectedModel] = useState(MODELS[0].id);
  const [jobName, setJobName] = useState("");
  const [launching, setLaunching] = useState(false);
  const [generationStatus, setGenerationStatus] = useState("");
  const [launchedJobId, setLaunchedJobId] = useState<string | null>(null);

  /* Use AI config or defaults */
  const config: TrainingConfig = aiConfig ?? {
    baseModel: MODELS.find((m) => m.id === selectedModel)?.name ?? "Llama 3.1 8B Instruct",
    method: "LoRA (auto-selected)",
    epochs: 3, learningRate: 0.00002, batchSize: 4, warmupSteps: 10,
    estimatedCredits: 28, estimatedTime: "12–18 min",
  };

  /* ── Build WizardContext from state ── */
  const buildWizardContext = useCallback((): WizardContext => {
    const validExamples = goldExamples.filter((e) => e.question.trim() && e.answer.trim());
    const allBoundaries = [
      ...activeBoundaryPresets,
      boundaries.trim(),
    ].filter(Boolean).join(". ");

    return {
      goal: chatMessages.find((m) => m.role === "user")?.content || goalText,
      persona: identity?.persona || "",
      audience: identity?.audience || "",
      style: identity?.style || "",
      format: identity?.format || "",
      boundaries: allBoundaries || identity?.boundaries || "",
      goldExamples: validExamples,
      documentSummary: documentText.slice(0, 3000),
    };
  }, [identity, goldExamples, activeBoundaryPresets, boundaries, chatMessages, goalText, documentText]);


  /* ── File handling ── */
  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const dropped = Array.from(e.dataTransfer.files);
    if (dropped.length) setFiles((prev) => [...prev, ...dropped]);
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(e.target.files || []);
    if (selected.length) setFiles((prev) => [...prev, ...selected]);
    e.target.value = "";
  }

  function removeFile(index: number) {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }

  /* ── URL handling ── */
  async function addUrl() {
    const trimmed = urlInput.trim();
    if (!trimmed) return;
    if (!/^https?:\/\//i.test(trimmed)) {
      setUrlInput("https://" + trimmed);
      return;
    }
    setUrlInput("");
    const entry: UrlEntry = { url: trimmed, status: "loading" };
    setUrls((prev) => [...prev, entry]);

    try {
      const json = await apiClient.post<any>("/api/scrape-url", { url: trimmed });
      if (json.ok) {
        setUrls((prev) =>
          prev.map((u) => u.url === trimmed ? { ...u, status: "done" as const, text: json.text, title: json.title } : u)
        );
      } else {
        setUrls((prev) =>
          prev.map((u) => u.url === trimmed ? { ...u, status: "error" as const, error: json.error } : u)
        );
      }
    } catch {
      setUrls((prev) =>
        prev.map((u) => u.url === trimmed ? { ...u, status: "error" as const, error: "Failed to fetch" } : u)
      );
    }
  }

  function removeUrl(index: number) {
    setUrls((prev) => prev.filter((_, i) => i !== index));
  }

  /* ── Extract text from all files ── */
  async function extractAllText(): Promise<string> {
    let allText = "";

    for (const f of files) {
      if (f.name.toLowerCase().endsWith(".pdf")) {
        const formData = new FormData();
        formData.append("file", f);
        const parseData = await apiClient.post<any>("/api/parse-pdf", formData);
        if (parseData.text) allText += parseData.text + "\n\n";
      } else {
        allText += (await f.text()) + "\n\n";
      }
    }

    // Add URL text
    for (const u of urls) {
      if (u.status === "done" && u.text) {
        allText += `\n\n--- Content from ${u.url} ---\n${u.text}\n`;
      }
    }

    return allText.trim();
  }


  /* ── Step 1 → Step 2 (AI Interview) ── */
  async function handleStep1Next() {
    if (!goalText.trim()) return;
    setAiLoading(true);

    // Extract document text for the wizard to read
    let docSummary = "";
    try {
      docSummary = await extractAllText();
      setDocumentText(docSummary);
    } catch { /* non-critical */ }

    const userMsg = goalText;
    setChatMessages((prev) => [...prev, { role: "user", content: userMsg }]);
    setGoalText("");

    try {
      const json = await apiClient.post<any>("/api/wizard", {
        messages: [{ role: "user", content: userMsg }],
        documentSummary: docSummary.slice(0, 3000),
      });
      if (json.ok && json.data?.type === "question") {
        setCurrentQuestion(json.data);
        setChatMessages((prev) => [...prev, { role: "ai", content: json.data.text }]);
        setStep(2);
      } else if (json.ok && json.data?.type === "identity") {
        setIdentity(json.data);
        setChatMessages((prev) => [...prev, { role: "ai", content: json.data.reasoning || "I've configured your model identity." }]);
        setStep(3);
      } else {
        setChatMessages((prev) => [...prev, { role: "ai", content: "Great! Let me ask a few quick questions to understand your needs better." }]);
        setStep(2);
      }
    } catch {
      setChatMessages((prev) => [...prev, { role: "ai", content: "Let me ask you a few quick questions to set up the perfect model!" }]);
      setStep(2);
    }
    setAiLoading(false);
  }


  /* ── Step 2: Submit answer → next AI question or identity ── */
  async function submitAnswer() {
    const chosen = customInput.trim() ? [...selectedOptions, customInput.trim()] : selectedOptions;
    if (!chosen.length) return;
    const answerText = chosen.join(", ");
    const newMessages: ChatMessage[] = [...chatMessages, { role: "user", content: answerText }];
    setChatMessages(newMessages);
    setSelectedOptions([]);
    setCustomInput("");
    setAiLoading(true);

    try {
      const json = await apiClient.post<any>("/api/wizard", {
        messages: newMessages.map((m) => ({ role: m.role === "ai" ? "model" : "user", content: m.content })),
        documentSummary: documentText.slice(0, 3000),
      });

      if (json.ok) {
        if (json.data?.type === "question") {
          setCurrentQuestion(json.data);
          setChatMessages((prev) => [...prev, { role: "ai", content: json.data.text }]);
        } else if (json.data?.type === "identity") {
          setIdentity(json.data);
          if (json.data.boundaries) setBoundaries(json.data.boundaries);
          setChatMessages((prev) => [...prev, { role: "ai", content: json.data.reasoning || "I've built your model's identity based on your answers." }]);
          setStep(3);
        } else if (json.data?.type === "config") {
          // If AI jumps straight to config, we still need identity — build a default one
          const cfg = json.data;
          setAiConfig({
            baseModel: cfg.recommendedModel ?? MODELS[0].name,
            method: cfg.method ?? "LoRA",
            epochs: cfg.epochs ?? 3,
            learningRate: cfg.learningRate ?? 0.00002,
            batchSize: cfg.batchSize ?? 4,
            warmupSteps: 10,
            estimatedCredits: cfg.estimatedCredits ?? 28,
            estimatedTime: cfg.estimatedTime ?? "12–18 min",
          });
          setChatMessages((prev) => [...prev, { role: "ai", content: cfg.reasoning ?? "Configuration ready." }]);
          setStep(3);
        }
      }
    } catch {
      setChatMessages((prev) => [...prev, { role: "ai", content: "Let me set up your model identity." }]);
      setStep(3);
    }
    setAiLoading(false);
  }


  /* ── Step 3 → Step 4 (Preview) ── */
  async function handleIdentityConfirm() {
    setStep(4);
    setPreviewLoading(true);

    try {
      const ctx = buildWizardContext();
      const text = documentText || "No document uploaded — user described goal only.";
      const json = await apiClient.post<any>("/api/preview-pairs", { text, context: ctx });

      if (json.ok && json.pairs?.length) {
        setPreviewPairs(json.pairs.map((p: any) => ({ ...p, status: "pending" })));
      } else {
        setPreviewPairs([]);
      }
    } catch {
      setPreviewPairs([]);
    }
    setPreviewLoading(false);
  }

  /* ── Step 3 → Request training config from AI ── */
  async function requestConfig() {
    try {
      const json = await apiClient.post<any>("/api/wizard", {
        messages: chatMessages.map((m) => ({ role: m.role === "ai" ? "model" : "user", content: m.content })),
        documentSummary: documentText.slice(0, 3000),
        phase: "config",
      });

      if (json.ok && json.data?.type === "config") {
        const cfg = json.data;
        setAiConfig({
          baseModel: cfg.recommendedModel ?? MODELS[0].name,
          method: cfg.method ?? "LoRA",
          epochs: cfg.epochs ?? 3,
          learningRate: cfg.learningRate ?? 0.00002,
          batchSize: cfg.batchSize ?? 4,
          warmupSteps: 10,
          estimatedCredits: cfg.estimatedCredits ?? 28,
          estimatedTime: cfg.estimatedTime ?? "12–18 min",
        });
        if (cfg.recommendedModel) {
          const exists = MODELS.find((m) => m.id === cfg.recommendedModel);
          if (exists) setSelectedModel(cfg.recommendedModel);
        }
      }
    } catch { /* use defaults */ }
  }


  /* ── Step 4 → Step 5 ── */
  function handlePreviewDone() {
    requestConfig(); // fire & forget — get config while user sees step 5
    setStep(5);
  }

  function handlePreviewSkip() {
    requestConfig();
    setStep(5);
  }

  function togglePreviewPair(index: number, status: "approved" | "rejected") {
    setPreviewPairs((prev) =>
      prev.map((p, i) => i === index ? { ...p, status: p.status === status ? "pending" : status } : p)
    );
  }


  /* ── Launch real job ── */
  async function handleLaunch() {
    setLaunching(true);
    setGenerationStatus("Preparing...");
    try {
      let finalDatasetUrl = null;
      const hasFiles = files.length > 0 || urls.some((u) => u.status === "done");

      if (hasFiles) {
        setGenerationStatus("Extracting text from all sources...");
        const rawText = documentText || (await extractAllText());

        // Check if any file is already JSONL — skip generation
        const jsonlFile = files.find((f) => f.name.toLowerCase().endsWith(".jsonl"));

        let fileToUpload: File;

        if (jsonlFile) {
          fileToUpload = jsonlFile;
        } else {
          setGenerationStatus("Synthesizing dataset with AI pipeline (this may take 30-60s for large documents)...");
          const ctx = buildWizardContext();
          const genData = await apiClient.post<any>("/api/generate-dataset", {
            text: rawText,
            goal: ctx.goal,
            wizardContext: ctx,
          });
          if (!genData.ok) throw new Error(genData.error || "Dataset generation failed");

          const blob = new Blob([genData.jsonl], { type: "application/jsonl" });
          const baseName = files[0]?.name?.replace(/\.[^/.]+$/, "") || "generated";
          fileToUpload = new File([blob], `${baseName}_dataset.jsonl`, { type: "application/jsonl" });
        }

        setGenerationStatus("Uploading dataset...");
        const uploadData = await apiClient.post<any>("/api/upload", {
          filename: fileToUpload.name,
          contentType: fileToUpload.type,
        });

        if (!uploadData.ok) throw new Error(uploadData.error || "Failed to get upload URL");

        await apiClient.put<any>(uploadData.uploadUrl, fileToUpload, {
          headers: { "Content-Type": fileToUpload.type || "application/octet-stream" },
        });

        finalDatasetUrl = uploadData.downloadUrl;
      }

      setGenerationStatus("Queueing training job...");
      const json = await apiClient.post<any>("/api/jobs", {
        name: jobName || "Untitled Job",
        baseModel: selectedModel,
        method: "lora",
        config: { epochs: config.epochs, learningRate: config.learningRate, batchSize: config.batchSize },
        datasetUrl: finalDatasetUrl,
        estimatedCredits: config.estimatedCredits,
      });
      if (json.ok) {
        setLaunchedJobId(json.jobId);
        setStep(5);
        // Trick: reuse step 5 for success — we use launchedJobId to detect success state
      } else {
        alert(json.error ?? "Failed to launch job");
      }
    } catch (err: any) {
      alert(err.message || "Network error — please try again");
    }
    setLaunching(false);
  }


  /* ── Identity field edit helpers ── */
  function updateIdentityField(field: keyof AiIdentity, value: string) {
    if (!identity) return;
    setIdentity({ ...identity, [field]: value });
    setEditingField(null);
  }

  const identityFields: { key: keyof AiIdentity; icon: string; label: string }[] = [
    { key: "persona", icon: "🎭", label: "Persona" },
    { key: "audience", icon: "👥", label: "Audience" },
    { key: "style", icon: "✏️", label: "Style" },
    { key: "format", icon: "📝", label: "Format" },
    { key: "boundaries", icon: "🚫", label: "Boundaries" },
  ];


  /* ── Render ── */
  return (
    <>
      {/* Topbar */}
      <div className="topbar">
        <Link href="/dashboard" className="btn btn-ghost btn-sm">← Back</Link>
        <span className="topbar-title" style={{ textAlign: "center", flex: 1 }}>
          New Fine-Tuning Job
        </span>
        <div style={{ width: 80 }} />
      </div>

      <div className="page-content" style={{ maxWidth: 800 }}>
        {/* Steps indicator */}
        <div className="steps" style={{ marginBottom: 40 }}>
          {STEP_LABELS.map((label, i) => (
            <div
              key={label}
              className={`step ${step === i + 1 ? "active" : ""} ${step > i + 1 ? "completed" : ""}`}
            >
              <div className="step-number">
                {step > i + 1 ? "✓" : i + 1}
              </div>
              <span className="step-label">{label}</span>
            </div>
          ))}
        </div>


        {/* ══════════════════════════════════════════════ */}
        {/* Step 1: Upload & Sources                      */}
        {/* ══════════════════════════════════════════════ */}
        {step === 1 && (
          <div className={styles.stepPanel}>
            <h2 className={styles.stepTitle}>Upload your data &amp; describe your goal</h2>
            <p className={styles.stepDesc}>
              Upload your training documents and tell us what you want your model to do.
              You can also add web links for additional context.
            </p>

            {/* Upload zone */}
            <div
              className={`upload-zone ${dragOver ? "drag-over" : ""} ${files.length > 0 ? styles.uploadDone : ""}`}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileRef.current?.click()}
            >
              <input
                ref={fileRef}
                type="file"
                accept=".csv,.jsonl,.txt,.json,.pdf"
                style={{ display: "none" }}
                multiple
                onChange={handleFileSelect}
              />
              {files.length > 0 ? (
                <>
                  <div className="upload-icon" style={{ background: "var(--success-bg)", borderColor: "rgba(16,185,129,0.2)", color: "var(--success)" }}>✓</div>
                  <p style={{ color: "var(--success)", fontWeight: 600 }}>{files.length} file{files.length > 1 ? "s" : ""} uploaded</p>
                  <p className="text-muted" style={{ fontSize: "0.8125rem", marginTop: 4 }}>
                    Click to add more files
                  </p>
                </>
              ) : (
                <>
                  <div className="upload-icon">↑</div>
                  <p style={{ fontWeight: 600, color: "var(--text-primary)" }}>Drop your files here</p>
                  <p className="text-muted" style={{ fontSize: "0.8125rem", marginTop: 4 }}>
                    Supports PDF, CSV, JSONL, TXT, JSON · Up to 50 MB
                  </p>
                  <button className="btn btn-secondary btn-sm" style={{ marginTop: 12 }} onClick={(e) => { e.stopPropagation(); fileRef.current?.click(); }}>
                    Browse Files
                  </button>
                </>
              )}
            </div>

            {/* File list */}
            {files.length > 0 && (
              <div className={styles.fileList}>
                {files.map((f, i) => (
                  <div key={`${f.name}-${i}`} className={styles.fileItem}>
                    <div className={styles.fileItemInfo}>
                      <div className={styles.fileItemIcon}>
                        {f.name.split(".").pop()?.toUpperCase()?.slice(0, 4)}
                      </div>
                      <div>
                        <div className={styles.fileItemName}>{f.name}</div>
                        <div className={styles.fileItemSize}>{(f.size / 1024).toFixed(1)} KB</div>
                      </div>
                    </div>
                    <button
                      className={styles.fileItemRemove}
                      onClick={(e) => { e.stopPropagation(); removeFile(i); }}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* URL section */}
            <div className={styles.urlSection}>
              {!showUrlInput ? (
                <button className={styles.urlToggle} onClick={() => setShowUrlInput(true)}>
                  🔗 + Add web links (optional)
                </button>
              ) : (
                <>
                  <div className={styles.urlInputRow}>
                    <input
                      className="input"
                      placeholder="https://example.com/article"
                      value={urlInput}
                      onChange={(e) => setUrlInput(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && addUrl()}
                    />
                    <button className="btn btn-secondary" onClick={addUrl} disabled={!urlInput.trim()}>
                      Add
                    </button>
                  </div>
                  {urls.length > 0 && (
                    <div className={styles.urlList}>
                      {urls.map((u, i) => (
                        <div key={i} className={styles.urlItem}>
                          <div className={styles.urlItemInfo}>
                            <span className={styles.urlItemIcon}>🔗</span>
                            <span className={styles.urlItemText}>{u.title || u.url}</span>
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span className={`${styles.urlItemStatus} ${
                              u.status === "loading" ? styles.urlItemStatusLoading :
                              u.status === "done" ? styles.urlItemStatusDone :
                              styles.urlItemStatusError
                            }`}>
                              {u.status === "loading" ? "Fetching..." : u.status === "done" ? "Ready" : "Failed"}
                            </span>
                            <button className={styles.fileItemRemove} onClick={() => removeUrl(i)}>✕</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Goal textarea */}
            <div className={styles.chatSection}>
              <div className={styles.chatHeader}>
                <div className={styles.aiAvatarWrap}>
                  <div className="chat-avatar ai">AI</div>
                  <div>
                    <div style={{ fontSize: "0.8125rem", fontWeight: 600, color: "var(--text-primary)" }}>Fikram</div>
                    <div style={{ fontSize: "0.75rem", color: "var(--success)" }}>● Online</div>
                  </div>
                </div>
              </div>
              <div className={styles.aiPromptBox}>
                <p style={{ fontSize: "0.875rem", color: "var(--text-secondary)", lineHeight: 1.7 }}>
                  Hello, I&apos;m your AI fine-tuning assistant. Tell me what you&apos;d like your custom AI model to do, and I&apos;ll help you set everything up.
                </p>
              </div>
              <textarea
                id="goal-textarea"
                className={`input ${styles.goalTextarea}`}
                placeholder="Example: I want to build a customer support chatbot for my e-commerce store that answers questions about orders, returns, and shipping in a friendly tone..."
                value={goalText}
                onChange={(e) => setGoalText(e.target.value)}
                rows={4}
              />
            </div>

            <div className={styles.stepActions}>
              <button
                id="step1-next-btn"
                className="btn btn-primary btn-lg"
                onClick={handleStep1Next}
                disabled={!goalText.trim() || aiLoading}
              >
                {aiLoading
                  ? <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span className="animate-spin" style={{ width: 16, height: 16, border: "2px solid rgba(255,255,255,0.3)", borderTopColor: "white", borderRadius: "50%", display: "inline-block" }} />
                      AI is analyzing your goal...
                    </span>
                  : "Continue → Let the AI Configure"
                }
              </button>
              {files.length === 0 && (
                <p style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                  Dataset upload is optional — the AI can help you create training data from your description.
                </p>
              )}
            </div>
          </div>
        )}


        {/* ══════════════════════════════════════════════ */}
        {/* Step 2: AI Interview                          */}
        {/* ══════════════════════════════════════════════ */}
        {step === 2 && (
          <div className={styles.stepPanel}>
            <h2 className={styles.stepTitle}>Let&apos;s define your model</h2>
            <p className={styles.stepDesc}>
              A few quick questions to understand exactly what kind of AI you need. This helps us generate better training data.
            </p>

            {/* Chat history */}
            <div className={styles.chatHistory}>
              {chatMessages.slice(1).map((msg, i) => (
                <div
                  key={i}
                  className={styles.msgWrap}
                  style={{ justifyContent: msg.role === "user" ? "flex-end" : "flex-start" }}
                >
                  {msg.role === "ai" && <div className="chat-avatar ai" style={{ flexShrink: 0 }}>AI</div>}
                  <div className={`chat-bubble ${msg.role}`}>{msg.content}</div>
                  {msg.role === "user" && <div className="chat-avatar user" style={{ flexShrink: 0 }}>You</div>}
                </div>
              ))}
            </div>

            {/* Current question or loading */}
            {aiLoading ? (
              <div style={{ textAlign: "center", padding: "32px", color: "var(--text-muted)" }}>
                <span className="animate-spin" style={{ width: 24, height: 24, border: "2px solid rgba(255,255,255,0.1)", borderTopColor: "var(--accent-primary)", borderRadius: "50%", display: "inline-block" }} />
                <p style={{ marginTop: 12, fontSize: "0.875rem" }}>AI is thinking...</p>
              </div>
            ) : currentQuestion ? (
              <div className={styles.questionCard}>
                <div className={styles.questionHeader}>
                  <div className="chat-avatar ai">AI</div>
                  <div className="chat-bubble ai" style={{ flex: 1 }}>
                    {currentQuestion.text}
                  </div>
                </div>

                <div className="choice-grid" style={{ marginTop: 16 }}>
                  {currentQuestion.options.map((opt: string) => (
                    <div
                      key={opt}
                      className={`choice-card ${selectedOptions.includes(opt) ? "selected" : ""}`}
                      onClick={() => {
                        if (currentQuestion.multiSelect) {
                          setSelectedOptions((prev) =>
                            prev.includes(opt) ? prev.filter((o) => o !== opt) : [...prev, opt]
                          );
                        } else {
                          setSelectedOptions([opt]);
                        }
                      }}
                    >
                      <span className="choice-card-label">{opt}</span>
                    </div>
                  ))}
                </div>

                {currentQuestion.allowCustom && (
                  <div style={{ marginTop: 12 }}>
                    <input
                      className="input"
                      placeholder="Or type your own answer..."
                      value={customInput}
                      onChange={(e) => setCustomInput(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && submitAnswer()}
                    />
                  </div>
                )}

                {currentQuestion.multiSelect && (
                  <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: 8 }}>
                    You can select multiple options
                  </p>
                )}

                <div className={styles.stepActions} style={{ marginTop: 20 }}>
                  <button
                    id="submit-answer-btn"
                    className="btn btn-primary"
                    onClick={submitAnswer}
                    disabled={!selectedOptions.length && !customInput.trim()}
                  >
                    Submit Answer →
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        )}


        {/* ══════════════════════════════════════════════ */}
        {/* Step 3: Model Identity (Smart Summary Card)   */}
        {/* ══════════════════════════════════════════════ */}
        {step === 3 && (
          <div className={styles.stepPanel}>
            <h2 className={styles.stepTitle}>Your model&apos;s identity</h2>
            <p className={styles.stepDesc}>
              Based on your document and answers, here&apos;s how we&apos;ve configured your model.
              Click any tag to edit, or just approve and move on.
            </p>

            {/* Smart Summary Card */}
            <div className={styles.identityCard}>
              <div className={styles.identityCardTitle}>
                <span>◆</span> Model Identity
              </div>

              <div className={styles.identityTags}>
                {identityFields
                  .filter(({ key }) => showAllFields || key !== "boundaries" || identity?.[key])
                  .map(({ key, icon, label }) => (
                  <div
                    key={key}
                    className={`${styles.identityTag} ${editingField === key ? styles.identityTagEditing : ""}`}
                    onClick={() => !editingField && setEditingField(key)}
                  >
                    <span className={styles.identityTagIcon}>{icon}</span>
                    <span className={styles.identityTagLabel}>{label}</span>
                    {editingField === key ? (
                      <input
                        className={styles.identityTagEditInput}
                        defaultValue={identity?.[key] || ""}
                        autoFocus
                        onBlur={(e) => updateIdentityField(key, e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") updateIdentityField(key, e.currentTarget.value);
                          if (e.key === "Escape") setEditingField(null);
                        }}
                        onClick={(e) => e.stopPropagation()}
                      />
                    ) : (
                      <span className={styles.identityTagValue}>
                        {identity?.[key] || "Not set — click to define"}
                      </span>
                    )}
                  </div>
                ))}
              </div>

              {!showAllFields && (
                <button className={styles.customizeBtn} onClick={() => setShowAllFields(true)} style={{ marginTop: 16 }}>
                  ✏️ Customize all fields
                </button>
              )}

              <div className={styles.identityActions}>
                <button className="btn btn-primary" onClick={handleIdentityConfirm}>
                  Looks Perfect →
                </button>
                <button className="btn btn-ghost" onClick={() => setStep(2)}>← Back</button>
              </div>
            </div>

            {/* ── Example Calibration (expandable) ── */}
            <div className={styles.expandableSection}>
              {!showExamples ? (
                <button className={styles.expandableToggle} onClick={() => setShowExamples(true)}>
                  💡 Want better results? Add an example Q&amp;A (optional)
                </button>
              ) : (
                <div className={styles.expandableContent}>
                  <div style={{ fontSize: "0.8125rem", fontWeight: 600, color: "var(--text-primary)", marginBottom: 16 }}>
                    Example Q&amp;A pairs — show the AI how you want answers to look
                  </div>
                  {goldExamples.map((ex, i) => (
                    <div key={i} className={styles.examplePair}>
                      <div>
                        <div className={styles.exampleLabel}>Example question</div>
                        <textarea
                          className={styles.exampleInput}
                          placeholder="e.g., Is investing in Tesla halal?"
                          value={ex.question}
                          onChange={(e) => {
                            const updated = [...goldExamples];
                            updated[i] = { ...updated[i], question: e.target.value };
                            setGoldExamples(updated);
                          }}
                          rows={2}
                        />
                      </div>
                      <div>
                        <div className={styles.exampleLabel}>How you&apos;d want the answer</div>
                        <textarea
                          className={styles.exampleInput}
                          placeholder="e.g., Debated (leans halal). Tesla passes the primary AAOIFI screens..."
                          value={ex.answer}
                          onChange={(e) => {
                            const updated = [...goldExamples];
                            updated[i] = { ...updated[i], answer: e.target.value };
                            setGoldExamples(updated);
                          }}
                          rows={3}
                        />
                      </div>
                    </div>
                  ))}
                  {goldExamples.length < 3 && (
                    <button
                      className={styles.addExampleBtn}
                      onClick={() => setGoldExamples([...goldExamples, { question: "", answer: "" }])}
                    >
                      + Add another example
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* ── Boundaries (expandable) ── */}
            <div className={styles.expandableSection}>
              {!showBoundaries ? (
                <button className={styles.expandableToggle} onClick={() => setShowBoundaries(true)}>
                  🚫 Set boundaries — what should your model never do? (optional)
                </button>
              ) : (
                <div className={styles.expandableContent}>
                  <div style={{ fontSize: "0.8125rem", fontWeight: 600, color: "var(--text-primary)", marginBottom: 12 }}>
                    Boundaries &amp; rules
                  </div>
                  <div className={styles.boundaryChips}>
                    {BOUNDARY_PRESETS.map((preset) => (
                      <button
                        key={preset}
                        className={`${styles.boundaryChip} ${activeBoundaryPresets.includes(preset) ? styles.boundaryChipActive : ""}`}
                        onClick={() => {
                          setActiveBoundaryPresets((prev) =>
                            prev.includes(preset) ? prev.filter((p) => p !== preset) : [...prev, preset]
                          );
                        }}
                      >
                        {preset}
                      </button>
                    ))}
                  </div>
                  <textarea
                    className={styles.exampleInput}
                    placeholder="Or type your own boundary rules..."
                    value={boundaries}
                    onChange={(e) => setBoundaries(e.target.value)}
                    rows={2}
                  />
                </div>
              )}
            </div>
          </div>
        )}


        {/* ══════════════════════════════════════════════ */}
        {/* Step 4: Preview                               */}
        {/* ══════════════════════════════════════════════ */}
        {step === 4 && (
          <div className={styles.stepPanel}>
            <h2 className={styles.stepTitle}>Preview your training data</h2>
            <p className={styles.stepDesc}>
              Here are 5 sample Q&amp;A pairs we&apos;d generate. Approve the ones you like,
              reject any that need work, or skip this step entirely.
            </p>

            {previewLoading ? (
              <div style={{ textAlign: "center", padding: "48px 24px", color: "var(--text-muted)" }}>
                <span className="animate-spin" style={{ width: 28, height: 28, border: "2.5px solid rgba(255,255,255,0.1)", borderTopColor: "var(--accent-primary)", borderRadius: "50%", display: "inline-block" }} />
                <p style={{ marginTop: 16, fontSize: "0.875rem" }}>Generating sample pairs...</p>
                <p style={{ marginTop: 6, fontSize: "0.75rem", color: "var(--text-muted)" }}>This takes about 10 seconds</p>
              </div>
            ) : previewPairs.length > 0 ? (
              <>
                <div className={styles.previewGrid}>
                  {previewPairs.map((pair, i) => (
                    <div
                      key={i}
                      className={`${styles.previewCard} ${
                        pair.status === "approved" ? styles.previewCardApproved :
                        pair.status === "rejected" ? styles.previewCardRejected : ""
                      }`}
                    >
                      <div className={styles.previewCardHeader}>
                        <div className={styles.previewQuestion}>
                          <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>Q: </span>
                          {pair.prompt}
                        </div>
                        <div className={styles.previewActions}>
                          <button
                            className={`${styles.previewActionBtn} ${styles.previewActionBtnApprove} ${pair.status === "approved" ? styles.previewActionBtnApproved : ""}`}
                            onClick={() => togglePreviewPair(i, "approved")}
                            title="Approve"
                          >
                            ✓
                          </button>
                          <button
                            className={`${styles.previewActionBtn} ${styles.previewActionBtnReject} ${pair.status === "rejected" ? styles.previewActionBtnRejected : ""}`}
                            onClick={() => togglePreviewPair(i, "rejected")}
                            title="Reject"
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                      <div className={styles.previewAnswer}>{pair.completion}</div>
                    </div>
                  ))}
                </div>

                {/* Feedback area for rejected pairs */}
                {previewPairs.some((p) => p.status === "rejected") && (
                  <div className={styles.previewFeedback}>
                    <div style={{ fontSize: "0.8125rem", fontWeight: 600, color: "var(--text-primary)", marginBottom: 8 }}>
                      What should be different?
                    </div>
                    <textarea
                      className={styles.exampleInput}
                      placeholder="e.g., Answers should be shorter, more concise, always start with the verdict..."
                      value={previewFeedback}
                      onChange={(e) => setPreviewFeedback(e.target.value)}
                      rows={2}
                    />
                  </div>
                )}
              </>
            ) : (
              <div style={{ textAlign: "center", padding: "32px", color: "var(--text-muted)", fontSize: "0.875rem" }}>
                Couldn&apos;t generate preview samples. You can skip this step and proceed to launch.
              </div>
            )}

            <div className={styles.stepActions}>
              <button className="btn btn-primary btn-lg" onClick={handlePreviewDone}>
                {previewPairs.length > 0 ? "These Look Great →" : "Continue →"}
              </button>
              <button className="btn btn-ghost" onClick={handlePreviewSkip}>
                Skip Preview
              </button>
              <button className="btn btn-ghost" onClick={() => setStep(3)}>← Back</button>
            </div>
          </div>
        )}


        {/* ══════════════════════════════════════════════ */}
        {/* Step 5: Review Config & Launch                 */}
        {/* ══════════════════════════════════════════════ */}
        {step === 5 && !launchedJobId && (
          <div className={styles.stepPanel}>
            <h2 className={styles.stepTitle}>Review your training configuration</h2>
            <p className={styles.stepDesc}>
              Our AI has auto-selected the optimal settings based on your answers. You can adjust before launching.
            </p>

            <div className={styles.configSection}>
              {/* Model selector */}
              <div className={styles.configGroup}>
                <div className={styles.configLabel}>Base Model</div>
                <div className={styles.modelPicker}>
                  {MODELS.map((m) => (
                    <div
                      key={m.id}
                      className={`${styles.modelOption} ${selectedModel === m.id ? styles.modelOptionSelected : ""}`}
                      onClick={() => setSelectedModel(m.id)}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span className={styles.modelOptionName}>{m.name}</span>
                        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                          <span className="badge badge-default" style={{ fontSize: "0.575rem", textTransform: "capitalize" }}>{m.category}</span>
                          {m.recommended && <span className="badge badge-success" style={{ fontSize: "0.575rem" }}>Best Pick</span>}
                        </div>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 2 }}>
                        <div className={styles.modelOptionCredits}>~{m.credits.min}–{m.credits.max} credits · {m.size} · Quality {m.quality}/10</div>
                      </div>
                      {selectedModel === m.id && (
                        <div style={{ marginTop: 6, fontSize: "0.7rem", color: "var(--text-muted)", lineHeight: 1.4 }}>
                          <strong>Best for:</strong> {m.bestFor.slice(0, 3).join(", ")}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Non-recommended model warning */}
              {(() => {
                const sel = MODELS.find((m) => m.id === selectedModel);
                if (!sel) {
                  return (
                    <div style={{
                      background: "rgba(239, 68, 68, 0.08)",
                      border: "1px solid rgba(239, 68, 68, 0.2)",
                      borderRadius: 8, padding: "10px 14px", marginTop: 8,
                      fontSize: "0.75rem", color: "#ef4444",
                    }}>
                      <strong>Community model selected.</strong> This model is not verified on our platform. Training results and accuracy may be unpredictable. For best results, use a verified model.
                    </div>
                  );
                } else if (!sel.recommended && sel.quality < 7) {
                  return (
                    <div style={{
                      background: "rgba(234, 179, 8, 0.08)",
                      border: "1px solid rgba(234, 179, 8, 0.2)",
                      borderRadius: 8, padding: "10px 14px", marginTop: 8,
                      fontSize: "0.75rem", color: "#d97706",
                    }}>
                      <strong>{sel.name}</strong> has a quality rating of {sel.quality}/10. For higher accuracy, consider a recommended model like Llama 3.1 8B.
                    </div>
                  );
                }
                return null;
              })()}
              <div className={styles.configGroup}>
                <div className={styles.configLabel}>Training Parameters</div>
                <div className={styles.configGrid}>
                  {[
                    { label: "Method", value: config.method },
                    { label: "Epochs", value: config.epochs },
                    { label: "Learning Rate", value: config.learningRate },
                    { label: "Batch Size", value: config.batchSize },
                    { label: "Warmup Steps", value: config.warmupSteps },
                    { label: "Dataset", value: files.length > 0 ? `${files.length} file${files.length > 1 ? "s" : ""}` : "From description" },
                  ].map(({ label, value }) => (
                    <div key={label} className={styles.configParam}>
                      <div className={styles.configParamLabel}>{label}</div>
                      <div className={styles.configParamValue}>{String(value)}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Job name */}
              <div className={styles.configGroup}>
                <div className="input-group">
                  <label htmlFor="job-name-input" className="input-label">Job Name (optional)</label>
                  <input
                    id="job-name-input"
                    className="input"
                    placeholder="My Customer Support Bot"
                    value={jobName}
                    onChange={(e) => setJobName(e.target.value)}
                  />
                </div>
              </div>

              {/* Cost estimate */}
              <div className={styles.estimateCard}>
                <div className={styles.estimateRow}>
                  <span className={styles.estimateLabel}>Estimated credits</span>
                  <span className={styles.estimateValue}>~{config.estimatedCredits} credits</span>
                </div>
                <div className={styles.estimateRow}>
                  <span className={styles.estimateLabel}>Estimated time</span>
                  <span className={styles.estimateValue}>{config.estimatedTime}</span>
                </div>
                <div className={styles.estimateRow}>
                  <span className={styles.estimateLabel}>Your balance after</span>
                  <span className={styles.estimateValue} style={{ color: "var(--success)" }}>
                    {100 - config.estimatedCredits} credits remaining
                  </span>
                </div>
              </div>
            </div>

            <div className={styles.stepActions}>
              <button
                id="launch-job-btn"
                className="btn btn-primary btn-lg"
                onClick={handleLaunch}
                disabled={launching}
              >
                {launching ? (
                  <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span className="animate-spin" style={{ width: 16, height: 16, border: "2px solid rgba(255,255,255,0.3)", borderTopColor: "white", borderRadius: "50%", display: "inline-block" }} />
                    {generationStatus || "Launching job..."}
                  </span>
                ) : "Launch Fine-Tuning Job"}
              </button>
              <button className="btn btn-ghost" onClick={() => setStep(4)}>← Back</button>
            </div>
          </div>
        )}

        {/* ── Step 5: Launched Success ── */}
        {step === 5 && launchedJobId && (
          <div className={styles.successPanel}>
            <div className={styles.successIcon}>◆</div>
            <h2 className={styles.successTitle}>Job Launched Successfully!</h2>
            <p className={styles.successDesc}>
              Your fine-tuning job is now queued and will start shortly.
              We&apos;ll notify you when it completes.
            </p>
            <div className={styles.successActions}>
              <Link href={`/jobs/${launchedJobId}`} className="btn btn-primary btn-lg">
                View Job Status →
              </Link>
              <Link href="/jobs" className="btn btn-secondary">
                All Jobs
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
