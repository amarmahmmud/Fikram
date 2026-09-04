"use client";

import { useState, useRef, useEffect, use } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import styles from "./page.module.css";
import { PublishModal } from "@/components/PublishModal";
import { KnowledgeModal } from "@/components/KnowledgeModal";
import { apiClient } from "@/lib/apiClient";
import { Globe, BookOpen } from "lucide-react";

interface Message {
  role: "user" | "model";
  content: string;
  sources?: { filename: string; chunkIndex: number; similarity: number }[];
  webSources?: { title: string; snippet: string; link: string }[];
}

export default function ExpertChatPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);
  const supabase = createClient();

  const [expert, setExpert] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [publishModalOpen, setPublishModalOpen] = useState(false);
  const [sourcesModalOpen, setSourcesModalOpen] = useState(false);
  const [isOwner, setIsOwner] = useState(false);
  const [totalChunks, setTotalChunks] = useState(0);
  const [expertMetadata, setExpertMetadata] = useState<any>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  async function loadExpertDetails() {
    try {
      const res = await apiClient.get<any>(`/api/experts/${resolvedParams.id}`);
      if (res.ok && res.expert) {
        setExpert(res.expert);
        setIsOwner(Boolean(res.isOwner));
        setTotalChunks(res.totalChunks || 0);
        setExpertMetadata(res.metadata || null);
        return res.expert;
      }
    } catch {
      // fallback to direct supabase select
    }

    const { data } = await supabase
      .from("experts")
      .select("*")
      .eq("id", resolvedParams.id)
      .single();

    if (data) {
      setExpert(data);
    }
    return data;
  }

  // Load expert info
  useEffect(() => {
    async function init() {
      const exp = await loadExpertDetails();
      if (exp) {
        setMessages([{
          role: "model",
          content: `Hello! I'm **${exp.name}**${exp.description ? ` — ${exp.description}` : ""}. Ask me anything about my expertise.`,
        }]);

        // Trigger chat count increment
        apiClient.post("/api/community/chat-count", { targetId: resolvedParams.id, targetType: "expert" })
          .catch(console.error);
      }
      setLoading(false);
    }
    init();
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
      const data = await apiClient.post<any>(`/api/experts/${resolvedParams.id}/chat`, {
        message: userMsg,
        history: messages
          .filter((m) => m.role === "user" || m.role === "model")
          .slice(-10) // last 10 messages for context
          .map((m) => ({ role: m.role, content: m.content })),
      });

      if (data.ok) {
        setMessages((prev) => [
          ...prev,
          {
            role: "model",
            content: data.reply,
            sources: data.sources,
            webSources: data.webSources,
          },
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
            <div className={styles.expertTag}>
              {expertMetadata?.reasoningMode === "evaluative"
                ? "🔥 Critical Thinker"
                : expertMetadata?.reasoningMode === "strict"
                ? "🔒 Strict Grounding"
                : "⚖️ Smart Assistant"}
              {expertMetadata?.webSearchEnabled ? " · 🌐 Live Web" : " · RAG"}
            </div>
          </div>
        </div>
        <div className={styles.headerBadge} style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => setSourcesModalOpen(true)}
            style={{ gap: 6 }}
            title="View indexed knowledge sources or upload new documents"
          >
            <BookOpen size={16} />
            Knowledge Base {totalChunks > 0 ? `(${totalChunks})` : ""}
          </button>
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => setPublishModalOpen(true)}
            style={{ gap: 6 }}
          >
            <Globe size={16} />
            {expert.is_published ? "Published (Share)" : "Publish & Share"}
          </button>
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
            {msg.webSources && msg.webSources.length > 0 && (
              <div className={styles.sources} style={{ marginTop: 6 }}>
                <span className={styles.sourcesLabel} style={{ color: "var(--accent-primary)" }}>🌐 Live Web:</span>
                {msg.webSources.map((ws, wsi) => (
                  <a
                    key={wsi}
                    href={ws.link}
                    target="_blank"
                    rel="noreferrer"
                    className={styles.sourceChip}
                    style={{ textDecoration: "none", cursor: "pointer", color: "inherit" }}
                    title={ws.snippet}
                  >
                    🔗 {ws.title.slice(0, 32)}...
                  </a>
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

      {expert && (
        <>
          <PublishModal
            isOpen={publishModalOpen}
            onClose={() => setPublishModalOpen(false)}
            type="expert"
            id={expert.id}
            initialTitle={expert.name}
            initialDescription={expert.description || ""}
            initialPublished={Boolean(expert.is_published)}
            onPublishSuccess={(isPub, updatedData) => {
              if (updatedData) {
                setExpert(updatedData);
              }
            }}
          />
          <KnowledgeModal
            isOpen={sourcesModalOpen}
            onClose={() => setSourcesModalOpen(false)}
            expertId={expert.id}
            isOwner={isOwner}
            onSourcesUpdated={loadExpertDetails}
          />
        </>
      )}
    </div>
  );
}
