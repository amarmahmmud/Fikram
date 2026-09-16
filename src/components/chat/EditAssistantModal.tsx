import { useState } from "react";
import styles from "./EditAssistantModal.module.css";
import { Settings2, X, Plus, RotateCcw, Check, Sparkles } from "lucide-react";
import { toast } from "sonner";

interface EditAssistantModalProps {
  expertId: string;
  initialPrompt: string;
  defaultPrompt: string;
  isOwner: boolean;
  onClose: () => void;
  onSaveSession: (newPrompt: string) => void;
  onResetSession: () => void;
  onSaveGlobal?: (newPrompt: string) => Promise<void>;
}

const SUGGESTIONS = [
  "Make responses shorter and more concise",
  "Use bullet points for lists",
  "Focus on concrete numbers and unit economics",
  "Adopt a friendly and witty tone",
  "Explain complex concepts simply",
  "Never mention that you are an AI",
];

export function EditAssistantModal({
  expertId: _expertId,
  initialPrompt,
  defaultPrompt,
  isOwner,
  onClose,
  onSaveSession,
  onResetSession,
  onSaveGlobal,
}: EditAssistantModalProps) {
  const [prompt, setPrompt] = useState(initialPrompt || defaultPrompt || "");
  const [savingGlobal, setSavingGlobal] = useState(false);

  const isModifiedFromDefault = prompt.trim() !== (defaultPrompt || "").trim();
  const isModifiedFromInitial = prompt.trim() !== (initialPrompt || "").trim();

  const addSuggestion = (text: string) => {
    setPrompt((prev) => (prev ? `${prev.trim()}\n- ${text}` : `- ${text}`));
  };

  const handleApplySession = () => {
    onSaveSession(prompt.trim());
    toast.success("Custom rules applied to your session!");
    onClose();
  };

  const handleResetToDefault = () => {
    setPrompt(defaultPrompt || "");
    onResetSession();
    toast.info("Reset instructions back to creator default.");
  };

  const handleSaveGlobal = async () => {
    if (!onSaveGlobal) return;
    setSavingGlobal(true);
    try {
      await onSaveGlobal(prompt.trim());
      toast.success("Default assistant instructions updated globally!");
      onClose();
    } catch (e: any) {
      toast.error(e?.message || "Failed to update default rules");
    } finally {
      setSavingGlobal(false);
    }
  };

  return (
    <div className={styles.overlay} onClick={onClose} role="dialog" aria-modal="true">
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className={styles.header}>
          <div className={styles.titleGroup}>
            <div className={styles.iconWrap}>
              <Settings2 size={20} />
            </div>
            <div>
              <div className={styles.titleRow}>
                <span className={styles.title}>Assistant Rules</span>
                <span className={`${styles.scopeBadge} ${isOwner ? styles.scopeBadgeOwner : ""}`}>
                  {isOwner ? "Owner / Session" : "Session Only"}
                </span>
              </div>
              <div className={styles.subtitle}>
                Customize behavior for your personal chat session
              </div>
            </div>
          </div>
          <button className={styles.closeBtn} onClick={onClose} title="Close modal" aria-label="Close">
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className={styles.body}>
          {/* Information Banner */}
          <div className={styles.scopeBanner}>
            <span className={styles.scopeBannerIcon}>🔒</span>
            <div>
              <strong>Personal Session Scope:</strong> Rules you add here will customize how the assistant responds to you in your chat. They will <em>not</em> overwrite the assistant for any other users.
            </div>
          </div>

          {/* Quick Suggestions */}
          <div>
            <div className={styles.sectionTitle}>Quick Rules & Persona Tweaks</div>
            <div className={styles.suggestionsList}>
              {SUGGESTIONS.map((sug, i) => (
                <button
                  key={i}
                  type="button"
                  className={styles.suggestionBtn}
                  onClick={() => addSuggestion(sug)}
                >
                  <Plus size={13} /> {sug}
                </button>
              ))}
            </div>
          </div>

          {/* System Instructions Editor */}
          <div className={styles.textareaWrap}>
            <div className={styles.textareaHeader}>
              <div className={styles.sectionTitle} style={{ margin: 0 }}>
                System Instructions & Rules
              </div>
              <span className={styles.charCount}>
                {prompt.length} / 8000
              </span>
            </div>
            <textarea
              className={styles.textarea}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value.slice(0, 8000))}
              placeholder="e.g., Focus specifically on B2B SaaS ideas. Be brutally honest about CAC vs LTV..."
            />
          </div>
        </div>

        {/* Footer */}
        <div className={styles.footer}>
          <div className={styles.footerLeft}>
            <button
              type="button"
              className={styles.resetBtn}
              onClick={handleResetToDefault}
              disabled={!isModifiedFromDefault}
              title="Restore creator default rules"
            >
              <RotateCcw size={13} /> Reset to Default
            </button>
          </div>

          <div className={styles.footerRight}>
            <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>
              Cancel
            </button>

            {isOwner && onSaveGlobal && (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={handleSaveGlobal}
                disabled={savingGlobal || !isModifiedFromInitial}
                title="Save as the default instructions for all users"
                style={{ borderColor: "rgba(0, 229, 200, 0.3)" }}
              >
                <Sparkles size={14} />
                {savingGlobal ? "Saving..." : "Save as Default"}
              </button>
            )}

            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={handleApplySession}
              style={{ gap: 6 }}
            >
              <Check size={14} /> Apply to My Session
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
