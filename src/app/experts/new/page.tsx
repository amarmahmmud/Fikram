"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import styles from "./page.module.css";

type Step = 1 | 2 | 3;

interface UploadedFile {
  file: File;
  status: "pending" | "uploading" | "done" | "error";
  chunksStored?: number;
  error?: string;
}

export default function NewExpertPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [expertId, setExpertId] = useState<string | null>(null);
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [creating, setCreating] = useState(false);
  const [ingesting, setIngesting] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

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
      ...valid.map((file) => ({ file, status: "pending" as const })),
    ]);
  }

  async function handleIngest() {
    if (!expertId || files.length === 0) return;
    setIngesting(true);

    for (let i = 0; i < files.length; i++) {
      if (files[i].status === "done") continue;

      setFiles((prev) =>
        prev.map((f, idx) => (idx === i ? { ...f, status: "uploading" } : f))
      );

      try {
        const formData = new FormData();
        formData.append("file", files[i].file);

        const res = await fetch(`/api/experts/${expertId}/ingest`, {
          method: "POST",
          body: formData,
        });
        const data = await res.json();

        if (data.ok) {
          setFiles((prev) =>
            prev.map((f, idx) =>
              idx === i ? { ...f, status: "done", chunksStored: data.chunksStored } : f
            )
          );
        } else {
          setFiles((prev) =>
            prev.map((f, idx) =>
              idx === i ? { ...f, status: "error", error: data.error } : f
            )
          );
        }
      } catch {
        setFiles((prev) =>
          prev.map((f, idx) =>
            idx === i ? { ...f, status: "error", error: "Upload failed" } : f
          )
        );
      }
    }

    setIngesting(false);
    setStep(3);
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

            <div className={styles.field}>
              <label className={styles.label}>Style Instructions (optional)</label>
              <textarea
                className={styles.textarea}
                placeholder="e.g., Speak in a friendly, encouraging tone. Use simple language. Always give practical examples."
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
              Upload the expert's content — PDFs, text files, course materials. The AI will read and learn from these.
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

            {/* File list */}
            {files.length > 0 && (
              <div className={styles.fileList}>
                {files.map((f, i) => (
                  <div key={i} className={styles.fileRow}>
                    <span className={styles.fileName}>{f.file.name}</span>
                    <span className={styles.fileSize}>
                      {(f.file.size / 1024).toFixed(0)} KB
                    </span>
                    <span className={`${styles.fileStatus} ${styles[`fileStatus_${f.status}`]}`}>
                      {f.status === "pending" && "Ready"}
                      {f.status === "uploading" && "Processing..."}
                      {f.status === "done" && `✓ ${f.chunksStored} chunks`}
                      {f.status === "error" && `✗ ${f.error}`}
                    </span>
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
                {ingesting ? "Processing..." : `Process ${files.length} file${files.length !== 1 ? "s" : ""} →`}
              </button>
              {allDone && (
                <button className="btn btn-secondary" onClick={() => setStep(3)}>
                  Continue →
                </button>
              )}
            </div>
          </div>
        )}

        {/* Step 3: Done */}
        {step === 3 && (
          <div className={styles.card} style={{ textAlign: "center" }}>
            <div style={{ fontSize: "2rem", marginBottom: 16, color: "var(--accent-indigo)" }}>◆</div>
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
