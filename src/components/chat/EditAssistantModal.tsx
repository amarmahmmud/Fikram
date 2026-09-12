import { useState } from "react";
import styles from "./EditAssistantModal.module.css";
import { Settings2, X, Plus } from "lucide-react";
import { apiClient } from "@/lib/apiClient";
import { toast } from "sonner";

interface EditAssistantModalProps {
  expertId: string;
  initialPrompt: string;
  onClose: () => void;
  onUpdate: (newPrompt: string) => void;
}

const SUGGESTIONS = [
  "Make responses shorter and more concise",
  "Use a highly professional tone",
  "Use bullet points for lists",
  "Do not mention you are an AI",
  "Only answer from the provided knowledge base"
];

export function EditAssistantModal({ expertId, initialPrompt, onClose, onUpdate }: EditAssistantModalProps) {
  const [prompt, setPrompt] = useState(initialPrompt);
  const [saving, setSaving] = useState(false);

  const addSuggestion = (text: string) => {
    setPrompt(prev => prev ? `${prev}\n- ${text}` : `- ${text}`);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await apiClient.patch<{ ok: boolean; expert?: any; error?: string }>(
        `/api/experts/${expertId}`,
        { systemPrompt: prompt }
      );
      if (res.ok) {
        toast.success("Assistant instructions updated!");
        onUpdate(prompt);
        onClose();
      } else {
        toast.error(res.error || "Failed to update assistant");
      }
    } catch (e) {
      toast.error("Network error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.header}>
          <div className={styles.titleGroup}>
            <div className={styles.iconWrap}>
              <Settings2 size={20} />
            </div>
            <div>
              <div className={styles.title}>Edit Assistant Rules</div>
              <div className={styles.subtitle}>Fine-tune how this assistant behaves</div>
            </div>
          </div>
          <button className={styles.closeBtn} onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className={styles.body}>
          <div className={styles.sectionTitle}>Quick Suggestions</div>
          <div className={styles.suggestionsList}>
            {SUGGESTIONS.map((sug, i) => (
              <button key={i} className={styles.suggestionBtn} onClick={() => addSuggestion(sug)}>
                <Plus size={14} /> {sug}
              </button>
            ))}
          </div>
          
          <div className={styles.sectionTitle} style={{ marginTop: 24 }}>System Instructions</div>
          <p className={styles.helpText}>Drop your own custom rules or edit the full prompt below:</p>
          <textarea
            className={styles.textarea}
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            rows={10}
            placeholder="e.g. Always answer in French..."
          />
        </div>

        <div className={styles.footer}>
          <button className="btn btn-secondary btn-sm" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save Changes"}
          </button>
        </div>
      </div>
    </div>
  );
}
