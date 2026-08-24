"use client";

import { useState, useRef, useEffect, use } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import styles from "./page.module.css";

interface Message {
  role: "user" | "model";
  content: string;
  sources?: { filename: string; chunkIndex: number; similarity: number }[];
}

export default function ExpertChatPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);
  const supabase = createClient();

  const [expert, setExpert] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Load expert info
  useEffect(() => {
    async function loadExpert() {
      const { data } = await supabase
        .from("experts")
        .select("*")
        .eq("id", resolvedParams.id)
        .single();

      if (data) {
        setExpert(data);
        setMessages([{
          role: "model",
          content: `Hello! I'm **${data.name}**${data.description ? ` — ${data.description}` : ""}. Ask me anything about my expertise.`,
        }]);
      }
      setLoading(false);
    }
    loadExpert();
  }, [resolvedParams.id]);

  // Auto-scroll
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function handleSend() {
    if (!input.trim() || sending) return;

    const userMsg = input.trim();
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: userMsg }]);
    setSending(true);

    try {
      const res = await fetch(`/api/experts/${resolvedParams.id}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: userMsg,
          history: messages
            .filter((m) => m.role === "user" || m.role === "model")
            .slice(-10) // last 10 messages for context
            .map((m) => ({ role: m.role, content: m.content })),
        }),
      });

      const data = await res.json();

      if (data.ok) {
        setMessages((prev) => [
          ...prev,
          { role: "model", content: data.reply, sources: data.sources },
        ]);
      } else {
        setMessages((prev) => [
          ...prev,
          { role: "model", content: `Error: ${data.error || "Something went wrong"}` },
        ]);
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "model", content: "Network error — please try again." },
      ]);
    }

    setSending(false);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  /** Lightweight bold renderer */
  function renderText(text: string) {
    const parts: React.ReactNode[] = [];
    const regex = /\*\*(.+?)\*\*/g;
    let lastIndex = 0;
    let match;
    while ((match = regex.exec(text)) !== null) {
      if (match.index > lastIndex) parts.push(text.substring(lastIndex, match.index));
      parts.push(<strong key={match.index}>{match[1]}</strong>);
      lastIndex = regex.lastIndex;
    }
    if (lastIndex < text.length) parts.push(text.substring(lastIndex));
    return parts.length > 0 ? parts : [text];
  }

  if (loading) {
    return (
      <div className={styles.loading}>
        <div className={styles.spinner} />
        Loading expert...
      </div>
    );
  }

  if (!expert) {
    return (
      <div className={styles.loading}>
        <p>Expert not found.</p>
        <Link href="/dashboard" className="btn btn-primary btn-sm" style={{ marginTop: 16 }}>
          ← Dashboard
        </Link>
      </div>
    );
  }

  return (
    <div className={styles.chatLayout}>
      {/* Header */}
      <div className={styles.header}>
        <Link href="/dashboard" className={styles.backBtn}>←</Link>
        <div className={styles.headerInfo}>
          <div className={styles.expertAvatar}>
            {expert.name.charAt(0).toUpperCase()}
          </div>
          <div>
            <div className={styles.expertName}>{expert.name}</div>
            <div className={styles.expertTag}>Smart Assistant · RAG</div>
          </div>
        </div>
        <div className={styles.headerBadge}>
          <span className="badge badge-success">
            <span className="status-dot completed" />
            Online
          </span>
        </div>
      </div>

      {/* Messages */}
      <div className={styles.messagesArea}>
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`${styles.messageBubble} ${msg.role === "user" ? styles.userBubble : styles.modelBubble}`}
          >
            <div className={styles.messageContent}>
              {msg.content.split("\n").map((line, li) => (
                <div key={li}>{renderText(line)}</div>
              ))}
            </div>
            {msg.sources && msg.sources.length > 0 && (
              <div className={styles.sources}>
                <span className={styles.sourcesLabel}>Sources:</span>
                {msg.sources.map((s, si) => (
                  <span key={si} className={styles.sourceChip}>
                    {s.filename} (chunk {s.chunkIndex + 1}, {(s.similarity * 100).toFixed(0)}% match)
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}

        {sending && (
          <div className={`${styles.messageBubble} ${styles.modelBubble}`}>
            <div className={styles.typingDots}>
              <span /><span /><span />
            </div>
          </div>
        )}

        <div ref={chatEndRef} />
      </div>

      {/* Input */}
      <div className={styles.inputArea}>
        <textarea
          className={styles.chatInput}
          placeholder={`Ask ${expert.name} a question...`}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={1}
          disabled={sending}
        />
        <button
          className={styles.sendBtn}
          onClick={handleSend}
          disabled={!input.trim() || sending}
        >
          ↑
        </button>
      </div>
    </div>
  );
}
