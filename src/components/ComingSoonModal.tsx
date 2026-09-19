"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
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
  const [mounted, setMounted] = useState(false);
  const [exiting, setExiting] = useState(false);
  const [notified, setNotified] = useState(false);
  const isClosingRef = useRef(false);
  const pushedHistoryRef = useRef(false);

  const config = FEATURE_CONFIGS[feature] ?? FEATURE_CONFIGS["fine-tune"];

  // Mount check for createPortal hydration safety
  useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, []);

  // Check if already subscribed to notifications
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

  // Unified close handler with smooth exit animation
  const handleClose = useCallback(
    (e?: React.MouseEvent | KeyboardEvent) => {
      if (e) {
        e.stopPropagation();
        if ("preventDefault" in e) e.preventDefault();
      }
      if (isClosingRef.current) return;
      isClosingRef.current = true;
      setExiting(true);

      setTimeout(() => {
        onClose();
      }, 180);
    },
    [onClose]
  );

  // Browser Back button integration (popstate)
  useEffect(() => {
    // Push a state into browser history so pressing "Back" cleanly closes the modal
    if (!pushedHistoryRef.current) {
      window.history.pushState({ modalOpen: true }, "");
      pushedHistoryRef.current = true;
    }

    const handlePopState = () => {
      // User clicked browser Back button
      if (!isClosingRef.current) {
        isClosingRef.current = true;
        setExiting(true);
        setTimeout(() => {
          onClose();
        }, 180);
      }
    };

    window.addEventListener("popstate", handlePopState);

    return () => {
      window.removeEventListener("popstate", handlePopState);
      // If modal unmounted via close button/overlay and history state is still ours, pop it
      if (pushedHistoryRef.current && window.history.state?.modalOpen) {
        window.history.back();
      }
    };
  }, [onClose]);

  // Close on Escape key
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        handleClose(e);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleClose]);

  // Lock body scroll with scrollbar compensation to prevent layout shift
  useEffect(() => {
    const originalOverflow = document.body.style.overflow;
    const originalPaddingRight = document.body.style.paddingRight;
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;

    if (scrollbarWidth > 0) {
      document.body.style.paddingRight = `${scrollbarWidth}px`;
    }
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = originalOverflow;
      document.body.style.paddingRight = originalPaddingRight;
    };
  }, []);

  function handleNotify(e: React.MouseEvent) {
    e.stopPropagation();
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

  if (!mounted) return null;

  const modalContent = (
    <div
      className={`${styles.overlay} ${exiting ? styles.overlayExiting : ""}`}
      onClick={(e) => {
        // Only close when clicking directly on the backdrop, not children
        if (e.target === e.currentTarget) {
          handleClose(e);
        }
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) {
          e.stopPropagation();
        }
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="coming-soon-title"
    >
      <div
        className={styles.modal}
        onClick={(e) => {
          e.stopPropagation();
        }}
        onMouseDown={(e) => {
          e.stopPropagation();
        }}
      >
        {/* Close button with large accessible hit target */}
        <button
          className={styles.closeBtn}
          onClick={(e) => handleClose(e)}
          aria-label="Close modal"
          type="button"
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
          type="button"
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
        <button
          type="button"
          className={styles.dismissBtn}
          onClick={(e) => handleClose(e)}
        >
          Got it
        </button>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}
