"use client";

import { useState, useEffect } from "react";
import styles from "./PublishModal.module.css";
import { apiClient } from "@/lib/apiClient";
import { Globe, Lock, X, AlertTriangle, Check, Copy, Code } from "lucide-react";

interface PublishModalProps {
  isOpen: boolean;
  onClose: () => void;
  type: "job" | "expert";
  id: string;
  initialTitle?: string;
  initialDescription?: string;
  initialCategory?: string;
  initialPublished?: boolean;
  onPublishSuccess?: (isPublished: boolean, updatedData?: Record<string, unknown>) => void;
}

const CATEGORIES = [
  "General",
  "Coding",
  "Finance",
  "Writing",
  "Healthcare",
  "Legal",
  "Education",
  "Creative",
];

export function PublishModal({
  isOpen,
  onClose,
  type,
  id,
  initialTitle = "",
  initialDescription = "",
  initialCategory = "General",
  initialPublished = false,
  onPublishSuccess,
}: PublishModalProps) {
  const [isPublished, setIsPublished] = useState(initialPublished);
  const [title, setTitle] = useState(initialTitle);
  const [description, setDescription] = useState(initialDescription);
  const [category, setCategory] = useState(initialCategory);
  const [saving, setSaving] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedEmbed, setCopiedEmbed] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setIsPublished(initialPublished);
    setTitle(initialTitle);
    setDescription(initialDescription);
    setCategory(initialCategory || "General");
    setError("");
  }, [initialPublished, initialTitle, initialDescription, initialCategory, isOpen]);

  if (!isOpen) return null;

  const origin = typeof window !== "undefined" ? window.location.origin : "https://fikram.ai";
  const shareUrl = type === "expert" 
    ? `${origin}/experts/${id}/chat` 
    : `${origin}/playground/${id}`;

  const embedCode = `<iframe src="${shareUrl}" width="100%" height="600" style="border:none;border-radius:12px;" allow="clipboard-write"></iframe>`;

  const copyToClipboard = (text: string, isEmbed = false) => {
    navigator.clipboard.writeText(text);
    if (isEmbed) {
      setCopiedEmbed(true);
      setTimeout(() => setCopiedEmbed(false), 2000);
    } else {
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    }
  };

  async function handleSave() {
    setSaving(true);
    setError("");

    try {
      const data = await apiClient.post<any>("/api/publish", {
        type,
        id,
        published: isPublished,
        title: title.trim() || initialTitle,
        description: description.trim(),
        category,
      });

      if (!data.ok) {
        throw new Error(data.error || "Failed to update publication status");
      }

      if (onPublishSuccess) {
        onPublishSuccess(isPublished, data.item);
      }
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error saving publication");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className={styles.header}>
          <div className={styles.titleGroup}>
            <div className={styles.iconWrap}><Globe size={24} /></div>
            <div>
              <div className={styles.title}>Publish & Share to Public</div>
              <div className={styles.subtitle}>
                {type === "expert" ? "Smart Assistant" : "Fine-Tuned Custom Model"}
              </div>
            </div>
          </div>
          <button className={styles.closeBtn} onClick={onClose} aria-label="Close modal">
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className={styles.body}>
          {error && (
            <div className="badge badge-error" style={{ padding: "8px 12px", width: "100%", justifyContent: "flex-start", display: "flex", alignItems: "center", gap: 6 }}>
              <AlertTriangle size={14} />
              <span>{error}</span>
            </div>
          )}

          {/* Visibility Switch */}
          <div className={styles.visibilitySwitch}>
            <button
              type="button"
              className={`${styles.visOption} ${!isPublished ? styles.active : ""}`}
              onClick={() => setIsPublished(false)}
            >
              <Lock size={14} style={{ marginRight: 6, display: 'inline-block', verticalAlign: 'text-bottom' }} /> Private (Draft)
            </button>
            <button
              type="button"
              className={`${styles.visOption} ${isPublished ? `${styles.active} ${styles.activePublic}` : ""}`}
              onClick={() => setIsPublished(true)}
            >
              <Globe size={14} style={{ marginRight: 6, display: 'inline-block', verticalAlign: 'text-bottom' }} /> Public (Published)
            </button>
          </div>

          {isPublished && (
            <>
              {/* Public Title */}
              <div className={styles.fieldGroup}>
                <label className={styles.label}>Public Display Name</label>
                <input
                  type="text"
                  className="input"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Legal Contract Auditor"
                />
              </div>

              {/* Category */}
              <div className={styles.fieldGroup}>
                <label className={styles.label}>Category</label>
                <select
                  className={styles.select}
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                >
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>

              {/* Public Description */}
              <div className={styles.fieldGroup}>
                <label className={styles.label}>Public Bio / Description</label>
                <textarea
                  className="input"
                  rows={3}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Describe what your AI is specialized in and what knowledge it possesses..."
                />
              </div>

              {/* Public Share URL */}
              <div className={styles.fieldGroup}>
                <label className={styles.label}>Direct Share Link</label>
                <div className={styles.linkBox}>
                  <span className={styles.linkText}>{shareUrl}</span>
                  <button
                    type="button"
                    className={`${styles.copyBtn} ${copiedLink ? styles.copied : ""}`}
                    onClick={() => copyToClipboard(shareUrl, false)}
                    style={{ display: "inline-flex", alignItems: "center", gap: 5 }}
                  >
                    {copiedLink ? <><Check size={13} /> Copied!</> : <><Copy size={13} /> Copy Link</>}
                  </button>
                </div>
              </div>

              {/* Embed Code */}
              <div className={styles.fieldGroup}>
                <label className={styles.label}>Embed Widget (iFrame)</label>
                <div className={styles.linkBox}>
                  <span className={styles.linkText} style={{ color: "var(--text-muted)", fontSize: "0.7rem" }}>
                    &lt;iframe src=&quot;{shareUrl}&quot; ... /&gt;
                  </span>
                  <button
                    type="button"
                    className={`${styles.copyBtn} ${copiedEmbed ? styles.copied : ""}`}
                    onClick={() => copyToClipboard(embedCode, true)}
                    style={{ display: "inline-flex", alignItems: "center", gap: 5 }}
                  >
                    {copiedEmbed ? <><Check size={13} /> Copied Snippet!</> : <><Code size={13} /> Copy Embed</>}
                  </button>
                </div>
              </div>
            </>
          )}

          {!isPublished && (
            <p style={{ fontSize: "0.8125rem", color: "var(--text-muted)", lineHeight: 1.6 }}>
              This model is currently <strong>Private</strong>. Only you can test and use it while signed in. Switching it to <strong>Public</strong> will feature it in the Community Showcase directory and enable a shareable public chat link.
            </p>
          )}
        </div>

        {/* Footer */}
        <div className={styles.footer}>
          <button className="btn btn-ghost btn-sm" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button
            className="btn btn-primary btn-sm"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? "Saving..." : isPublished ? <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>Save & Publish <Globe size={14} /></span> : <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>Save as Private <Lock size={14} /></span>}
          </button>
        </div>
      </div>
    </div>
  );
}
