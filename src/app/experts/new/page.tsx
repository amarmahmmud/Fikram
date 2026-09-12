"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import styles from "./page.module.css";
import { apiClient } from "@/lib/apiClient";

type Step = 1 | 2 | 3;

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

  // Optional AI Prompt Helper state
  const [showAiHelper, setShowAiHelper] = useState(false);
  const [selectedTone, setSelectedTone] = useState(TONE_PRESETS[0]);
  const [generatingPrompt, setGeneratingPrompt] = useState(false);

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
      const data = await res.json();
      if (data.ok && data.expert) {
        setExpertId(data.expert.id);
        setStep(2);
      } else {
        alert(data.error || "Failed to create expert");
      }
    } catch {
      alert("Network error — please try again");
    }
    setCreating(false);
  }

  // AI Prompt Suggestion Helper
  async function handleGeneratePrompt() {
    if (!name.trim()) {
      alert("Please enter an Expert Name first.");
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
        alert(res.error || "Could not generate prompt");
      }
    } catch {
      alert("Failed to generate prompt — please try again");
    }
    setGeneratingPrompt(false);
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
    const valid = newFiles.filter(
      (f) =>
        f.name.endsWith(".pdf") ||
        f.name.endsWith(".txt") ||
        f.name.endsWith(".md") ||
        f.type.startsWith("text/")
    );
    setFiles((prev) => [
      ...prev,
      ...valid.map((file) => ({ file, sourceType: "file" as const, status: "pending" as const })),
    ]);
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
        alert(res.error || "Failed to fetch content from URL");
      }
    } catch {
      alert("Network error fetching URL");
    }
    setScrapingUrl(false);
  }

  function removeFile(index: number) {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleIngest() {
    if (!expertId || files.length === 0) return;
    setIngesting(true);

    let hasErrors = false;

    for (let i = 0; i < files.length; i++) {
      if (files[i].status === "done") continue;

      setFiles((prev) =>
        prev.map((f, idx) => (idx === i ? { ...f, status: "uploading" } : f))
      );

      try {
        const file = files[i].file;
        
        // Direct-to-R2 Architecture
        const uploadRes = await fetch("/api/upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ filename: file.name, contentType: file.type }),
        });
        
        if (!uploadRes.ok) throw new Error("Failed to get upload URL");
        const { uploadUrl, downloadUrl } = await uploadRes.json();

        // Upload directly to Cloudflare R2
        const putRes = await fetch(uploadUrl, {
          method: "PUT",
          body: file,
          headers: { "Content-Type": file.type },
        });
        if (!putRes.ok) throw new Error("Failed to upload file to storage");

        // Send ingest request to backend
        const res = await fetch(`/api/experts/${expertId}/ingest`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            url: downloadUrl,
            mimeType: file.type,
            filename: file.name,
          }),
        });
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
      } catch {
        hasErrors = true;
        setFiles((prev) =>
          prev.map((f, idx) =>
            idx === i ? { ...f, status: "error", error: "Upload failed" } : f
          )
        );
      }
    }

    setIngesting(false);
    if (!hasErrors) {
      setStep(3);
    }
  }

  const totalChunks = files.reduce((a, f) => a + (f.chunksStored || 0), 0);
  const allDone = files.length > 0 && files.every((f) => f.status === "done");

  return (
    <>
      <div className="topbar">
        <span className="topbar-title">Create Smart Assistant</span>
        <Link href="/dashboard" className="btn btn-ghost btn-sm">Back to Dashboard</Link>
      </div>

      <div className="page-content">
        {/* Progress steps */}
        <div className={styles.steps}>
          {["Expert Profile", "Upload Content", "Ready"].map((label, i) => (
            <div
              key={label}
              className={`${styles.step} ${i + 1 <= step ? styles.stepActive : ""} ${i + 1 < step ? styles.stepDone : ""}`}
            >
              <div className={styles.stepNumber}>
                {i + 1 < step ? "✓" : i + 1}
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
              Define who your AI expert is. This shapes how it talks and presents itself to users.
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
                  <div className={styles.modeTitle}>🔒 Strict Grounding</div>
                  <div className={styles.modeDesc}>
                    Answers strictly with words from your documents. Refuses if not in text. Best for HR, Legal, Compliance.
                  </div>
                </div>

                <div
                  className={`${styles.modeOption} ${reasoningMode === "evaluative" ? styles.modeOptionActive : ""}`}
                  onClick={() => setReasoningMode("evaluative")}
                >
                  <div className={styles.modeTitle}>🔥 Critical Thinker</div>
                  <div className={styles.modeDesc}>
                    Uses documents as rubrics &amp; benchmarks. Evaluates new ideas using logic, economics, and sharp wit. Best for Roasts &amp; Audits.
                  </div>
                </div>

                <div
                  className={`${styles.modeOption} ${reasoningMode === "hybrid" ? styles.modeOptionActive : ""}`}
                  onClick={() => setReasoningMode("hybrid")}
                >
                  <div className={styles.modeTitle}>⚖️ Balanced Hybrid</div>
                  <div className={styles.modeDesc}>
                    Grounded in your files as primary foundation, but freely explains and extrapolates with world knowledge.
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
                    🌐 Live Web Search &amp; Market Intelligence
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
                >
                  ✨ {showAiHelper ? "Hide AI Helper" : "Generate with AI"}
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
            >
              {creating ? "Creating..." : "Continue →"}
            </button>
          </div>
        )}

        {/* Step 2: Upload */}
        {step === 2 && (
          <div className={styles.card}>
            <h2 className={styles.cardTitle}>Upload Knowledge Content</h2>
            <p className={styles.cardDesc}>
              Upload the expert&apos;s content — PDFs, text files, course materials, or web links. The AI will read and index these.
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
                accept=".pdf,.txt,.md"
                multiple
                hidden
                onChange={handleFileSelect}
              />
              <div className={styles.dropzoneIcon}>◆</div>
              <p className={styles.dropzoneText}>
                Drop files here or <span className={styles.dropzoneLink}>browse</span>
              </p>
              <p className={styles.dropzoneHint}>PDF, TXT, MD files supported</p>
            </div>

            {/* URL Ingestion Section */}
            <div className={styles.urlSection}>
              {!showUrlInput ? (
                <button
                  type="button"
                  className={styles.urlToggle}
                  onClick={() => setShowUrlInput(true)}
                >
                  🔗 + Add web links (optional)
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
                {files.map((f, i) => (
                  <div key={i} className={styles.fileRow}>
                    <span className={styles.fileIcon}>{f.sourceType === "url" ? "🔗" : "📄"}</span>
                    <span className={styles.fileName}>
                      {f.sourceType === "url" ? `${f.file.name} (${f.sourceUrl})` : f.file.name}
                    </span>
                    <span className={styles.fileSize}>
                      {(f.file.size / 1024).toFixed(0)} KB
                    </span>
                    <span className={`${styles.fileStatus} ${styles[`fileStatus_${f.status}`]}`}>
                      {f.status === "pending" && "Ready"}
                      {f.status === "uploading" && "Processing..."}
                      {f.status === "done" && `✓ ${f.chunksStored} chunks`}
                      {f.status === "error" && `✗ ${f.error}`}
                    </span>
                    {f.status === "pending" && (
                      <button
                        type="button"
                        className={styles.fileRemoveBtn}
                        onClick={() => removeFile(i)}
                        title="Remove"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}

            <div style={{ display: "flex", gap: 12, marginTop: 16 }}>
              <button
                className="btn btn-primary"
                onClick={handleIngest}
                disabled={files.length === 0 || ingesting}
              >
                {ingesting ? "Processing..." : `Process ${files.length} source${files.length !== 1 ? "s" : ""} →`}
              </button>
              {totalChunks > 0 && (
                <button className="btn btn-secondary" onClick={() => setStep(3)}>
                  {allDone ? "Continue →" : `Continue with ${totalChunks} chunks →`}
                </button>
              )}
            </div>
          </div>
        )}

        {/* Step 3: Done */}
        {step === 3 && (
          <div className={styles.card} style={{ textAlign: "center" }}>
            <div style={{ fontSize: "2rem", marginBottom: 16, color: "var(--accent-primary)" }}>◆</div>
            <h2 className={styles.cardTitle}>Your Smart Assistant is Ready</h2>
            <p className={styles.cardDesc}>
              <strong>{name}</strong> has been created with <strong>{totalChunks} knowledge chunks</strong> from your content. Start chatting now.
            </p>
            <div style={{ display: "flex", gap: 12, justifyContent: "center", marginTop: 24 }}>
              <Link
                href={`/experts/${expertId}/chat`}
                className="btn btn-primary"
              >
                Start Chatting
              </Link>
              <Link href="/dashboard" className="btn btn-secondary">
                Back to Dashboard
              </Link>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
