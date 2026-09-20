"use client";

import { useState, useEffect, useRef } from "react";
import styles from "./KnowledgeModal.module.css";
import { BookOpen, FileText, UploadCloud, X, CheckCircle2, AlertCircle, Image, FileAudio, Film, ShieldCheck, Flame, Scale, Globe, Coins, RotateCcw, WifiOff } from "lucide-react";
import { apiClient } from "@/lib/apiClient";
import { createClient } from "@/lib/supabase/client";
import { BuyCreditsModal } from "@/components/BuyCreditsModal";
import { InsufficientCreditsBanner } from "@/components/InsufficientCreditsBanner";
import { uploadFileToStorage } from "@/lib/upload-client";

interface SourceItem {
  filename: string;
  chunkCount: number;
}

interface KnowledgeModalProps {
  isOpen: boolean;
  onClose: () => void;
  expertId: string;
  isOwner?: boolean;
  onSourcesUpdated?: () => void;
}

export function KnowledgeModal({
  isOpen,
  onClose,
  expertId,
  isOwner = false,
  onSourcesUpdated,
}: KnowledgeModalProps) {
  const [sources, setSources] = useState<SourceItem[]>([]);
  const [totalChunks, setTotalChunks] = useState(0);
  const [reasoningMode, setReasoningMode] = useState<"strict" | "evaluative" | "hybrid">("hybrid");
  const [webSearchEnabled, setWebSearchEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ type: "success" | "error" | "info"; text: string } | null>(null);
  const [creditsBalance, setCreditsBalance] = useState<number | null>(null);
  const [showBuyModal, setShowBuyModal] = useState(false);
  const [insufficientCreditsError, setInsufficientCreditsError] = useState<{ required: number; balance: number; message?: string } | null>(null);
  const [failedFiles, setFailedFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const supabase = createClient();

  async function loadUserCredits() {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: profile } = await supabase
        .from("profiles")
        .select("credits_balance, credits_held")
        .eq("id", user.id)
        .single();

      if (profile) {
        const avail = Math.max(0, (profile.credits_balance ?? 0) - (profile.credits_held ?? 0));
        setCreditsBalance(avail);
      }
    } catch (e) {
      console.warn("[KnowledgeModal] loadUserCredits error:", e);
    }
  }

  async function loadSources() {
    try {
      setLoading(true);
      const res = await apiClient.get<any>(`/api/experts/${expertId}`);
      if (res.ok) {
        setSources(res.sources || []);
        setTotalChunks(res.totalChunks || 0);
        if (res.metadata) {
          setReasoningMode(res.metadata.reasoningMode || "hybrid");
          setWebSearchEnabled(Boolean(res.metadata.webSearchEnabled));
        }
      }
    } catch (err: any) {
      console.error("Failed to load expert sources:", err);
    } finally {
      setLoading(false);
    }
  }

  async function handleUpdateMode(newMode: "strict" | "evaluative" | "hybrid") {
    setReasoningMode(newMode);
    try {
      await apiClient.patch(`/api/experts/${expertId}`, { reasoningMode: newMode });
      if (onSourcesUpdated) onSourcesUpdated();
    } catch (e) {
      console.error("Failed to update mode:", e);
    }
  }

  async function handleToggleWebSearch() {
    const nextVal = !webSearchEnabled;
    setWebSearchEnabled(nextVal);
    try {
      await apiClient.patch(`/api/experts/${expertId}`, { webSearchEnabled: nextVal });
      if (onSourcesUpdated) onSourcesUpdated();
    } catch (e) {
      console.error("Failed to toggle web search:", e);
    }
  }

  useEffect(() => {
    if (isOpen) {
      loadSources();
      loadUserCredits();
      setStatusMessage(null);
      setInsufficientCreditsError(null);
    }
  }, [isOpen, expertId]);

  async function processFiles(filesToProcess: File[]) {
    if (!filesToProcess || filesToProcess.length === 0) return;

    if (creditsBalance !== null && creditsBalance < 1) {
      setInsufficientCreditsError({
        required: 1,
        balance: creditsBalance,
        message: "You have 0 credits. Top up your balance to upload and index documents.",
      });
      setShowBuyModal(true);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    setUploading(true);
    setInsufficientCreditsError(null);
    setStatusMessage({ type: "info", text: "Processing & embedding documents (this may take a few seconds)..." });

    let successCount = 0;
    let failedCount = 0;
    let hitInsufficientCredits = false;
    const uncompletedFiles: File[] = [];

    for (let i = 0; i < filesToProcess.length; i++) {
      const file = filesToProcess[i];
      try {
        // Resilient upload: tries direct R2 and seamlessly falls back to server-side upload
        const { downloadUrl } = await uploadFileToStorage(file);

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

        if (!res.ok) {
          if (res.status === 402) {
            hitInsufficientCredits = true;
            const errJson = await res.json().catch(() => ({}));
            const reqCredits = errJson.credits_required || 1;
            const bal = errJson.credits_balance ?? (creditsBalance ?? 0);
            setInsufficientCreditsError({
              required: reqCredits,
              balance: bal,
              message: errJson.message || `Uploading ${file.name} requires ${reqCredits} credits.`,
            });
            failedCount++;
            uncompletedFiles.push(file);
            break; // Stop further uploads when credits are insufficient
          }

          const text = await res.text();
          let errMsg = `Server returned ${res.status}`;
          if (text.trim().startsWith("<") || text.includes("<!DOCTYPE") || text.includes("<html")) {
            errMsg = res.status === 504 ? "Processing timed out (504)." : `Server error (${res.status}).`;
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
        if (!data.ok || !data.jobId) {
          throw new Error(data.error || "Failed to create processing job");
        }

        const jobId = data.jobId;

        // Drive processing phases sequentially (safe for Vercel Hobby 15s limit)
        setStatusMessage({
          type: "info",
          text: `Extracting content from "${file.name}"...`,
        });

        let processingDone = false;
        while (!processingDone) {
          const phaseRes = await fetch(`/api/experts/${expertId}/ingest/process`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ jobId }),
          });

          if (!phaseRes.ok) {
            const errData = await phaseRes.json().catch(() => ({}));
            throw new Error(errData.error || `Processing failed (${phaseRes.status})`);
          }

          const phaseData = await phaseRes.json();

          if (phaseData.status === "completed") {
            processingDone = true;
            successCount++;
          } else if (phaseData.status === "failed") {
            throw new Error(phaseData.error || "Processing failed");
          } else {
            // In progress — update user with real-time phase & chunk count
            const phase = phaseData.phase || "";
            const isEmbedding = phase === "extracted" || phase.startsWith("embedding:");
            if (isEmbedding) {
              const current = phaseData.chunksStored || 0;
              const total = phaseData.totalChunks || "?";
              setStatusMessage({
                type: "info",
                text: `Indexing "${file.name}" (${current}/${total} chunks)...`,
              });
            } else {
              setStatusMessage({
                type: "info",
                text: `Extracting content from "${file.name}"...`,
              });
            }
          }
        }
      } catch (err) {
        if (!hitInsufficientCredits) {
          failedCount++;
          uncompletedFiles.push(file);
          console.error(`Failed to upload ${file.name}:`, err);
        }
      }
    }

    setFailedFiles(uncompletedFiles);

    if (hitInsufficientCredits) {
      setStatusMessage(null);
    } else if (failedCount === 0) {
      setStatusMessage({
        type: "success",
        text: `Successfully ingested and indexed ${successCount} document${successCount > 1 ? "s" : ""}!`,
      });
      loadUserCredits();
    } else {
      setStatusMessage({
        type: "error",
        text: `${successCount} succeeded, ${failedCount} failed. You can retry failed files below.`,
      });
      loadUserCredits();
    }

    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
    await loadSources();
    if (onSourcesUpdated) onSourcesUpdated();
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setFailedFiles([]);
    await processFiles(Array.from(files));
  }

  async function handleRetryFailedFiles() {
    if (failedFiles.length === 0) return;
    const toRetry = [...failedFiles];
    await processFiles(toRetry);
  }

  if (!isOpen) return null;

  return (
    <div className={styles.overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className={styles.modal}>
        {/* Header */}
        <div className={styles.header}>
          <div className={styles.titleGroup}>
            <div className={styles.iconWrap}>
              <BookOpen size={20} />
            </div>
            <div>
              <div className={styles.title}>Knowledge Base</div>
              <div className={styles.subtitle}>
                {totalChunks} indexed chunks across {sources.length} document{sources.length !== 1 ? "s" : ""}
              </div>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {creditsBalance !== null && (
              <button
                type="button"
                className={`${styles.creditPillBtn} ${creditsBalance === 0 ? styles.creditPillWarning : ""}`}
                onClick={() => setShowBuyModal(true)}
                title="Click to refill credits"
              >
                <Coins size={13} />
                <span>{creditsBalance.toLocaleString()} credits</span>
              </button>
            )}
            <button className={styles.closeBtn} onClick={onClose} aria-label="Close dialog">
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className={styles.body}>
          {/* Active Sources List */}
          <div>
            <div className={styles.sectionTitle}>Indexed Sources</div>
            {loading ? (
              <div className={styles.emptySources}>Loading sources...</div>
            ) : sources.length === 0 ? (
              <div className={styles.emptySources}>
                No knowledge base documents indexed yet.
              </div>
            ) : (
              <div className={styles.sourceList}>
                {sources.map((s, idx) => (
                  <div key={idx} className={styles.sourceItem}>
                    <div className={styles.sourceInfo}>
                      {(() => {
                        const ext = s.filename.split(".").pop()?.toLowerCase() || "";
                        const isImg = ["png", "jpg", "jpeg", "webp", "gif", "heic"].includes(ext);
                        const isAud = ["mp3", "wav", "m4a", "ogg", "aac", "flac"].includes(ext);
                        const isVid = ["mp4", "webm", "mov"].includes(ext);
                        if (isImg) return <Image size={16} color="var(--accent-primary)" />;
                        if (isAud) return <FileAudio size={16} color="var(--accent-primary)" />;
                        if (isVid) return <Film size={16} color="var(--accent-primary)" />;
                        return <FileText size={16} color="var(--accent-primary)" />;
                      })()}
                      <span className={styles.sourceName} title={s.filename}>
                        {s.filename}
                      </span>
                    </div>
                    <span className={styles.chunkBadge}>
                      {s.chunkCount} chunks
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Reasoning & Intelligence Configuration for Owner */}
          {isOwner && (
            <div>
              <div className={styles.sectionTitle}>Reasoning &amp; Intelligence Mode</div>
              <div className={styles.modePills}>
                <button
                  type="button"
                  className={`${styles.modePill} ${reasoningMode === "strict" ? styles.modePillActive : ""}`}
                  onClick={() => handleUpdateMode("strict")}
                  title="Answer strictly from documents. Refuses if not found."
                >
                  <ShieldCheck size={14} style={{ display: "inline-block", verticalAlign: "text-bottom", marginRight: 5 }} />
                  <span>Strict (Docs Only)</span>
                </button>
                <button
                  type="button"
                  className={`${styles.modePill} ${reasoningMode === "evaluative" ? styles.modePillActive : ""}`}
                  onClick={() => handleUpdateMode("evaluative")}
                  title="Uses docs as rubrics. Evaluates new pitches with logic and sharp wit."
                >
                  <Flame size={14} style={{ display: "inline-block", verticalAlign: "text-bottom", marginRight: 5 }} />
                  <span>Critical Thinker</span>
                </button>
                <button
                  type="button"
                  className={`${styles.modePill} ${reasoningMode === "hybrid" ? styles.modePillActive : ""}`}
                  onClick={() => handleUpdateMode("hybrid")}
                  title="Uses docs as primary ground, but explains and extrapolates freely."
                >
                  <Scale size={14} style={{ display: "inline-block", verticalAlign: "text-bottom", marginRight: 5 }} />
                  <span>Hybrid Balanced</span>
                </button>
              </div>

              <div
                className={styles.webSearchToggle}
                onClick={handleToggleWebSearch}
              >
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <span style={{ fontSize: "0.8125rem", fontWeight: 600, color: "var(--text-primary)", display: "flex", alignItems: "center", gap: 6 }}>
                    <Globe size={14} />
                    <span>Live Web Search &amp; Market Intelligence</span>
                  </span>
                  <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                    Searches Google/web in real-time for market trends, competitors &amp; breaking news
                  </span>
                </div>
                <input
                  type="checkbox"
                  checked={webSearchEnabled}
                  onChange={handleToggleWebSearch}
                  style={{ width: 16, height: 16, accentColor: "var(--accent-primary)", cursor: "pointer" }}
                  onClick={(e) => e.stopPropagation()}
                />
              </div>
            </div>
          )}

          {/* Upload Area for Owner */}
          {isOwner && (
            <div>
              <div className={styles.sectionTitle}>Add More Knowledge</div>
              <div className={styles.costGuide}>
                <span>1 credit / doc or image • 5 credits / audio • 10 credits / video</span>
                {creditsBalance !== null && (
                  <span style={{ color: creditsBalance === 0 ? "#fbbf24" : "var(--accent-primary)", fontWeight: 600 }}>
                    {creditsBalance.toLocaleString()} credits available
                  </span>
                )}
              </div>

              <div
                className={styles.dropzone}
                onClick={() => !uploading && fileInputRef.current?.click()}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.txt,.md,.csv,.json,.png,.jpg,.jpeg,.webp,.gif,.heic,.mp3,.wav,.m4a,.ogg,.aac,.flac,.mp4,.webm,.mov"
                  multiple
                  hidden
                  onChange={handleFileUpload}
                  disabled={uploading}
                />
                <UploadCloud size={28} color="var(--accent-primary)" style={{ margin: "0 auto" }} />
                <div className={styles.dropzoneText}>
                  {uploading
                    ? "Processing & embedding content..."
                    : "Click to upload documents, images, audio, or video"}
                </div>
              </div>

              {insufficientCreditsError && (
                <div style={{ marginTop: 12 }}>
                  <InsufficientCreditsBanner
                    balance={insufficientCreditsError.balance}
                    required={insufficientCreditsError.required}
                    actionText="index documents into this knowledge base"
                    onTopUpClick={() => setShowBuyModal(true)}
                  />
                </div>
              )}

              {failedFiles.length > 0 && !uploading && !insufficientCreditsError && (
                <div
                  style={{
                    marginTop: 12,
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
                    <span>{failedFiles.length} file{failedFiles.length > 1 ? "s" : ""} failed to upload due to connection issues.</span>
                  </div>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={handleRetryFailedFiles}
                    style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
                  >
                    <RotateCcw size={13} />
                    <span>Retry {failedFiles.length} File{failedFiles.length > 1 ? "s" : ""}</span>
                  </button>
                </div>
              )}

              {statusMessage && !insufficientCreditsError && (
                <div
                  style={{
                    marginTop: 12,
                    padding: "10px 14px",
                    borderRadius: "var(--radius-md)",
                    fontSize: "0.8125rem",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    background:
                      statusMessage.type === "success"
                        ? "rgba(0, 229, 200, 0.1)"
                        : statusMessage.type === "error"
                        ? "rgba(255, 77, 77, 0.1)"
                        : "rgba(255, 255, 255, 0.05)",
                    color:
                      statusMessage.type === "success"
                        ? "var(--accent-primary)"
                        : statusMessage.type === "error"
                        ? "#ff4d4d"
                        : "var(--text-secondary)",
                    border: `1px solid ${
                      statusMessage.type === "success"
                        ? "rgba(0, 229, 200, 0.3)"
                        : statusMessage.type === "error"
                        ? "rgba(255, 77, 77, 0.3)"
                        : "var(--border)"
                    }`,
                  }}
                >
                  {statusMessage.type === "success" && <CheckCircle2 size={16} />}
                  {statusMessage.type === "error" && <AlertCircle size={16} />}
                  {statusMessage.text}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className={styles.footer}>
          <button className="btn btn-secondary btn-sm" onClick={onClose}>
            Close
          </button>
        </div>
      </div>

      <BuyCreditsModal
        isOpen={showBuyModal}
        onClose={() => setShowBuyModal(false)}
        creditsRequired={insufficientCreditsError?.required}
        currentBalance={creditsBalance ?? 0}
        actionName="index documents into this knowledge base"
        onSuccess={(newBal) => {
          setCreditsBalance(newBal);
          setInsufficientCreditsError(null);
          setStatusMessage({
            type: "success",
            text: `Credits refilled! Your available balance is now ${newBal.toLocaleString()} credits.`,
          });
        }}
      />
    </div>
  );
}
