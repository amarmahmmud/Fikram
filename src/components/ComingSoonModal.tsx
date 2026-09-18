"use client";

import { useState, useEffect, useCallback } from "react";
import { Cpu, Zap, BarChart3, Bell, Check, X } from "lucide-react";
import styles from "./ComingSoonModal.module.css";

/* ─── Feature Presets ─── */
export type ComingSoonFeature =
  | "fine-tune"
  | "retrain"
  | "use-base"
  | "custom-model";

interface FeatureConfig {
  title: string;
  description: string;
  highlights: { icon: React.ReactNode; text: string }[];
}

const FEATURE_CONFIGS: Record<ComingSoonFeature, FeatureConfig> = {
  "fine-tune": {
    title: "Custom Fine-Tuning is Coming Soon",
    description:
      "We're building GPU-powered LoRA fine-tuning so you can train models that truly sound like you. Be the first to know when it launches.",
    highlights: [
      { icon: <Cpu size={14} />, text: "LoRA & QLoRA on NVIDIA A10G clusters" },
      { icon: <Zap size={14} />, text: "Train in minutes, not hours" },
      { icon: <BarChart3 size={14} />, text: "Live training metrics dashboard" },
    ],
  },
  retrain: {
    title: "Model Retraining is Coming Soon",
    description:
      "Soon you'll be able to retrain and iterate on your custom models with new data and improved parameters.",
    highlights: [
      { icon: <Cpu size={14} />, text: "Iterate with updated datasets" },
      { icon: <Zap size={14} />, text: "Automatic hyperparameter tuning" },
      { icon: <BarChart3 size={14} />, text: "Side-by-side model comparison" },
    ],
  },
  "use-base": {
    title: "Base Model Training is Coming Soon",
    description:
      "We're working on letting you fine-tune any open-source base model from HuggingFace directly on our platform.",
    highlights: [
      { icon: <Cpu size={14} />, text: "500+ HuggingFace models supported" },
      { icon: <Zap size={14} />, text: "One-click fine-tuning setup" },
      { icon: <BarChart3 size={14} />, text: "Automatic model optimization" },
    ],
  },
  "custom-model": {
    title: "Custom AI Models are Coming Soon",
    description:
      "Train models that capture your unique voice and expertise. This premium feature is under active development.",
    highlights: [
      { icon: <Cpu size={14} />, text: "Learn your unique tone and style" },
      { icon: <Zap size={14} />, text: "GPU-accelerated training pipeline" },
      { icon: <BarChart3 size={14} />, text: "Publish & share with the community" },
    ],
  },
};

const NOTIFY_STORAGE_KEY = "fikram_coming_soon_notify";

/* ─── Modal Component ─── */
export default function ComingSoonModal({
  feature,
  onClose,
}: {
  feature: ComingSoonFeature;
  onClose: () => void;
}) {
  const [exiting, setExiting] = useState(false);
  const [notified, setNotified] = useState(false);

  const config = FEATURE_CONFIGS[feature];

  // Check if already subscribed
  useEffect(() => {
    try {
      const stored = localStorage.getItem(NOTIFY_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed[feature]) setNotified(true);
      }
    } catch {
      // ignore
    }
  }, [feature]);

  const handleClose = useCallback(() => {
    setExiting(true);
    setTimeout(onClose, 220);
  }, [onClose]);

  // Close on Escape
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") handleClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [handleClose]);

  // Lock body scroll
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  function handleNotify() {
    try {
      const stored = localStorage.getItem(NOTIFY_STORAGE_KEY);
      const parsed = stored ? JSON.parse(stored) : {};
      parsed[feature] = true;
      localStorage.setItem(NOTIFY_STORAGE_KEY, JSON.stringify(parsed));
    } catch {
      // ignore
    }
    setNotified(true);
  }

  return (
    <div
      className={`${styles.overlay} ${exiting ? styles.overlayExiting : ""}`}
      onClick={handleClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="coming-soon-title"
    >
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        {/* Close button */}
        <button
          className={styles.closeBtn}
          onClick={handleClose}
          aria-label="Close"
        >
          <X size={16} />
        </button>

        {/* Animated Icon */}
        <div className={styles.iconWrap}>
          <div className={styles.iconInner}>
            <Cpu size={28} />
          </div>
        </div>

        {/* Badge */}
        <div className={styles.badge}>
          <span className={styles.badgeDot} />
          Under Development
        </div>

        {/* Content */}
        <h3 className={styles.title} id="coming-soon-title">
          {config.title}
        </h3>
        <p className={styles.description}>{config.description}</p>

        {/* Feature highlights */}
        <ul className={styles.featureList}>
          {config.highlights.map((h, i) => (
            <li key={i} className={styles.featureItem}>
              <span className={styles.featureIcon}>{h.icon}</span>
              <span>{h.text}</span>
            </li>
          ))}
        </ul>

        {/* Actions */}
        <button
          className={`${styles.notifyBtn} ${notified ? styles.notifyBtnSubscribed : ""}`}
          onClick={notified ? undefined : handleNotify}
        >
          {notified ? (
            <>
              <Check size={16} />
              You&apos;ll be notified
            </>
          ) : (
            <>
              <Bell size={16} />
              Notify Me When It&apos;s Ready
            </>
          )}
        </button>
        <button className={styles.dismissBtn} onClick={handleClose}>
          Got it
        </button>
      </div>
    </div>
  );
}
