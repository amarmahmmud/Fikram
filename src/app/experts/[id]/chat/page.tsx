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
  MoreHorizontal,
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
  Home,
  ArrowUp,
  ArrowDown,
  FileText,
  ShieldCheck,
  BadgeCheck,
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
  Coins,
  Zap,
  WifiOff,
  RotateCcw,
} from "lucide-react";
import { toast } from "sonner";
import { useTextToSpeech } from "@/hooks/useTextToSpeech";
import { cleanRepetitionLoop } from "@/lib/text-cleaner";
import { BuyCreditsModal } from "@/components/BuyCreditsModal";
import { uploadFileToStorage, fileToDataUrl } from "@/lib/upload-client";

interface Message {
  id?: string;
  role: "user" | "model";
  content: string;
  sources?: { filename: string; chunkIndex: number; similarity: number }[];
  webSources?: { title: string; snippet: string; link: string }[];
  attachment?: { mimeType: string; previewUrl?: string; filename?: string; file?: File };
  isInsufficientCredits?: boolean;
  creditsRequired?: number;
  creditsBalance?: number;
  isNetworkError?: boolean;
  isResponseTooLong?: boolean;
  retryPayload?: {
    userMsg: string;
    attachment?: any;
  };
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
  const [isVerifiedCreator, setIsVerifiedCreator] = useState(false);
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
    primeAudio,
  } = useTextToSpeech();

  // Auto-voice response state (Option A: first reply in each conversation auto-plays; persisted in Supabase per user + localStorage)
  const [autoVoiceEnabled, setAutoVoiceEnabled] = useState<boolean>(() => {
    if (typeof window !== "undefined") {
      try {
        const stored = localStorage.getItem("mf_auto_voice_enabled");
        if (stored !== null) return stored === "true";
      } catch { }
    }
    return true;
  });

  // Update voice preference with optimistic UI update, persistence via API, and rollback on error
  const updateVoicePreference = useCallback(async (enabled: boolean) => {
    // 1. Optimistic update
    setAutoVoiceEnabled(enabled);
    try {
      localStorage.setItem("mf_auto_voice_enabled", String(enabled));
    } catch { }

    if (!enabled) {
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

    // 2. Persist to Supabase via API
    try {
      const activeUser = currentUser || (await supabase.auth.getUser()).data?.user;
      if (activeUser) {
        await apiClient.patch("/api/user/preferences", { voice_enabled: enabled });
      }
    } catch (err) {
      console.error("Failed to persist voice preference:", err);
      // 3. Rollback UI on failure
      setAutoVoiceEnabled(!enabled);
      try {
        localStorage.setItem("mf_auto_voice_enabled", String(!enabled));
      } catch { }
      toast.error("Failed to save voice preference", {
        description: "Could not update your preference. Reverting change.",
        duration: 4000,
      });
    }
  }, [currentUser, stopCurrentPlayback, supabase]);

  // Toggle auto-voice on/off with persistence & user feedback
  const handleToggleAutoVoice = useCallback(() => {
    updateVoicePreference(!autoVoiceEnabled);
  }, [autoVoiceEnabled, updateVoicePreference]);

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

  // Sidebar, Mobile Menu, and Conversation state
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [creditsBalance, setCreditsBalance] = useState<number | null>(null);
  const [showBuyModal, setShowBuyModal] = useState(false);

  const abortControllerRef = useRef<AbortController | null>(null);

  const stopGenerating = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      setSending(false);
    }
  }, []);

  // Auto-expand sidebar on desktop devices
  useEffect(() => {
    if (typeof window !== "undefined" && window.innerWidth > 768) {
      setSidebarOpen(true);
    }
  }, []);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const messagesAreaRef = useRef<HTMLDivElement>(null);
  const [showScrollBottom, setShowScrollBottom] = useState(false);
  const isInitialLoadRef = useRef(true);
  const userScrolledUpRef = useRef(false);

  // Lock body/document scrolling while on the chat page (prevents mobile browser address bar jumps & window scroll)
  useEffect(() => {
    const originalBodyOverflow = document.body.style.overflow;
    const originalHtmlOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    window.scrollTo(0, 0);

    return () => {
      document.body.style.overflow = originalBodyOverflow;
      document.documentElement.style.overflow = originalHtmlOverflow;
    };
  }, []);

  /** Safely scroll the messages container without scrolling the browser window or top bar */
  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    if (!messagesAreaRef.current) return;
    const container = messagesAreaRef.current;
    if (behavior === "instant") {
      container.scrollTop = container.scrollHeight;
    } else {
      container.scrollTo({
        top: container.scrollHeight,
        behavior: "smooth",
      });
    }
  }, []);

  /** Track user scroll position in the messages container to detect scroll-up intent */
  const handleMessagesScroll = useCallback(() => {
    if (!messagesAreaRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = messagesAreaRef.current;
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
    const isScrolledUp = distanceFromBottom > 120;
    userScrolledUpRef.current = isScrolledUp;
    setShowScrollBottom(isScrolledUp);
  }, []);

  // Attachments & Mic (Speech-to-Text)
  const [pendingAttachment, setPendingAttachment] = useState<{ file: File; previewUrl?: string; mimeType: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const isRecordingRef = useRef(false);
  const isCancelledRef = useRef(false);
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
        setIsVerifiedCreator(Boolean(res.isVerifiedCreator || res.expert?.isVerified));
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
      if (data.user_id) {
        const { data: prof } = await supabase
          .from("profiles")
          .select("email, role")
          .eq("id", data.user_id)
          .maybeSingle();
        if ((prof as any)?.role === "admin" || (prof as any)?.email?.toLowerCase().trim() === "amarmahmmud10@gmail.com") {
          setIsVerifiedCreator(true);
        }
      }
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
    isInitialLoadRef.current = true;
    userScrolledUpRef.current = false;
    setShowScrollBottom(false);
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
              content: m.role === "model" ? cleanRepetitionLoop(m.content) : m.content,
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
        const parsed = JSON.parse(localMsgs);
        setMessages(
          parsed.map((m: any) => ({
            ...m,
            content: m.role === "model" ? cleanRepetitionLoop(m.content) : m.content,
          }))
        );
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

        if (user && mounted) {
          // Fetch user preferences from Supabase (defaults to true if no row exists yet)
          try {
            const { data: prefData } = await supabase
              .from("user_preferences")
              .select("voice_enabled")
              .eq("user_id", user.id)
              .maybeSingle();

            if (prefData && typeof prefData.voice_enabled === "boolean" && mounted) {
              setAutoVoiceEnabled(prefData.voice_enabled);
              try {
                localStorage.setItem("mf_auto_voice_enabled", String(prefData.voice_enabled));
              } catch { }
            }
          } catch (prefErr) {
            console.error("Failed to load user preferences:", prefErr);
          }

          const { data: profile } = await supabase
            .from("profiles")
            .select("credits_balance, credits_held")
            .eq("id", user.id)
            .single();
          if (profile && mounted) {
            const avail = Math.max(0, (profile.credits_balance ?? 0) - (profile.credits_held ?? 0));
            setCreditsBalance(avail);
          }
        }

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

  // Smart auto-scroll: never scrolls the browser window/top bar, keeps welcome message visible on new chat
  useEffect(() => {
    if (isInitialLoadRef.current) {
      // First load: if new chat (only welcome message or empty), stay at top so top bar & welcome are fully in view!
      if (messages.length <= 1) {
        if (messagesAreaRef.current) {
          messagesAreaRef.current.scrollTop = 0;
        }
        isInitialLoadRef.current = false;
        return;
      }
      // If loading an existing conversation with history, jump instantly to bottom without disorienting animation
      scrollToBottom("instant");
      isInitialLoadRef.current = false;
      return;
    }

    // Subsequent updates: only auto-scroll if user has not scrolled up to read past messages
    if (!userScrolledUpRef.current || sending) {
      scrollToBottom("smooth");
    }
  }, [messages, sending, scrollToBottom]);

  /** Start a new chat */
  function handleNewChat() {
    setActiveConvId(null);
    if (typeof window !== "undefined" && window.innerWidth <= 768) {
      setSidebarOpen(false);
    }
    if (expert) {
      setMessages([getInitialWelcomeMessage(expert)]);
    }
    isInitialLoadRef.current = true;
    userScrolledUpRef.current = false;
    setShowScrollBottom(false);
    if (messagesAreaRef.current) {
      messagesAreaRef.current.scrollTop = 0;
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


  /** Send message or retry a failed message */
  async function sendMessage(retryOptions?: {
    content: string;
    attachment?: any;
    replaceIndex?: number;
  }) {
    const isRetry = Boolean(retryOptions && retryOptions.replaceIndex !== undefined);
    const userMsg = (retryOptions ? retryOptions.content : input).trim();
    const activeAttachment = retryOptions ? retryOptions.attachment : pendingAttachment;

    if (!userMsg || sending) return;

    if (!isRetry) {
      setInput("");
    }

    // Determine if this is the very first user interaction in this chat
    const isFirstUserMessage = messages.filter((m) => m.role === "user").length === 0;

    // Synchronously prime the HTML5 audio element under the user's click/keypress gesture
    if (autoVoiceEnabled && isFirstUserMessage) {
      primeAudio();
    }

    if (isRetry && retryOptions?.replaceIndex !== undefined) {
      // Remove the failed model error message before retrying
      setMessages((prev) => prev.filter((_, idx) => idx !== retryOptions.replaceIndex));
    } else {
      // Build user message with optional attachment preview
      const userMessage: Message = { role: "user", content: userMsg };
      if (activeAttachment) {
        userMessage.attachment = {
          mimeType: activeAttachment.mimeType,
          previewUrl: activeAttachment.previewUrl,
          filename: activeAttachment.file ? activeAttachment.file.name : activeAttachment.filename,
        };
      }
      userScrolledUpRef.current = false;
      setShowScrollBottom(false);
      setMessages((prev) => [...prev, userMessage]);
    }
    setSending(true);

    try {
      let data: any;

      let attachmentPayload: { url?: string; data?: string; mimeType: string; filename: string } | undefined;
      if (activeAttachment?.file) {
        try {
          const { downloadUrl } = await uploadFileToStorage(activeAttachment.file);
          attachmentPayload = {
            url: downloadUrl,
            mimeType: activeAttachment.mimeType,
            filename: activeAttachment.file.name,
          };
        } catch (storageErr) {
          console.warn("[Chat] Storage upload failed, using inline base64 fallback:", storageErr);
          const dataUrl = await fileToDataUrl(activeAttachment.file);
          attachmentPayload = {
            data: dataUrl,
            mimeType: activeAttachment.mimeType,
            filename: activeAttachment.file.name,
          };
        }
        if (!isRetry) setPendingAttachment(null);
      }

      const chatPayload = {
        message: userMsg,
        conversationId: activeConvId,
        history: messages
          .filter((m) => m.role === "user" || m.role === "model")
          .slice(-10)
          .map((m) => ({ role: m.role, content: m.content })),
        attachment: attachmentPayload,
        systemPrompt: effectivePrompt || undefined,
        stream: true,
      };

      // Add temporary model placeholder message for streaming tokens
      setMessages((prev) => [...prev, { role: "model", content: "" }]);

      abortControllerRef.current = new AbortController();

      const res = await fetch(`/api/experts/${expertId}/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream, application/json",
        },
        body: JSON.stringify(chatPayload),
        signal: abortControllerRef.current.signal,
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        setMessages((prev) => prev.slice(0, -1));
        const { ApiError } = await import("@/lib/apiClient");
        throw new ApiError(errorData?.error || errorData?.message || "Failed to generate response", res.status, errorData);
      }

      const contentType = res.headers.get("Content-Type") || "";
      if (contentType.includes("text/event-stream") && res.body) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let streamBuffer = "";
        let finalEventData: any = null;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          streamBuffer += decoder.decode(value, { stream: true });
          const lines = streamBuffer.split("\n\n");
          streamBuffer = lines.pop() || "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data:")) continue;
            const jsonText = trimmed.slice(5).trim();
            if (!jsonText) continue;

            try {
              const event = JSON.parse(jsonText);
              if (event.type === "chunk") {
                const displayContent = event.partial || event.text || "";
                setMessages((prev) => {
                  if (prev.length === 0) return prev;
                  const lastIdx = prev.length - 1;
                  if (prev[lastIdx].role !== "model") return prev;
                  const updated = [...prev];
                  updated[lastIdx] = {
                    ...updated[lastIdx],
                    content: displayContent,
                  };
                  return updated;
                });
              } else if (event.type === "done") {
                finalEventData = event;
              } else if (event.type === "error") {
                setMessages((prev) => prev.slice(0, -1));
                const errObj = new Error(event.error || "Generation error");
                (errObj as any).code = event.code;
                (errObj as any).language = event.language;
                throw errObj;
              }
            } catch (pErr: any) {
              if (pErr?.code === "RESPONSE_TOO_LONG" || pErr instanceof Error) throw pErr;
            }
          }
        }

        data = finalEventData || { ok: true, reply: "" };
      } else {
        data = await res.json();
      }

      if (data.ok) {
        const safeReply = cleanRepetitionLoop(data.reply || "");
        const newModelMsg: Message = {
          role: "model",
          content: safeReply,
          sources: data.sources,
          webSources: data.webSources,
        };

        setMessages((prev) => {
          if (prev.length === 0) return prev;
          const lastIdx = prev.length - 1;
          const updated = [...prev];
          updated[lastIdx] = newModelMsg;
          return updated;
        });

        const newModelIndex = messages.length + 1;

        // Option A: Auto-play voice on the very first assistant response in this conversation
        if (isFirstUserMessage && autoVoiceEnabled && safeReply) {
          togglePlayMessage(safeReply, newModelIndex);

          // Discovery toast with 1-click turn-off action
          toast("🔊 Voice Response Active", {
            description: "First responses speak automatically. You can toggle this off anytime.",
            action: {
              label: "Turn Off",
              onClick: () => {
                updateVoicePreference(false);
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
      } else if (data?.code === "RESPONSE_TOO_LONG") {
        setMessages((prev) => [
          ...prev,
          {
            role: "model",
            content: "",
            isResponseTooLong: true,
            retryPayload: {
              userMsg,
              attachment: activeAttachment,
            },
          },
        ]);
        toast.warning("Response was too long", {
          description: "The analysis exceeded the output limit. Click Retry to run with an extended budget.",
          duration: 4500,
        });
      } else {
        setMessages((prev) => [
          ...prev,
          { role: "model", content: `**Error**: ${data.error || "Something went wrong"}` },
        ]);
      }
    } catch (err: any) {
      if (err.name === "AbortError") {
        return;
      }
      if (
        err?.code === "RESPONSE_TOO_LONG" ||
        err?.data?.code === "RESPONSE_TOO_LONG" ||
        String(err?.message || "").includes("Response was too long")
      ) {
        setMessages((prev) => [
          ...prev,
          {
            role: "model",
            content: "",
            isResponseTooLong: true,
            retryPayload: {
              userMsg,
              attachment: activeAttachment,
            },
          },
        ]);
        toast.warning("Response was too long", {
          description: "The analysis exceeded the output limit. Click Retry to run with an extended budget.",
          duration: 4500,
        });
      } else if (
        err?.isInsufficientCredits ||
        err?.status === 402 ||
        String(err?.message || "").toLowerCase().includes("insufficient credit")
      ) {
        const req = err?.creditsRequired ?? err?.data?.credits_required ?? 1;
        const bal = err?.creditsBalance ?? err?.data?.credits_balance ?? (creditsBalance ?? 0);
        setMessages((prev) => [
          ...prev,
          {
            role: "model",
            content: "",
            isInsufficientCredits: true,
            creditsRequired: req,
            creditsBalance: bal,
          },
        ]);
        setCreditsBalance(bal);
      } else if (
        err?.isNetworkError ||
        err?.status === 0 ||
        err?.message?.toLowerCase().includes("failed to fetch")
      ) {
        setMessages((prev) => [
          ...prev,
          {
            role: "model",
            content: "",
            isNetworkError: true,
            retryPayload: {
              userMsg,
              attachment: activeAttachment,
            },
          },
        ]);
        toast.error("Connection problem", {
          description: "Unable to reach the assistant. You can retry your message anytime.",
          duration: 4000,
        });
      } else {
        setMessages((prev) => [
          ...prev,
          { role: "model", content: `**Error**: ${err?.message || "An unexpected error occurred. Please try again."}` },
        ]);
      }
    } finally {
      setSending(false);
    }
  }

  async function handleSend() {
    return sendMessage();
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

  // ── Microphone Recording & Speech-to-Text Logic ──────────────────────────

  const startRecording = async () => {
    if (isRecording || isTranscribing || sending) return;
    isCancelledRef.current = false;

    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      toast.error("Microphone not supported", {
        description: "Your browser does not support audio recording. Please use Chrome, Edge, or Safari.",
        duration: 4000,
      });
      return;
    }

    try {
      console.log("[STT] Requesting microphone access...");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      console.log("[STT] Microphone access granted.");

      // Pick supported audio format
      let mimeType = "audio/webm";
      if (typeof MediaRecorder !== "undefined" && typeof MediaRecorder.isTypeSupported === "function") {
        if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) {
          mimeType = "audio/webm;codecs=opus";
        } else if (MediaRecorder.isTypeSupported("audio/mp4")) {
          mimeType = "audio/mp4";
        } else if (MediaRecorder.isTypeSupported("audio/ogg")) {
          mimeType = "audio/ogg";
        }
      }

      const mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          audioChunksRef.current.push(e.data);
        }
      };

      mediaRecorder.onstop = async () => {
        console.log("[STT] MediaRecorder stopped. Releasing audio stream tracks...");
        stream.getTracks().forEach((track) => track.stop());

        setIsRecording(false);
        isRecordingRef.current = false;
        if (timerRef.current) clearInterval(timerRef.current);
        setRecordingDuration(0);

        if (isCancelledRef.current) {
          console.log("[STT] Recording cancelled by user.");
          return;
        }

        const totalBytes = audioChunksRef.current.reduce((acc, chunk) => acc + chunk.size, 0);
        console.log(`[STT] Audio captured: ${audioChunksRef.current.length} chunks (${totalBytes} bytes).`);

        if (totalBytes < 500) {
          toast.info("Recording was too short. Speak and press stop when done.", { duration: 3000 });
          return;
        }

        const audioBlob = new Blob(audioChunksRef.current, {
          type: mediaRecorder.mimeType || mimeType || "audio/webm",
        });

        setIsTranscribing(true);
        console.log("[STT] Sending audio to /api/stt for transcription...");

        try {
          const formData = new FormData();
          formData.append("file", audioBlob, "voice-input.webm");

          const res = await fetch("/api/stt", {
            method: "POST",
            body: formData,
          });

          const data = await res.json();
          console.log("[STT] Transcription response:", data);

          if (!res.ok || !data.ok) {
            const errorMsg = data?.error || "Voice transcription failed. Please try again.";
            toast.error(errorMsg, { duration: 4000 });
          } else if (data.noSpeech || !data.text?.trim()) {
            toast.info("Couldn't hear that. Please speak closer to the mic and try again.", {
              duration: 3500,
            });
          } else {
            const transcribedText = data.text.trim();
            console.log(`[STT] Inserting transcribed text: "${transcribedText}"`);
            setInput((prev) => {
              const base = prev.trim();
              return base ? `${base} ${transcribedText}` : transcribedText;
            });
            toast.success("Voice transcribed!", { duration: 1800 });
            setTimeout(() => {
              textareaRef.current?.focus();
            }, 100);
          }
        } catch (fetchErr: any) {
          console.error("[STT] Network error during transcription:", fetchErr);
          toast.error("Unable to reach speech service. Please check your connection.", {
            duration: 4000,
          });
        } finally {
          setIsTranscribing(false);
        }
      };

      mediaRecorder.start(250);
      setIsRecording(true);
      isRecordingRef.current = true;
      setRecordingDuration(0);
      timerRef.current = setInterval(() => {
        setRecordingDuration((prev) => prev + 1);
      }, 1000);
      console.log("[STT] Recording started.");
    } catch (err: any) {
      console.error("[STT] Microphone access error:", err);
      if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
        toast.error("Microphone access denied", {
          description: "Please allow microphone access in your browser to use voice input.",
          duration: 5000,
        });
      } else if (err.name === "NotFoundError" || err.name === "DevicesNotFoundError") {
        toast.error("No microphone detected", {
          description: "Please connect a working microphone and try again.",
          duration: 4000,
        });
      } else {
        toast.error("Microphone error: " + (err.message || "Failed to access microphone"));
      }
      setIsRecording(false);
      isRecordingRef.current = false;
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecordingRef.current) {
      isCancelledRef.current = false;
      mediaRecorderRef.current.stop();
    }
  };

  const cancelRecording = () => {
    if (mediaRecorderRef.current && isRecordingRef.current) {
      isCancelledRef.current = true;
      mediaRecorderRef.current.stop();
      toast.info("Recording cancelled", { duration: 1500 });
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

  const processingText = expertMetadata?.reasoningMode === "evaluative"
    ? "Evaluating your concept..."
    : expertMetadata?.reasoningMode === "strict"
      ? "Searching knowledge base..."
      : "Processing your request...";

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
              aria-label={currentUser ? "Back to Dashboard" : "Back to Browse"}
            >
              <Home size={16} />
            </Link>

            <div className={styles.expertAvatar}>
              {expert.name.charAt(0).toUpperCase()}
            </div>

            <div className={styles.headerTitles}>
              <div className={styles.expertName} title={expert.name}>{expert.name}</div>
              <div className={`${styles.expertTag} ${styles.desktopOnly}`}>
                {isVerifiedCreator && (
                  <span
                    className={styles.verifiedCommunityBadge}
                    title="Verified by Fikram Community — Official Platform Model"
                  >
                    <BadgeCheck size={13} className={styles.verifiedBadgeIcon} />
                    <span>Verified by Fikram Community</span>
                  </span>
                )}
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
            <div className={styles.desktopOnlyActions}>
              {/* Auto-Voice Response Toggle */}
              <button
                className={`btn btn-secondary btn-sm ${styles.actionBtn} ${autoVoiceEnabled ? styles.actionBtnVoiceActive : styles.actionBtnVoiceMuted
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
              {isOwner && (
                <button
                  className={`btn btn-secondary btn-sm ${styles.actionBtn}`}
                  onClick={() => setPublishModalOpen(true)}
                  title="Publish & Share settings"
                >
                  <Globe size={16} />
                  <span className={styles.btnLabel}>{expert.is_published ? "Published" : "Publish & Share"}</span>
                </button>
              )}
            </div>

            <div className={styles.persistentActions}>
              <button
                className={`btn btn-secondary btn-sm ${styles.actionBtn}`}
                onClick={handleNewChat}
                title="Start a new chat"
              >
                <Plus size={16} />
                <span className={styles.btnLabel}>New Chat</span>
              </button>
              {!isOwner && (
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
              {currentUser && creditsBalance !== null && (
                <button
                  className={`btn btn-secondary btn-sm ${styles.actionBtn} ${creditsBalance === 0 ? styles.actionBtnWarning : ""}`}
                  onClick={() => setShowBuyModal(true)}
                  title="Your credits balance. Click to refill."
                >
                  <Coins size={15} color={creditsBalance === 0 ? "#fbbf24" : "var(--accent-primary)"} />
                  <span className={styles.btnLabel}>{creditsBalance.toLocaleString()} credits</span>
                </button>
              )}
              
              <button
                className={`btn btn-secondary btn-sm ${styles.actionBtn} ${styles.mobileMenuBtn}`}
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                title="More options"
                aria-label="Open more options"
              >
                <MoreHorizontal size={16} />
              </button>
            </div>
          </div>
        </header>

        {/* Mobile Dropdown Menu */}
        {mobileMenuOpen && (
          <>
            <div className={styles.mobileMenuBackdrop} onClick={() => setMobileMenuOpen(false)} aria-hidden="true" />
            <div className={styles.mobileMenu}>
              <div className={styles.mobileMenuSection}>
                <div className={styles.mobileMenuLabel}>Status</div>
                <div className={styles.expertTagMobile}>
                  {isVerifiedCreator && (
                    <span
                      className={styles.verifiedCommunityBadge}
                      title="Verified by Fikram Community — Official Platform Model"
                    >
                      <BadgeCheck size={13} className={styles.verifiedBadgeIcon} />
                      <span>Verified by Fikram Community</span>
                    </span>
                  )}
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
              
              <div className={styles.mobileMenuDivider} />

              <div className={styles.mobileMenuSection}>
                <div className={styles.mobileMenuLabel}>Options</div>
                <div className={styles.mobileMenuActions}>
                  <button
                    className={`btn btn-secondary btn-sm ${styles.mobileMenuItem}`}
                    onClick={() => {
                      handleNewChat();
                      setMobileMenuOpen(false);
                    }}
                  >
                    <Plus size={16} />
                    <span>New Chat</span>
                  </button>
                  <button
                    className={`btn btn-secondary btn-sm ${styles.mobileMenuItem} ${autoVoiceEnabled ? styles.mobileMenuItemActive : ""}`}
                    onClick={() => {
                      handleToggleAutoVoice();
                      setMobileMenuOpen(false);
                    }}
                  >
                    {autoVoiceEnabled ? <Volume2 size={16} /> : <VolumeX size={16} />}
                    <span>{autoVoiceEnabled ? "Voice: ON" : "Voice: OFF"}</span>
                  </button>
                  <button
                    className={`btn btn-secondary btn-sm ${styles.mobileMenuItem} ${isCustomized ? styles.mobileMenuItemActive : ""}`}
                    onClick={() => {
                      setEditModalOpen(true);
                      setMobileMenuOpen(false);
                    }}
                  >
                    <Settings2 size={16} />
                    <span>{isCustomized ? "Rules (Custom)" : "Edit Rules"}</span>
                  </button>
                  <button
                    className={`btn btn-secondary btn-sm ${styles.mobileMenuItem}`}
                    onClick={() => {
                      setSourcesModalOpen(true);
                      setMobileMenuOpen(false);
                    }}
                  >
                    <BookOpen size={16} />
                    <span>Knowledge Base {totalChunks > 0 ? `(${totalChunks})` : ""}</span>
                  </button>
                  {isOwner && (
                    <button
                      className={`btn btn-secondary btn-sm ${styles.mobileMenuItem}`}
                      onClick={() => {
                        setPublishModalOpen(true);
                        setMobileMenuOpen(false);
                      }}
                    >
                      <Globe size={16} />
                      <span>{expert.is_published ? "Published" : "Publish & Share"}</span>
                    </button>
                  )}
                </div>
              </div>
            </div>
          </>
        )}

        {/* Messages */}
        <div
          className={styles.messagesArea}
          ref={messagesAreaRef}
          onScroll={handleMessagesScroll}
        >
          {messages.map((msg, i) => (
            <div
              key={i}
              className={`${styles.messageBubble} ${msg.role === "user" ? styles.userBubble : styles.modelBubble
                } ${playingIndex === i ? styles.modelBubblePlaying : ""}`}
            >
              <div className={styles.messageContent}>
                {msg.isInsufficientCredits ? (
                  <div className={styles.insufficientCreditsCard}>
                    <div className={styles.insufficientCreditsHeader}>
                      <div className={styles.insufficientCreditsIcon}>
                        <Zap size={18} />
                      </div>
                      <div>
                        <div className={styles.insufficientCreditsTitle}>Credit Limit Reached</div>
                        <div className={styles.insufficientCreditsSub}>
                          This request required {msg.creditsRequired ?? 1} credit{(msg.creditsRequired ?? 1) > 1 ? "s" : ""}, but your current balance is {msg.creditsBalance ?? 0}. Top up your credits to continue chatting.
                        </div>
                      </div>
                    </div>

                    <div className={styles.insufficientCreditsActions}>
                      <button
                        type="button"
                        className={styles.insufficientCreditsBtnPrimary}
                        onClick={() => setShowBuyModal(true)}
                      >
                        <Coins size={14} />
                        <span>Top Up Credits</span>
                      </button>
                      <Link href="/credits" className={styles.insufficientCreditsBtnSecondary}>
                        <span>View Plans &amp; Billing</span>
                      </Link>
                    </div>
                  </div>
                ) : msg.isNetworkError ? (
                  <div className={styles.networkErrorCard}>
                    <div className={styles.networkErrorHeader}>
                      <div className={styles.networkErrorIcon}>
                        <WifiOff size={18} />
                      </div>
                      <div>
                        <div className={styles.networkErrorTitle}>Connection Interrupted</div>
                        <div className={styles.networkErrorSub}>
                          Unable to reach the assistant due to a network connection issue. Your message draft has been preserved.
                        </div>
                      </div>
                    </div>

                    <div className={styles.networkErrorActions}>
                      <button
                        type="button"
                        className={styles.networkErrorBtnPrimary}
                        disabled={sending}
                        onClick={() => {
                          if (msg.retryPayload) {
                            sendMessage({
                              content: msg.retryPayload.userMsg,
                              attachment: msg.retryPayload.attachment,
                              replaceIndex: i,
                            });
                          }
                        }}
                      >
                        <RotateCcw size={14} className={sending ? styles.spinning : ""} />
                        <span>Retry Message</span>
                      </button>

                      {msg.retryPayload?.userMsg && (
                        <button
                          type="button"
                          className={styles.networkErrorBtnSecondary}
                          onClick={() => {
                            if (typeof navigator !== "undefined" && navigator.clipboard) {
                              navigator.clipboard.writeText(msg.retryPayload!.userMsg).then(() => {
                                toast.success("Saved message text copied to clipboard!");
                              }).catch(() => {
                                fallbackCopyText(msg.retryPayload!.userMsg, () => {
                                  toast.success("Saved message text copied to clipboard!");
                                });
                              });
                            } else {
                              fallbackCopyText(msg.retryPayload!.userMsg, () => {
                                toast.success("Saved message text copied to clipboard!");
                              });
                            }
                          }}
                        >
                          <Copy size={13} />
                          <span>Copy Saved Text</span>
                        </button>
                      )}
                    </div>
                  </div>
                ) : msg.isResponseTooLong ? (
                  <div className={styles.networkErrorCard}>
                    <div className={styles.networkErrorHeader}>
                      <div className={styles.networkErrorIcon}>
                        <RotateCcw size={18} />
                      </div>
                      <div>
                        <div className={styles.networkErrorTitle}>Response was too long, retrying</div>
                        <div className={styles.networkErrorSub}>
                          The analysis in this language reached the output token budget. Click Retry below to regenerate with an extended budget.
                        </div>
                      </div>
                    </div>

                    <div className={styles.networkErrorActions}>
                      <button
                        type="button"
                        className={styles.networkErrorBtnPrimary}
                        disabled={sending}
                        onClick={() => {
                          if (msg.retryPayload) {
                            sendMessage({
                              content: msg.retryPayload.userMsg,
                              attachment: msg.retryPayload.attachment,
                              replaceIndex: i,
                            });
                          }
                        }}
                      >
                        <RotateCcw size={14} className={sending ? styles.spinning : ""} />
                        <span>Retry Analysis</span>
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
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
                    {sending && msg.role === "model" && i === messages.length - 1 ? (
                      <div className={styles.processingState}>
                        <Loader2 size={16} className={styles.spinIcon} />
                        <span>{processingText}</span>
                      </div>
                    ) : (
                      <MarkdownContent content={msg.content} />
                    )}
                  </>
                )}
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

        {/* Floating Scroll to Bottom Button */}
        {showScrollBottom && (
          <button
            type="button"
            className={styles.scrollToBottomBtn}
            onClick={() => {
              userScrolledUpRef.current = false;
              setShowScrollBottom(false);
              scrollToBottom("smooth");
            }}
            title="Scroll to latest message"
            aria-label="Scroll to latest message"
          >
            <ArrowDown size={18} />
          </button>
        )}

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

            {isTranscribing ? (
              <div className={styles.transcribingState}>
                <Loader2 size={16} className={styles.transcribingSpinner} />
                <span className={styles.transcribingText}>Transcribing your speech...</span>
              </div>
            ) : isRecording ? (
              <div className={styles.recordingState}>
                <div className={styles.recordingIndicator} />
                <span className={styles.recordingTime}>{formatDuration(recordingDuration)}</span>
                <button
                  type="button"
                  className={styles.stopRecordBtn}
                  onClick={stopRecording}
                  title="Stop and transcribe"
                >
                  <Square size={14} fill="currentColor" />
                </button>
                <button
                  type="button"
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
                  type="button"
                  className={styles.attachBtn}
                  onClick={() => fileInputRef.current?.click()}
                  disabled={sending || isTranscribing}
                  title="Attach image, audio, or video"
                >
                  <Paperclip size={18} />
                </button>
                <button
                  type="button"
                  className={styles.micBtn}
                  onClick={startRecording}
                  disabled={sending || isTranscribing}
                  title="Voice input (Speech-to-text)"
                >
                  <Mic size={18} />
                </button>
                <textarea
                  ref={textareaRef}
                  className={styles.chatInput}
                  placeholder="Ask a question or pitch an idea..."
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  rows={1}
                  disabled={sending || isTranscribing}
                />
                {sending ? (
                  <button
                    type="button"
                    className={styles.stopBtn}
                    onClick={stopGenerating}
                    title="Stop generating"
                    aria-label="Stop generating"
                  >
                    <Square size={16} fill="currentColor" />
                  </button>
                ) : (
                  <button
                    type="button"
                    className={styles.sendBtn}
                    onClick={handleSend}
                    disabled={(!input.trim() && !pendingAttachment) || isTranscribing}
                    title="Send message (Enter)"
                    aria-label="Send message"
                  >
                    <ArrowUp size={18} strokeWidth={2.5} />
                  </button>
                )}
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

      <BuyCreditsModal
        isOpen={showBuyModal}
        onClose={() => setShowBuyModal(false)}
        creditsRequired={1}
        currentBalance={creditsBalance ?? 0}
        actionName={`chat with ${expert.name}`}
        returnUrl={`/experts/${expertId}/chat`}
        onSuccess={(newBal) => {
          setCreditsBalance(newBal);
          toast.success("Credits refilled! You can now continue chatting.");
        }}
      />
    </div>
  );
}
