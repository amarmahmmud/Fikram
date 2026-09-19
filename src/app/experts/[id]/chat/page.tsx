"use client";

import { useState, useRef, useEffect, use, useCallback } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import styles from "./page.module.css";
import { PublishModal } from "@/components/PublishModal";
import { KnowledgeModal } from "@/components/KnowledgeModal";
import { EditAssistantModal } from "@/components/chat/EditAssistantModal";
import { MarkdownContent } from "@/components/chat/MarkdownContent";
import { apiClient } from "@/lib/apiClient";
import {
  Globe,
  BookOpen,
  PanelLeft,
  Plus,
  Trash2,
  ChevronDown,
  ExternalLink,
  MessageSquare,
  Clock,
  Paperclip,
  X,
  Image as ImageIcon,
  FileAudio,
  Film,
  Mic,
  Square,
  Settings2,
  ArrowLeft,
  ArrowUp,
  FileText,
  ShieldCheck,
  Flame,
  Scale,
  BotOff,
  Check,
  Share2,
  Copy,
  Volume2,
  VolumeX,
  Pause,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { useTextToSpeech } from "@/hooks/useTextToSpeech";

interface Message {
  id?: string;
  role: "user" | "model";
  content: string;
  sources?: { filename: string; chunkIndex: number; similarity: number }[];
  webSources?: { title: string; snippet: string; link: string }[];
  attachment?: { mimeType: string; previewUrl?: string; filename?: string };
}

interface ConversationItem {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

function fallbackCopyText(text: string, onSuccess: () => void) {
  try {
    const textArea = document.createElement("textarea");
    textArea.value = text;
    textArea.style.position = "fixed";
    textArea.style.left = "-999999px";
    textArea.style.top = "-999999px";
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    const successful = document.execCommand("copy");
    document.body.removeChild(textArea);
    if (successful) {
      onSuccess();
    } else {
      toast.error("Failed to copy message");
    }
  } catch {
    toast.error("Failed to copy message");
  }
}

export default function ExpertChatPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);
  const expertId = resolvedParams.id;
  const supabase = createClient();

  const [expert, setExpert] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [publishModalOpen, setPublishModalOpen] = useState(false);
  const [sourcesModalOpen, setSourcesModalOpen] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [isOwner, setIsOwner] = useState(false);
  const [totalChunks, setTotalChunks] = useState(0);
  const [expertMetadata, setExpertMetadata] = useState<any>(null);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [copiedShare, setCopiedShare] = useState(false);
  const [copiedMessageIndex, setCopiedMessageIndex] = useState<number | null>(null);
  const copyTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Text-to-Speech playback hook
  const {
    playingIndex,
    loadingIndex,
    playbackRate,
    disabledMap,
    togglePlayMessage,
    stopCurrentPlayback,
    cyclePlaybackRate,
  } = useTextToSpeech();

  // Auto-voice response state (Option A: first reply in each conversation auto-plays; persisted in localStorage)
  const [autoVoiceEnabled, setAutoVoiceEnabled] = useState<boolean>(true);

  // Initialize autoVoiceEnabled from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem("mf_auto_voice_enabled");
      if (stored !== null) {
        setAutoVoiceEnabled(stored === "true");
      }
    } catch {}
  }, []);

  // Toggle auto-voice on/off with persistence & user feedback
  const handleToggleAutoVoice = useCallback(() => {
    setAutoVoiceEnabled((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("mf_auto_voice_enabled", String(next));
      } catch {}

      if (!next) {
        stopCurrentPlayback();
        toast.info("Voice Auto-Play turned OFF", {
          description: "Assistant will not speak automatically. Click Listen to play anytime.",
          duration: 3500,
        });
      } else {
        toast.success("Voice Auto-Play turned ON", {
          description: "Assistant will speak the first reply in each conversation.",
          duration: 3500,
        });
      }
      return next;
    });
  }, [stopCurrentPlayback]);

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
    };
  }, []);

  const handleCopyMessage = useCallback((text: string, index: number) => {
    if (!text) return;

    const onCopySuccess = () => {
      setCopiedMessageIndex(index);
      toast.success("Message copied to clipboard", { duration: 1800 });
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
      copyTimeoutRef.current = setTimeout(() => {
        setCopiedMessageIndex(null);
      }, 2000);
    };

    if (typeof navigator !== "undefined" && navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(onCopySuccess).catch(() => {
        fallbackCopyText(text, onCopySuccess);
      });
    } else {
      fallbackCopyText(text, onCopySuccess);
    }
  }, []);

  // Session-based custom rules & prompt state (persisted per-user in localStorage)
  const [sessionPrompt, setSessionPrompt] = useState<string | null>(null);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(`mf_expert_prompt_${expertId}`);
      if (stored) {
        setSessionPrompt(stored);
      }
    } catch { }
  }, [expertId]);

  const effectivePrompt = sessionPrompt !== null ? sessionPrompt : (expert?.system_prompt || "");
  const isCustomized = sessionPrompt !== null && sessionPrompt.trim() !== (expert?.system_prompt || "").trim();

  // Sidebar and Conversation state (collapsed by default on mobile)
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);

  // Auto-expand sidebar on desktop devices
  useEffect(() => {
    if (typeof window !== "undefined" && window.innerWidth > 768) {
      setSidebarOpen(true);
    }
  }, []);

  const chatEndRef = useRef<HTMLDivElement>(null);

  // Attachments & Mic
  const [pendingAttachment, setPendingAttachment] = useState<{ file: File; previewUrl?: string; mimeType: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  /** Helper to sanitize expert description and avoid leaking config bracket tags */
  const sanitizeDescription = useCallback((desc: string = "") => {
    return desc
      .replace(/\[(Category|Tags|Mode|WebSearch):[^\]]+\]/gi, "")
      .trim();
  }, []);

  /** Initial welcome message for this expert */
  const getInitialWelcomeMessage = useCallback((exp: any): Message => {
    const cleanDesc = sanitizeDescription(exp?.description);
    return {
      role: "model",
      content: `Hello! I'm **${exp?.name}**${cleanDesc ? ` — ${cleanDesc}` : ""}.\n\nAsk me anything about my knowledge base or submit a concept for evaluation.`,
    };
  }, [sanitizeDescription]);

  /** Load expert details */
  const loadExpertDetails = useCallback(async () => {
    try {
      const res = await apiClient.get<any>(`/api/experts/${expertId}`);
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
      .eq("id", expertId)
      .single();

    if (data) {
      setExpert(data);
    }
    return data;
  }, [expertId]);

  /** Fetch past conversations list */
  const loadConversations = useCallback(async () => {
    try {
      const res = await apiClient.get<any>(`/api/experts/${expertId}/conversations`);
      if (res.ok && Array.isArray(res.conversations)) {
        setConversations(res.conversations);
        return res.conversations;
      }
    } catch {
      // Check local storage for anonymous fallback
      try {
        const local = localStorage.getItem(`mf_expert_convs_${expertId}`);
        if (local) {
          const parsed = JSON.parse(local);
          setConversations(parsed);
          return parsed;
        }
      } catch (e) {
        console.warn("[Local Storage] Failed to load local conversations", e);
      }
    }
    return [];
  }, [expertId]);

  /** Select and load a conversation */
  const selectConversation = useCallback(async (convId: string, currentExpert?: any) => {
    setActiveConvId(convId);
    if (typeof window !== "undefined" && window.innerWidth <= 768) {
      setSidebarOpen(false);
    }
    const exp = currentExpert || expert;
    try {
      const res = await apiClient.get<any>(`/api/experts/${expertId}/conversations/${convId}`);
      if (res.ok && Array.isArray(res.messages)) {
        if (res.messages.length === 0 && exp) {
          setMessages([getInitialWelcomeMessage(exp)]);
        } else {
          setMessages(
            res.messages.map((m: any) => ({
              id: m.id,
              role: m.role,
              content: m.content,
              sources: m.sources,
              webSources: m.webSources,
            }))
          );
        }
        return;
      }
    } catch (err) {
      console.warn("[Conversation] Failed to load remote conversation", err);
    }

    // Fallback: check local storage
    try {
      const localMsgs = localStorage.getItem(`mf_expert_msgs_${convId}`);
      if (localMsgs) {
        setMessages(JSON.parse(localMsgs));
        return;
      }
    } catch { }

    if (exp) {
      setMessages([getInitialWelcomeMessage(exp)]);
    }
  }, [expertId, expert, getInitialWelcomeMessage]);

  // Check auth user and load data
  useEffect(() => {
    let mounted = true;
    async function init() {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (mounted) setCurrentUser(user);

        const exp = await loadExpertDetails();
        if (exp && mounted) {
          const convs = await loadConversations();
          if (convs.length > 0) {
            // Load most recent conversation
            await selectConversation(convs[0].id, exp);
          } else {
            setMessages([getInitialWelcomeMessage(exp)]);
          }

          // Trigger chat count increment
          apiClient.post("/api/community/chat-count", { targetId: expertId, targetType: "expert" })
            .catch(console.error);
        }
      } finally {
        if (mounted) setLoading(false);
      }
    }
    init();

    return () => {
      mounted = false;
    };
  }, [expertId]);

  // Auto-scroll on new messages
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sending]);

  /** Start a new chat */
  function handleNewChat() {
    setActiveConvId(null);
    if (typeof window !== "undefined" && window.innerWidth <= 768) {
      setSidebarOpen(false);
    }
    if (expert) {
      setMessages([getInitialWelcomeMessage(expert)]);
    }
  }

  /** Delete a conversation */
  async function handleDeleteConversation(convId: string, e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm("Are you sure you want to delete this chat history?")) return;

    try {
      await apiClient.delete(`/api/experts/${expertId}/conversations/${convId}`);
    } catch { }

    // Update local state and storage
    setConversations((prev) => prev.filter((c) => c.id !== convId));
    try {
      localStorage.removeItem(`mf_expert_msgs_${convId}`);
      const localConvs = localStorage.getItem(`mf_expert_convs_${expertId}`);
      if (localConvs) {
        const parsed = JSON.parse(localConvs).filter((c: any) => c.id !== convId);
        localStorage.setItem(`mf_expert_convs_${expertId}`, JSON.stringify(parsed));
      }
    } catch { }

    if (activeConvId === convId) {
      handleNewChat();
    }
  }


  /** Send message */
  async function handleSend() {
    if (!input.trim() || sending) return;

    const userMsg = input.trim();
    setInput("");

    // Build user message with optional attachment preview
    const userMessage: Message = { role: "user", content: userMsg };
    if (pendingAttachment) {
      userMessage.attachment = {
        mimeType: pendingAttachment.mimeType,
        previewUrl: pendingAttachment.previewUrl,
        filename: pendingAttachment.file.name,
      };
    }
    setMessages((prev) => [...prev, userMessage]);
    setSending(true);

    try {
      let data: any;

      if (pendingAttachment) {
        // Direct-to-R2 architecture for media
        const uploadRes = await fetch("/api/upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            filename: pendingAttachment.file.name,
            contentType: pendingAttachment.file.type,
          }),
        });

        if (!uploadRes.ok) {
          const err = await uploadRes.json().catch(() => ({}));
          throw new Error(err.error || "Failed to initiate upload");
        }

        const { uploadUrl, downloadUrl } = await uploadRes.json();

        // Upload directly to Cloudflare R2
        const putRes = await fetch(uploadUrl, {
          method: "PUT",
          body: pendingAttachment.file,
          headers: { "Content-Type": pendingAttachment.file.type },
        });

        if (!putRes.ok) throw new Error("Failed to upload file to storage");

        // Send chat request with the R2 URL
        data = await apiClient.post<any>(`/api/experts/${expertId}/chat`, {
          message: userMsg,
          conversationId: activeConvId,
          history: messages
            .filter((m) => m.role === "user" || m.role === "model")
            .slice(-10)
            .map((m) => ({ role: m.role, content: m.content })),
          attachment: {
            url: downloadUrl,
            mimeType: pendingAttachment.mimeType,
            filename: pendingAttachment.file.name
          },
          systemPrompt: effectivePrompt || undefined,
        });
        setPendingAttachment(null);
      } else {
        // JSON path — standard text-only chat
        data = await apiClient.post<any>(`/api/experts/${expertId}/chat`, {
          message: userMsg,
          conversationId: activeConvId,
          history: messages
            .filter((m) => m.role === "user" || m.role === "model")
            .slice(-10)
            .map((m) => ({ role: m.role, content: m.content })),
          systemPrompt: effectivePrompt || undefined,
        });
      }

      if (data.ok) {
        const newModelMsg: Message = {
          role: "model",
          content: data.reply,
          sources: data.sources,
          webSources: data.webSources,
        };

        const prevModelCount = messages.filter((m) => m.role === "model").length;
        const newModelIndex = messages.length + 1;

        setMessages((prev) => [...prev, newModelMsg]);

        // Option A: Auto-play voice on the first assistant response in this conversation
        if (prevModelCount === 0 && autoVoiceEnabled && data.reply) {
          togglePlayMessage(data.reply, newModelIndex);

          // Discovery toast with 1-click turn-off action
          toast("🔊 Voice Response Active", {
            description: "First responses speak automatically. You can toggle this off anytime.",
            action: {
              label: "Turn Off",
              onClick: () => {
                setAutoVoiceEnabled(false);
                try {
                  localStorage.setItem("mf_auto_voice_enabled", "false");
                } catch {}
                stopCurrentPlayback();
                toast.info("Voice Auto-Play disabled.");
              },
            },
            duration: 7000,
          });
        }

        // Sync conversation ID
        if (data.conversationId) {
          if (!activeConvId) {
            setActiveConvId(data.conversationId);
          }
          await loadConversations();
        } else if (!currentUser) {
          // Save locally for anonymous user
          const anonConvId = activeConvId || `local_${Date.now()}`;
          if (!activeConvId) {
            setActiveConvId(anonConvId);
            const newLocalConv = {
              id: anonConvId,
              title: userMsg.slice(0, 32),
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            };
            const updated = [newLocalConv, ...conversations];
            setConversations(updated);
            localStorage.setItem(`mf_expert_convs_${expertId}`, JSON.stringify(updated));
          }
          const allMsgs = [...messages, { role: "user", content: userMsg }, newModelMsg];
          localStorage.setItem(`mf_expert_msgs_${anonConvId}`, JSON.stringify(allMsgs));
        }
      } else {
        setMessages((prev) => [
          ...prev,
          { role: "model", content: `**Error**: ${data.error || "Something went wrong"}` },
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

  /** Handle file selection from the attachment button */
  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    const validTypes = [
      "image/png", "image/jpeg", "image/webp", "image/gif", "image/heic",
      "audio/mpeg", "audio/mp3", "audio/wav", "audio/ogg", "audio/webm", "audio/mp4", "audio/x-m4a",
      "video/mp4", "video/webm",
    ];
    if (!validTypes.includes(file.type)) {
      toast.error("Unsupported file type. Please upload an image, audio, or video file.");
      return;
    }

    // Validate size (20MB for images, 25MB for audio, 50MB for video)
    const maxSize = file.type.startsWith("video/") ? 50 * 1024 * 1024
      : file.type.startsWith("audio/") ? 25 * 1024 * 1024
        : 20 * 1024 * 1024;
    if (file.size > maxSize) {
      toast.error(`File too large. Maximum size is ${Math.round(maxSize / 1024 / 1024)}MB.`);
      return;
    }

    // Create preview URL for images
    const previewUrl = file.type.startsWith("image/") ? URL.createObjectURL(file) : "";
    setPendingAttachment({ file, previewUrl, mimeType: file.type });

    // Reset file input so the same file can be re-selected
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function clearPendingAttachment() {
    if (pendingAttachment?.previewUrl) {
      URL.revokeObjectURL(pendingAttachment.previewUrl);
    }
    setPendingAttachment(null);
  }

  /** Format relative date string */
  function formatRelativeDate(dateStr: string) {
    try {
      const date = new Date(dateStr);
      const now = new Date();
      const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
      if (diffDays === 0) return "Today";
      if (diffDays === 1) return "Yesterday";
      if (diffDays < 7) return `${diffDays}d ago`;
      return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    } catch {
      return "";
    }
  }

  // ── Microphone Recording Logic ──────────────────────────────────────────

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          audioChunksRef.current.push(e.data);
        }
      };

      mediaRecorder.onstop = () => {
        if (isRecording) { // If not cancelled
          const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" });
          const audioFile = new File([audioBlob], "voice-message.webm", { type: "audio/webm" });
          setPendingAttachment({ file: audioFile, mimeType: "audio/webm" });
        }

        stream.getTracks().forEach(track => track.stop());
        setIsRecording(false);
        setRecordingDuration(0);
        if (timerRef.current) clearInterval(timerRef.current);
      };

      mediaRecorder.start();
      setIsRecording(true);
      setRecordingDuration(0);
      timerRef.current = setInterval(() => {
        setRecordingDuration(prev => prev + 1);
      }, 1000);
    } catch (err) {
      console.error("Error accessing microphone:", err);
      toast.error("Could not access the microphone. Please check your browser permissions.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
    }
  };

  const cancelRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      // Temporarily set a flag so onstop knows we cancelled
      setIsRecording(false);
      mediaRecorderRef.current.stop();
    }
  };

  const formatDuration = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  if (loading) {
    return (
      <div className={styles.loading}>
        <div className={styles.spinner} />
        Loading expert & chat workspace...
      </div>
    );
  }

  if (!expert) {
    return (
      <div className={styles.loading}>
        <div className={styles.notFoundIconWrap}>
          <BotOff size={32} />
        </div>
        <h3 style={{ marginBottom: 8, color: "var(--text-primary)", fontSize: "1.25rem", fontWeight: 600 }}>
          RAG AI Expert Not Found
        </h3>
        <p style={{ color: "var(--text-secondary)", maxWidth: 420, textAlign: "center", fontSize: "0.875rem", lineHeight: 1.5 }}>
          This RAG AI Expert may be private, under review, or the link may have expired.
        </p>
        <div style={{ display: "flex", gap: 12, marginTop: 20 }}>
          <Link href="/browse" className="btn btn-primary btn-sm">
            Browse RAG AI Experts
          </Link>
          <Link href="/" className="btn btn-secondary btn-sm">
            Home
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.chatContainer}>
      {/* ──────────────── Mobile Sidebar Backdrop Overlay ──────────────── */}
      <div
        className={`${styles.sidebarBackdrop} ${sidebarOpen ? styles.backdropActive : ""}`}
        onClick={() => setSidebarOpen(false)}
        aria-hidden="true"
      />

      {/* ──────────────── Left Sidebar: Chat History ──────────────── */}
      <aside className={`${styles.sidebar} ${!sidebarOpen ? styles.sidebarCollapsed : ""}`}>
        <div className={styles.sidebarHeader}>
          <button className={styles.newChatBtn} onClick={handleNewChat}>
            <Plus size={16} />
            <span>New Chat</span>
          </button>
          <button
            className={styles.closeSidebarBtn}
            onClick={() => setSidebarOpen(false)}
            title="Collapse sidebar"
          >
            <PanelLeft size={18} />
          </button>
        </div>

        <div className={styles.conversationsList}>
          <div className={styles.historySectionLabel}>Recent Conversations</div>
          {conversations.length === 0 ? (
            <div style={{ padding: "16px 12px", color: "var(--text-muted)", fontSize: "0.78rem" }}>
              No past conversations yet. Ask a question to start one!
            </div>
          ) : (
            conversations.map((conv) => {
              const isActive = activeConvId === conv.id;
              return (
                <div
                  key={conv.id}
                  className={`${styles.conversationItem} ${isActive ? styles.conversationItemActive : ""}`}
                  onClick={() => selectConversation(conv.id)}
                >
                  <div className={styles.conversationInfo}>
                    <div className={styles.conversationTitle}>{conv.title || "Untitled Conversation"}</div>
                    <div className={styles.conversationDate}>
                      {formatRelativeDate(conv.updated_at || conv.created_at)}
                    </div>
                  </div>
                  <button
                    className={styles.deleteConvBtn}
                    onClick={(e) => handleDeleteConversation(conv.id, e)}
                    title="Delete conversation"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              );
            })
          )}
        </div>

        <div className={styles.sidebarFooter}>
          <span>Fikram</span>
          <span style={{ color: "var(--accent-primary)" }}>● Beta</span>
        </div>
      </aside>

      {/* ──────────────── Main Chat View ──────────────── */}
      <div className={styles.chatMain}>
        {/* Header */}
        <header className={styles.header}>
          <div className={styles.headerLeft}>
            {!sidebarOpen && (
              <button
                className={styles.sidebarToggleBtn}
                onClick={() => setSidebarOpen(true)}
                title="Open chat history sidebar"
                aria-label="Open chat history"
              >
                <PanelLeft size={18} />
              </button>
            )}

            <Link
              href={currentUser ? "/dashboard" : "/browse"}
              className={styles.backBtn}
              title={currentUser ? "Back to Dashboard" : "Back to Browse"}
              aria-label="Back"
            >
              <ArrowLeft size={16} />
            </Link>

            <div className={styles.expertAvatar}>
              {expert.name.charAt(0).toUpperCase()}
            </div>

            <div className={styles.headerTitles}>
              <div className={styles.expertName} title={expert.name}>{expert.name}</div>
              <div className={styles.expertTag}>
                {expertMetadata?.reasoningMode === "evaluative" ? (
                  <span className={styles.modeBadgeEvaluative}>
                    <Flame size={12} /> Critical Evaluator
                  </span>
                ) : expertMetadata?.reasoningMode === "strict" ? (
                  <span className={styles.modeBadgeStrict}>
                    <ShieldCheck size={12} /> Strict Grounding
                  </span>
                ) : (
                  <span className={styles.modeBadgeSmart}>
                    <Scale size={12} /> RAG AI Expert
                  </span>
                )}
                {expertMetadata?.webSearchEnabled && (
                  <span className={styles.webSearchBadge}>
                    <Globe size={11} /> Live Web
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className={styles.headerActions}>
            {/* Auto-Voice Response Toggle (Option A) */}
            <button
              className={`btn btn-secondary btn-sm ${styles.actionBtn} ${
                autoVoiceEnabled ? styles.actionBtnVoiceActive : styles.actionBtnVoiceMuted
              }`}
              onClick={handleToggleAutoVoice}
              title={
                autoVoiceEnabled
                  ? "Voice Auto-Play is ON (First reply speaks aloud). Click to turn OFF."
                  : "Voice Auto-Play is OFF (Text only). Click to turn ON."
              }
              aria-label={
                autoVoiceEnabled
                  ? "Voice Auto-Play is enabled. Click to disable."
                  : "Voice Auto-Play is disabled. Click to enable."
              }
            >
              {autoVoiceEnabled ? <Volume2 size={16} /> : <VolumeX size={16} />}
              <span className={styles.btnLabel}>
                {autoVoiceEnabled ? "Voice: ON" : "Voice: OFF"}
              </span>
              {autoVoiceEnabled && <span className={styles.voiceDot} />}
            </button>
            <button
              className={`btn btn-secondary btn-sm ${styles.actionBtn} ${isCustomized ? styles.actionBtnCustomized : ""}`}
              onClick={() => setEditModalOpen(true)}
              title={
                isCustomized
                  ? "Personal session rules active (click to edit or reset)"
                  : isOwner
                    ? "Edit RAG AI Expert rules (Session or Creator Default)"
                    : "Customize RAG AI Expert rules for your chat session"
              }
            >
              <Settings2 size={16} />
              <span className={styles.btnLabel}>{isCustomized ? "Rules (Custom)" : "Edit Rules"}</span>
              {isCustomized && <span className={styles.customDot} />}
            </button>
            <button
              className={`btn btn-secondary btn-sm ${styles.actionBtn}`}
              onClick={() => setSourcesModalOpen(true)}
              title={`View indexed knowledge sources (${totalChunks} chunks)`}
            >
              <BookOpen size={16} />
              <span className={styles.btnLabel}>Knowledge Base {totalChunks > 0 ? `(${totalChunks})` : ""}</span>
            </button>
            {isOwner ? (
              <button
                className={`btn btn-secondary btn-sm ${styles.actionBtn}`}
                onClick={() => setPublishModalOpen(true)}
                title="Publish & Share settings"
              >
                <Globe size={16} />
                <span className={styles.btnLabel}>{expert.is_published ? "Published" : "Publish & Share"}</span>
              </button>
            ) : (
              <button
                className={`btn btn-secondary btn-sm ${styles.actionBtn}`}
                onClick={async () => {
                  if (typeof window !== "undefined" && navigator.clipboard) {
                    await navigator.clipboard.writeText(window.location.href);
                    setCopiedShare(true);
                    setTimeout(() => setCopiedShare(false), 2500);
                  }
                }}
                title="Copy share link"
              >
                {copiedShare ? <Check size={15} color="var(--accent-primary)" /> : <Share2 size={15} />}
                <span className={styles.btnLabel}>{copiedShare ? "Copied Link!" : "Share"}</span>
              </button>
            )}
          </div>
        </header>

        {/* Messages */}
        <div className={styles.messagesArea}>
          {messages.map((msg, i) => (
            <div
              key={i}
              className={`${styles.messageBubble} ${
                msg.role === "user" ? styles.userBubble : styles.modelBubble
              } ${playingIndex === i ? styles.modelBubblePlaying : ""}`}
            >
              <div className={styles.messageContent}>
                {/* Inline attachment display */}
                {msg.attachment && (
                  <div className={styles.messageAttachment}>
                    {msg.attachment.mimeType.startsWith("image/") && msg.attachment.previewUrl && (
                      <img
                        src={msg.attachment.previewUrl}
                        alt={msg.attachment.filename || "Attached image"}
                        className={styles.attachmentImage}
                      />
                    )}
                    {msg.attachment.mimeType.startsWith("audio/") && (
                      <div className={styles.attachmentAudio}>
                        <FileAudio size={16} />
                        <span>{msg.attachment.filename || "Audio file"}</span>
                      </div>
                    )}
                    {msg.attachment.mimeType.startsWith("video/") && (
                      <div className={styles.attachmentVideo}>
                        <Film size={16} />
                        <span>{msg.attachment.filename || "Video file"}</span>
                      </div>
                    )}
                  </div>
                )}
                <MarkdownContent content={msg.content} />
              </div>

              {/* Message Action Footer (Copy button for sent chat and AI responses) */}
              {msg.content && msg.content.trim().length > 0 && (
                <div
                  className={`${styles.messageFooter} ${msg.role === "user" ? styles.userFooter : styles.modelFooter
                    }`}
                >
                  <button
                    type="button"
                    className={`${styles.copyMessageBtn} ${copiedMessageIndex === i ? styles.copied : ""
                      }`}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleCopyMessage(msg.content, i);
                    }}
                    title={copiedMessageIndex === i ? "Copied!" : "Copy message"}
                    aria-label={copiedMessageIndex === i ? "Message copied" : "Copy message text"}
                  >
                    {copiedMessageIndex === i ? (
                      <>
                        <Check size={12} className={styles.copySuccessIcon} />
                        <span>Copied!</span>
                      </>
                    ) : (
                      <>
                        <Copy size={12} />
                        <span>Copy</span>
                      </>
                    )}
                  </button>

                  {/* Text-to-Speech Listen button & speed control for AI responses */}
                  {msg.role !== "user" && (
                    <div className={styles.ttsControls}>
                      {disabledMap[i] ? (
                        <button
                          type="button"
                          disabled
                          className={`${styles.ttsBtn} ${styles.ttsDisabled}`}
                          title={disabledMap[i].reason || "Audio not available for this language yet"}
                          aria-label="Audio not available for this language yet"
                        >
                          <VolumeX size={12} />
                          <span>Unavailable</span>
                        </button>
                      ) : (
                        <>
                          <button
                            type="button"
                            className={`${styles.ttsBtn} ${playingIndex === i ? styles.ttsPlaying : ""
                              } ${loadingIndex === i ? styles.ttsLoading : ""}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              togglePlayMessage(msg.content, i);
                            }}
                            title={
                              playingIndex === i
                                ? "Pause speech"
                                : loadingIndex === i
                                  ? "Synthesizing audio..."
                                  : "Listen to response"
                            }
                            aria-label={
                              playingIndex === i
                                ? "Pause speech"
                                : loadingIndex === i
                                  ? "Synthesizing speech audio"
                                  : "Listen to response"
                            }
                          >
                            {loadingIndex === i ? (
                              <>
                                <Loader2 size={12} className={styles.spinIcon} />
                                <span>Synthesizing...</span>
                              </>
                            ) : playingIndex === i ? (
                              <>
                                <Pause size={12} className={styles.pauseIcon} />
                                <div className={styles.waveformContainer} aria-hidden="true">
                                  <span className={`${styles.waveBar} ${styles.bar1}`} />
                                  <span className={`${styles.waveBar} ${styles.bar2}`} />
                                  <span className={`${styles.waveBar} ${styles.bar3}`} />
                                  <span className={`${styles.waveBar} ${styles.bar4}`} />
                                  <span className={`${styles.waveBar} ${styles.bar5}`} />
                                  <span className={`${styles.waveBar} ${styles.bar6}`} />
                                </div>
                                <span>Playing</span>
                              </>
                            ) : (
                              <>
                                <Volume2 size={12} />
                                <span>Listen</span>
                              </>
                            )}
                          </button>

                          {/* Speed toggle pill: cycles 1x -> 1.5x -> 2x */}
                          <button
                            type="button"
                            className={`${styles.ttsSpeedBtn} ${playingIndex === i ? styles.speedActive : ""
                              }`}
                            onClick={(e) => {
                              e.stopPropagation();
                              cyclePlaybackRate();
                            }}
                            title={`Playback speed: ${playbackRate}x (click to change: 1x / 1.5x / 2x)`}
                            aria-label={`Current playback speed ${playbackRate}x. Click to change.`}
                          >
                            {playbackRate}x
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Collapsible Verified Citations & Live Web Sources */}
              {((msg.sources && msg.sources.length > 0) ||
                (msg.webSources && msg.webSources.length > 0)) && (
                  <details className={styles.sourcesAccordion}>
                    <summary className={styles.sourcesSummary}>
                      <div className={styles.summaryBadges}>
                        {msg.sources && msg.sources.length > 0 && (
                          <span className={styles.sourceCountBadge}>
                            <BookOpen size={12} />
                            <span>{msg.sources.length} Knowledge Chunks</span>
                          </span>
                        )}
                        {msg.webSources && msg.webSources.length > 0 && (
                          <span className={styles.webCountBadge}>
                            <Globe size={12} />
                            <span>{msg.webSources.length} Web References</span>
                          </span>
                        )}
                      </div>
                      <ChevronDown size={14} className={styles.chevronIcon} />
                    </summary>

                    <div className={styles.sourcesDrawer}>
                      {/* Knowledge base chunks */}
                      {msg.sources && msg.sources.length > 0 && (
                        <div className={styles.sourcesGrid}>
                          {msg.sources.map((s, si) => (
                            <div key={si} className={styles.sourceCard}>
                              <div className={styles.sourceFilename} title={s.filename}>
                                <FileText size={12} />
                                <span>{s.filename}</span>
                              </div>
                              <div className={styles.sourceMetadata}>
                                <span>Chunk {s.chunkIndex + 1}</span>
                                <span className={styles.sourceMatchPill}>
                                  {(s.similarity * 100).toFixed(0)}% match
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Live Web Results */}
                      {msg.webSources && msg.webSources.length > 0 && (
                        <div className={styles.sourcesGrid} style={{ marginTop: 6 }}>
                          {msg.webSources.map((ws, wsi) => (
                            <a
                              key={wsi}
                              href={ws.link}
                              target="_blank"
                              rel="noreferrer"
                              className={styles.webSourceCard}
                              title={ws.snippet}
                            >
                              <div className={styles.webSourceTitle}>
                                <ExternalLink size={12} />
                                <span>{ws.title}</span>
                              </div>
                              <div className={styles.webSourceSnippet}>{ws.snippet}</div>
                            </a>
                          ))}
                        </div>
                      )}
                    </div>
                  </details>
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

        {/* Input Area */}
        <div className={styles.inputArea}>
          {/* Pending attachment preview */}
          {pendingAttachment && (
            <div className={styles.attachmentPreview}>
              {pendingAttachment.mimeType.startsWith("image/") && pendingAttachment.previewUrl ? (
                <img
                  src={pendingAttachment.previewUrl}
                  alt="Preview"
                  className={styles.previewThumb}
                />
              ) : pendingAttachment.mimeType.startsWith("audio/") ? (
                <div className={styles.previewIcon}>
                  <FileAudio size={20} />
                </div>
              ) : (
                <div className={styles.previewIcon}>
                  <Film size={20} />
                </div>
              )}
              <span className={styles.previewFilename}>
                {pendingAttachment.file.name}
              </span>
              <button
                className={styles.previewRemoveBtn}
                onClick={clearPendingAttachment}
                title="Remove attachment"
              >
                <X size={14} />
              </button>
            </div>
          )}

          <div className={styles.inputRow}>
            {/* Hidden file input */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif,audio/mpeg,audio/mp3,audio/wav,audio/ogg,audio/webm,audio/mp4,video/mp4,video/webm"
              style={{ display: "none" }}
              onChange={handleFileSelect}
            />

            {isRecording ? (
              <div className={styles.recordingState}>
                <div className={styles.recordingIndicator} />
                <span className={styles.recordingTime}>{formatDuration(recordingDuration)}</span>
                <button
                  className={styles.stopRecordBtn}
                  onClick={stopRecording}
                  title="Stop recording"
                >
                  <Square size={14} fill="currentColor" />
                </button>
                <button
                  className={styles.cancelRecordBtn}
                  onClick={cancelRecording}
                  title="Cancel recording"
                >
                  <X size={16} />
                </button>
              </div>
            ) : (
              <>
                <button
                  className={styles.attachBtn}
                  onClick={() => fileInputRef.current?.click()}
                  disabled={sending}
                  title="Attach image, audio, or video"
                >
                  <Paperclip size={18} />
                </button>
                <button
                  className={styles.micBtn}
                  onClick={startRecording}
                  disabled={sending}
                  title="Record voice message"
                >
                  <Mic size={18} />
                </button>
                <textarea
                  className={styles.chatInput}
                  placeholder="Ask a question or pitch an idea..."
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  rows={1}
                  disabled={sending}
                />
                <button
                  className={styles.sendBtn}
                  onClick={handleSend}
                  disabled={(!input.trim() && !pendingAttachment) || sending}
                  title="Send message (Enter)"
                  aria-label="Send message"
                >
                  <ArrowUp size={18} strokeWidth={2.5} />
                </button>
              </>
            )}
          </div>
        </div>
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
      {/* Settings Modal */}
      {editModalOpen && expert && (
        <EditAssistantModal
          expertId={expert.id}
          initialPrompt={effectivePrompt}
          defaultPrompt={expert.system_prompt || ""}
          isOwner={isOwner}
          onClose={() => setEditModalOpen(false)}
          onSaveSession={(newPrompt) => {
            setSessionPrompt(newPrompt);
            try {
              localStorage.setItem(`mf_expert_prompt_${expert.id}`, newPrompt);
            } catch { }
          }}
          onResetSession={() => {
            setSessionPrompt(null);
            try {
              localStorage.removeItem(`mf_expert_prompt_${expert.id}`);
            } catch { }
          }}
          onSaveGlobal={
            isOwner
              ? async (newPrompt) => {
                const res = await apiClient.patch<{ ok: boolean; expert?: any; error?: string }>(
                  `/api/experts/${expert.id}`,
                  { systemPrompt: newPrompt }
                );
                if (!res.ok) throw new Error(res.error || "Failed to update default rules");
                setExpert((prev: any) => (prev ? { ...prev, system_prompt: newPrompt } : prev));
                setSessionPrompt(null);
                try {
                  localStorage.removeItem(`mf_expert_prompt_${expert.id}`);
                } catch { }
              }
              : undefined
          }
        />
      )}
    </div>
  );
}
