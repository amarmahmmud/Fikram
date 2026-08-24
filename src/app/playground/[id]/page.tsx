"use client";

import { useState, useRef, useEffect, use, useCallback } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import styles from "./page.module.css";
import type { Database } from "@/lib/supabase/types";
import { MODELS } from "@/lib/models";
import { PublishModal } from "@/components/PublishModal";

type Job = Database["public"]["Tables"]["jobs"]["Row"];
interface Message { role: "user" | "model"; content: string; ts: string; }

/** Lightweight markdown renderer for chat messages */
function renderMarkdown(text: string) {
  // Split into lines and process each
  const lines = text.split("\n");
  const elements: React.ReactNode[] = [];

  lines.forEach((line, lineIdx) => {
    // Skip empty lines but add spacing
    if (line.trim() === "") {
      elements.push(<div key={`br-${lineIdx}`} style={{ height: "0.5em" }} />);
      return;
    }

    // Process inline formatting (bold **text** and *italic*)
    const processInline = (str: string): React.ReactNode[] => {
      const parts: React.ReactNode[] = [];
      // Match **bold** patterns
      const regex = /\*\*(.+?)\*\*/g;
      let lastIndex = 0;
      let match;
      while ((match = regex.exec(str)) !== null) {
        if (match.index > lastIndex) {
          parts.push(str.substring(lastIndex, match.index));
        }
        parts.push(<strong key={`b-${match.index}`}>{match[1]}</strong>);
        lastIndex = regex.lastIndex;
      }
      if (lastIndex < str.length) {
        parts.push(str.substring(lastIndex));
      }
      return parts.length > 0 ? parts : [str];
    };

    // Check for numbered list items: "1. text" or "1) text"
    const numberedMatch = line.match(/^\s*(\d+)[.)\s]+\s*(.+)/);
    // Check for bullet points: "- text" or "* text"
    const bulletMatch = line.match(/^\s*[-*]\s+(.+)/);

    if (numberedMatch) {
      elements.push(
        <div key={lineIdx} style={{ display: "flex", gap: "8px", marginLeft: "4px", marginTop: "4px" }}>
          <span style={{ color: "var(--accent-indigo)", fontWeight: 600, minWidth: "20px" }}>{numberedMatch[1]}.</span>
          <span>{processInline(numberedMatch[2])}</span>
        </div>
      );
    } else if (bulletMatch) {
      elements.push(
        <div key={lineIdx} style={{ display: "flex", gap: "8px", marginLeft: "4px", marginTop: "2px" }}>
          <span style={{ color: "var(--text-muted)" }}>•</span>
          <span>{processInline(bulletMatch[1])}</span>
        </div>
      );
    } else {
      elements.push(<div key={lineIdx}>{processInline(line)}</div>);
    }
  });

  return <>{elements}</>;
}

