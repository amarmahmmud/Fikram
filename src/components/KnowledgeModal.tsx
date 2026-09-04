"use client";

import { useState, useEffect, useRef } from "react";
import styles from "./KnowledgeModal.module.css";
import { BookOpen, FileText, UploadCloud, X, CheckCircle2, AlertCircle } from "lucide-react";
import { apiClient } from "@/lib/apiClient";

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
  const fileInputRef = useRef<HTMLInputElement>(null);

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
      setStatusMessage(null);
    }
  }, [isOpen, expertId]);

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setUploading(true);
    setStatusMessage({ type: "info", text: "Processing & embedding documents (this may take a few seconds)..." });

    let successCount = 0;
    let failedCount = 0;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      try {
        const formData = new FormData();
        formData.append("file", file);

        const res = await fetch(`/api/experts/${expertId}/ingest`, {
          method: "POST",
          body: formData,
        });
        const data = await res.json();

        if (data.ok) {
          successCount++;
        } else {
          failedCount++;
          console.error(`Failed to ingest ${file.name}:`, data.error);
        }
      } catch (err) {
        failedCount++;
        console.error(`Failed to upload ${file.name}:`, err);
      }
    }

    if (failedCount === 0) {
      setStatusMessage({
        type: "success",
        text: `Successfully ingested and indexed ${successCount} document${successCount > 1 ? "s" : ""}!`,
      });
    } else {
      setStatusMessage({
        type: "error",
        text: `${successCount} succeeded, ${failedCount} failed. Please try again.`,
      });
    }

    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
    await loadSources();
    if (onSourcesUpdated) onSourcesUpdated();
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
          <button className={styles.closeBtn} onClick={onClose}>
            <X size={16} />
          </button>
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
                      <FileText size={16} color="var(--accent-primary)" />
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
                  🔒 Strict (Docs Only)
                </button>
                <button
                  type="button"
                  className={`${styles.modePill} ${reasoningMode === "evaluative" ? styles.modePillActive : ""}`}
                  onClick={() => handleUpdateMode("evaluative")}
                  title="Uses docs as rubrics. Evaluates new pitches with logic and sharp wit."
                >
                  🔥 Critical Thinker
                </button>
                <button
                  type="button"
                  className={`${styles.modePill} ${reasoningMode === "hybrid" ? styles.modePillActive : ""}`}
                  onClick={() => handleUpdateMode("hybrid")}
                  title="Uses docs as primary ground, but explains and extrapolates freely."
                >
                  ⚖️ Hybrid Balanced
                </button>
              </div>

              <div
                className={styles.webSearchToggle}
                onClick={handleToggleWebSearch}
              >
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <span style={{ fontSize: "0.8125rem", fontWeight: 600, color: "var(--text-primary)" }}>
                    🌐 Live Web Search &amp; Market Intelligence
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
              <div
                className={styles.dropzone}
                onClick={() => !uploading && fileInputRef.current?.click()}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.txt,.md"
                  multiple
                  hidden
                  onChange={handleFileUpload}
                  disabled={uploading}
                />
                <UploadCloud size={28} color="var(--accent-primary)" style={{ margin: "0 auto" }} />
                <div className={styles.dropzoneText}>
                  {uploading
                    ? "Embedding & indexing documents..."
                    : "Click to upload PDF, TXT, or MD files"}
                </div>
              </div>

              {statusMessage && (
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
    </div>
  );
}
