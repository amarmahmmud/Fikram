"use client";

import { useState, useRef, useEffect, use } from "react";
import Link from "next/link";
import styles from "./page.module.css";

interface Message { role: "user" | "model"; content: string; ts: string; }



export default function PlaygroundPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);
  const [messages, setMessages] = useState<Message[]>([
    { role: "model", content: "Hello! I'm your fine-tuned customer support assistant. How can I help you today?", ts: "now" },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState("");
  const [sysPrompt, setSysPrompt] = useState("You are a helpful customer support assistant.");
  const [showConfig, setShowConfig] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function sendMessage() {
    if (!input.trim() || loading) return;
    const userMsg: Message = { role: "user", content: input.trim(), ts: new Date().toLocaleTimeString() };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/playground", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId: resolvedParams.id,
          messages: newMessages,
        }),
      });
      const data = await res.json();
      if (data.ok && data.predictionId) {
        setLoadingStatus("Waking up GPU...");
        
        // Polling loop for Replicate predictions
        let isDone = false;
        while (!isDone) {
          await new Promise(resolve => setTimeout(resolve, 3000)); // Poll every 3s
          const statusRes = await fetch(`/api/playground/status?id=${data.predictionId}`);
          const statusData = await statusRes.json();

          if (statusData.status === "succeeded") {
            setMessages((prev) => [...prev, { role: "model", content: statusData.reply, ts: new Date().toLocaleTimeString() }]);
            isDone = true;
          } else if (statusData.status === "failed") {
            alert(statusData.error || "Model failed to generate response.");
            isDone = true;
          } else {
            setLoadingStatus(statusData.status === "starting" ? "Booting model (this takes ~3 mins if asleep)..." : "Generating...");
          }
        }
      } else {
        alert(data.error || "Failed to start generation");
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

  return (
    <>
      <div className="topbar">
        <Link href={`/jobs/${resolvedParams.id}`} className="btn btn-ghost btn-sm">← Job Detail</Link>
        <span className="topbar-title" style={{ flex: 1, textAlign: "center" }}>Playground — Customer Support Bot</span>
        <span className="badge badge-success">
          <span className="status-dot done" />
          Model Ready
        </span>
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
                <span style={{ fontSize: "1rem" }}>🤖</span>
                <div>
                  <div style={{ fontSize: "0.8125rem", fontWeight: 700 }}>Llama 3.1 8B</div>
                  <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>LoRA fine-tuned · Job #{resolvedParams.id.substring(0, 8)}</div>
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
                style={{ fontSize: "0.8125rem" }}
              />
            </div>

            <div className="input-group">
              <label className="input-label">Temperature</label>
              <input type="range" min="0" max="100" defaultValue="70" className={styles.slider} />
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.6875rem", color: "var(--text-muted)", marginTop: 2 }}>
                <span>Precise</span><span>Creative</span>
              </div>
            </div>

            <div className="input-group">
              <label className="input-label">Max Tokens</label>
              <input type="number" className="input" defaultValue={512} style={{ fontSize: "0.8125rem" }} />
            </div>

            <button className="btn btn-ghost btn-sm w-full" style={{ marginTop: 8 }} onClick={() => setMessages([{ role: "model", content: "Hello! I'm your fine-tuned assistant. How can I help?", ts: "now" }])}>
              ↺ Reset Conversation
            </button>
          </div>
        )}

        {/* Chat */}
        <div className={styles.chatArea}>
          {!showConfig && (
            <button className={styles.configToggle} onClick={() => setShowConfig(true)}>
              ⚙ Config
            </button>
          )}

          <div className={styles.messages}>
            {messages.map((m, i) => (
              <div key={i} className={`${styles.messageRow} ${m.role === "user" ? styles.userRow : styles.modelRow}`}>
                <div className={`chat-avatar ${m.role === "model" ? "ai" : "user"}`}>
                  {m.role === "model" ? "AI" : "U"}
                </div>
                <div className={styles.messageContent}>
                  <div className={`chat-bubble ${m.role === "model" ? "ai" : "user"}`} style={{ maxWidth: "none" }}>
                    {m.content}
                  </div>
                  <span className={styles.msgTs}>{m.ts}</span>
                </div>
              </div>
            ))}

            {loading && (
              <div className={`${styles.messageRow} ${styles.modelRow}`}>
                <div className="chat-avatar ai">AI</div>
                <div className="chat-bubble ai" style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <span className={styles.typingDots}>
                    <span />
                    <span />
                    <span />
                  </span>
                  {loadingStatus && <span style={{ fontSize: "0.75rem", opacity: 0.7 }}>{loadingStatus}</span>}
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          <div className={styles.inputRow}>
            <textarea
              id="playground-input"
              className={`input ${styles.chatInput}`}
              placeholder="Type a message... (Enter to send, Shift+Enter for new line)"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKey}
              rows={2}
            />
            <button
              id="playground-send-btn"
              className="btn btn-primary"
              onClick={sendMessage}
              disabled={loading || !input.trim()}
              style={{ flexShrink: 0 }}
            >
              {loading ? (
                <span className="animate-spin" style={{ width: 16, height: 16, border: "2px solid rgba(255,255,255,0.3)", borderTopColor: "white", borderRadius: "50%", display: "inline-block" }} />
              ) : "Send ↑"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