export default function PlaygroundPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);
  const supabase = createClient();

  const [job, setJob] = useState<Job | null>(null);
  const [loadingJob, setLoadingJob] = useState(true);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState("");
  const [sysPrompt, setSysPrompt] = useState("You are a helpful assistant specialized in the provided business knowledge.");
  const [showConfig, setShowConfig] = useState(true);
  const [temperature, setTemperature] = useState(0.7);
  const [maxNewTokens, setMaxNewTokens] = useState(512);
  const [detectedFamily, setDetectedFamily] = useState<string | null>(null);
  const [publishModalOpen, setPublishModalOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const fetchJob = useCallback(async () => {
    try {
      const res = await fetch(`/api/jobs/sync?id=${resolvedParams.id}`);
      const resData = await res.json();
      const jobData = resData.ok && resData.job ? resData.job : null;

      const data = jobData || (await supabase
        .from("jobs")
        .select("*")
        .eq("id", resolvedParams.id)
        .single()).data;

      if (data) {
        setJob(data);
        if (messages.length === 0) {
          setMessages([
            {
              role: "model",
              content: `Hello! I am your custom AI model fine-tuned for "${data.name}". How can I help you today?`,
              ts: new Date().toLocaleTimeString(),
            }
          ]);
        }
      }
    } catch (e) {
      console.error("Error fetching job in playground:", e);
    } finally {
      setLoadingJob(false);
    }
  }, [resolvedParams.id, supabase, messages.length]);

  useEffect(() => {
    fetchJob();
  }, [fetchJob]);

  // Real-time polling if job is still running so playground unlocks automatically
  useEffect(() => {
    if (!job || job.status === "completed") return;

    const interval = setInterval(() => {
      fetchJob();
    }, 4000);

    return () => clearInterval(interval);
  }, [job, fetchJob]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function sendMessage() {
    if (!input.trim() || loading) return;
    const userMsg: Message = { role: "user", content: input.trim(), ts: new Date().toLocaleTimeString() };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
    setLoading(true);
    setLoadingStatus("Generating response with your fine-tuned model...");

    try {
      const res = await fetch("/api/playground", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId: resolvedParams.id,
          messages: newMessages,
          systemPrompt: sysPrompt,
          temperature,
          maxNewTokens,
        }),
      });
      const data = await res.json();
      if (data.ok && data.reply) {
        setMessages((prev) => [...prev, { role: "model", content: data.reply, ts: new Date().toLocaleTimeString() }]);
        if (data.detected_family && !detectedFamily) {
          setDetectedFamily(data.detected_family);
        }
      } else {
        alert(data.error || "Failed to generate response");
      }
    } catch {
      alert("Network error. Please try again.");
    } finally {
      setLoading(false);
      setLoadingStatus("");
    }
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  const isCompleted = job?.status === "completed";

  return (
    <>
      <div className="topbar">
        <Link href={`/jobs/${resolvedParams.id}`} className="btn btn-ghost btn-sm">← Job Detail</Link>
        <span className="topbar-title" style={{ flex: 1, textAlign: "center" }}>
          Playground — {job ? job.name : "Model Tester"}
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {isCompleted && (
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => setPublishModalOpen(true)}
              style={{ gap: 6 }}
            >
              <span>🌐</span>
              {(typeof job?.config === "object" && job?.config !== null && (job.config as Record<string, unknown>).published) ? "Published" : "Publish & Share"}
            </button>
          )}
          <span className={`badge ${isCompleted ? "badge-success" : "badge-warning"}`}>
            <span className={`status-dot ${job?.status || "pending"}`} />
            {job ? job.status.toUpperCase() : "LOADING"}
          </span>
        </div>
      </div>

      <div className={styles.playgroundLayout}>
        {/* Config panel */}
        {showConfig && (
          <div className={styles.configPanel}>
            <div className={styles.configPanelHead}>
              <span className={styles.configPanelTitle}>Model Config</span>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowConfig(false)} style={{ fontSize: "1rem" }}>×</button>
            </div>

            <div className="input-group">
              <label className="input-label">Model</label>
              <div className={styles.modelBadge}>
                <span style={{ fontSize: "1rem" }}>▣</span>
                <div>
                  <div style={{ fontSize: "0.8125rem", fontWeight: 700 }}>
                    {job ? job.base_model : "Llama 3.1 8B"}
                  </div>
                  <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                    LoRA fine-tuned · #{resolvedParams.id.substring(0, 8)}
                    {detectedFamily && (
                      <span style={{
                        marginLeft: 6,
                        padding: "1px 6px",
                        borderRadius: 4,
                        background: "rgba(139, 92, 246, 0.15)",
                        color: "var(--accent-indigo, #8b5cf6)",
                        fontSize: "0.6875rem",
                        fontWeight: 600,
                      }}>
                        {detectedFamily}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="input-group">
              <label className="input-label">System Prompt</label>
              <textarea
                className="input"
                rows={4}
                value={sysPrompt}
                onChange={(e) => setSysPrompt(e.target.value)}
                placeholder="Give instructions to your model..."
                style={{ resize: "vertical", fontSize: "0.8125rem" }}
              />
            </div>

            <div className="input-group">
              <label className="input-label">Temperature</label>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={temperature}
                  onChange={(e) => setTemperature(parseFloat(e.target.value))}
                  style={{ flex: 1, accentColor: "var(--accent)" }}
                />
                <span style={{ fontSize: "0.8125rem", fontFamily: "var(--font-mono)", minWidth: 32, textAlign: "right" }}>
                  {temperature.toFixed(2)}
                </span>
              </div>
              <div style={{ fontSize: "0.6875rem", color: "var(--text-muted)", marginTop: 2 }}>
                Lower = more focused, higher = more creative
              </div>
            </div>

            <div className="input-group">
              <label className="input-label">Max Tokens</label>
              <input
                type="number"
                className="input"
                value={maxNewTokens}
                min={64}
                max={2048}
                step={64}
                onChange={(e) => setMaxNewTokens(Math.max(64, Math.min(2048, parseInt(e.target.value) || 512)))}
                style={{ fontSize: "0.8125rem", fontFamily: "var(--font-mono)" }}
              />
              <div style={{ fontSize: "0.6875rem", color: "var(--text-muted)", marginTop: 2 }}>
                Maximum length of the generated response
              </div>
            </div>

            <div className="input-group">
              <label className="input-label">Engine</label>
              <div style={{ fontSize: "0.8125rem", color: "var(--text-secondary)" }}>
                Modal.com Serverless GPU (L4 / 24GB VRAM)
              </div>
            </div>

            <div className="input-group">
              <label className="input-label">Status</label>
              <div style={{ fontSize: "0.8125rem", fontWeight: 600, color: isCompleted ? "var(--success)" : "var(--warning)" }}>
                {isCompleted ? "● Ready for Testing" : "● Training in Progress"}
              </div>
            </div>
          </div>
        )}

        {/* Chat area */}
        <div className={styles.chatArea}>
          {!showConfig && (
            <button
              className={styles.configToggle}
              onClick={() => setShowConfig(true)}
              title="Show Config"
            >
              ⚙ Model Config
            </button>
          )}

          {!isCompleted && !loadingJob && (
            <div style={{
              background: "rgba(234, 179, 8, 0.08)",
              borderBottom: "1px solid rgba(234, 179, 8, 0.2)",
              padding: "10px 16px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              fontSize: "0.8125rem",
              color: "var(--warning)"
            }}>
              <span>⏳ <strong>Model is still training:</strong> The chat will automatically unlock as soon as training finishes on Modal.</span>
              <button onClick={fetchJob} className="btn btn-ghost btn-sm" style={{ color: "var(--warning)" }}>Check Status ↺</button>
            </div>
          )}

          {/* Non-recommended model warning */}
          {isCompleted && !loadingJob && job && (() => {
            const verifiedModel = MODELS.find((m) => m.id === job.base_model);
            if (!verifiedModel) {
              return (
                <div style={{
                  background: "rgba(239, 68, 68, 0.08)",
                  borderBottom: "1px solid rgba(239, 68, 68, 0.2)",
                  padding: "10px 16px",
                  fontSize: "0.8125rem",
                  color: "#ef4444",
                }}>
                  <strong>Community model:</strong> This model ({job.base_model}) is not a verified model. Accuracy and output quality may be lower than expected. For best results, use one of our verified models.
                </div>
              );
            } else if (!verifiedModel.recommended && verifiedModel.quality < 7) {
              return (
                <div style={{
                  background: "rgba(234, 179, 8, 0.08)",
                  borderBottom: "1px solid rgba(234, 179, 8, 0.2)",
                  padding: "10px 16px",
                  fontSize: "0.8125rem",
                  color: "var(--warning)",
                }}>
                  <strong>Note:</strong> You trained with {verifiedModel.name} (quality {verifiedModel.quality}/10). For higher accuracy, consider using a recommended model like Llama 3.1 8B (quality 8/10).
                </div>
              );
            }
            return null;
          })()}

          <div className={styles.messagesList}>
            <div className={styles.messagesInner}>
              {messages.map((m, i) => (
                <div
                  key={i}
                  className={`${styles.message} ${m.role === "user" ? styles.messageUser : styles.messageModel}`}
                >
                  <div className={styles.messageAvatar}>
                    {m.role === "user" ? "U" : "AI"}
                  </div>
                  <div className={styles.messageContent}>
                    <div className={styles.messageMeta}>
                      <span className={styles.messageSender}>{m.role === "user" ? "You" : (job?.name || "Model")}</span>
                      <span className={styles.messageTime}>{m.ts}</span>
                    </div>
                    <div className={styles.messageText}>
                      {m.role === "model" ? renderMarkdown(m.content) : m.content}
                    </div>
                  </div>
                </div>
              ))}
              {loading && (
                <div className={`${styles.message} ${styles.messageModel}`}>
                  <div className={styles.messageAvatar}>AI</div>
                  <div className={styles.messageContent}>
                    <div className={styles.messageText}>
                      <span className="spinner" style={{ width: 14, height: 14, display: "inline-block", marginRight: 8 }} />
                      <span style={{ color: "var(--text-muted)", fontSize: "0.8125rem" }}>
                        {loadingStatus || "Generating..."}
                      </span>
                    </div>
                  </div>
                </div>
              )}
              <div ref={bottomRef} />
            </div>
          </div>

          {/* Elastic Wide Input Section */}
          <div className={styles.inputSection}>
            <div className={styles.inputWrapper}>
              <div className={styles.inputBar}>
                <textarea
                  ref={textareaRef}
                  id="playground-input"
                  className={styles.chatInput}
                  rows={1}
                  placeholder={isCompleted ? "Ask your fine-tuned model anything..." : "Model is training... chat unlocks upon completion"}
                  value={input}
                  disabled={!isCompleted || loading}
                  onChange={(e) => {
                    setInput(e.target.value);
                    // Elastic dynamic auto-resize
                    e.target.style.height = "auto";
                    e.target.style.height = `${Math.min(e.target.scrollHeight, 200)}px`;
                  }}
                  onKeyDown={handleKey}
                />
                <button
                  id="playground-send-btn"
                  className={styles.sendBtn}
                  disabled={!input.trim() || loading || !isCompleted}
                  onClick={sendMessage}
                  title="Send message (Enter)"
                >
                  {loading ? (
                    <span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} />
                  ) : (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="12" y1="19" x2="12" y2="5"></line>
                      <polyline points="5 12 12 5 19 12"></polyline>
                    </svg>
                  )}
                </button>
              </div>
              <div className={styles.inputFooter}>
                <span>Press <strong>Enter ↵</strong> to send</span>
                <span>•</span>
                <span><strong>Shift + Enter</strong> for new line</span>
                <span>•</span>
                <span>Fine-tuned LoRA weights</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {job && (
        <PublishModal
          isOpen={publishModalOpen}
          onClose={() => setPublishModalOpen(false)}
          type="job"
          id={job.id}
          initialTitle={(typeof job.config === "object" && job.config !== null && (job.config as Record<string, unknown>).public_title as string) || job.name}
          initialDescription={(typeof job.config === "object" && job.config !== null && (job.config as Record<string, unknown>).public_description as string) || ""}
          initialCategory={(typeof job.config === "object" && job.config !== null && (job.config as Record<string, unknown>).category as string) || "General"}
          initialPublished={Boolean(typeof job.config === "object" && job.config !== null && (job.config as Record<string, unknown>).published)}
          onPublishSuccess={(isPub, updatedData) => {
            if (updatedData) {
              setJob(updatedData as Job);
            }
          }}
        />
      )}
    </>
  );
}
