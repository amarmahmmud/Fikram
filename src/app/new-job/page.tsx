"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Cpu, Sparkles, ArrowRight, ArrowLeft, Check, Bell, Layers, Zap, BarChart3, ShieldCheck } from "lucide-react";
import styles from "./page.module.css";

const NOTIFY_STORAGE_KEY = "fikram_coming_soon_notify";

export default function NewJobPage() {
  const [notified, setNotified] = useState(false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(NOTIFY_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed["fine-tune"]) setNotified(true);
      }
    } catch {
      // ignore
    }
  }, []);

  function handleNotify() {
    try {
      const stored = localStorage.getItem(NOTIFY_STORAGE_KEY);
      const parsed = stored ? JSON.parse(stored) : {};
      parsed["fine-tune"] = true;
      localStorage.setItem(NOTIFY_STORAGE_KEY, JSON.stringify(parsed));
    } catch {
      // ignore
    }
    setNotified(true);
  }

  return (
    <div className={styles.comingSoonWrapper}>
      {/* Ambient background glow */}
      <div className={styles.glowCyan} />
      <div className={styles.glowPurple} />

      {/* Top navigation */}
      <div className={styles.topNav}>
        <Link href="/models" className={styles.backLink}>
          <ArrowLeft size={16} />
          <span>Back to Model Registry</span>
        </Link>
        <Link href="/dashboard" className="btn btn-ghost btn-sm">
          Dashboard
        </Link>
      </div>

      <div className={styles.contentContainer}>
        {/* Main Hero Card */}
        <div className={styles.heroCard}>
          <div className={styles.iconContainer}>
            <div className={styles.iconPulseRing} />
            <div className={styles.iconCenter}>
              <Cpu size={32} />
            </div>
          </div>

          <div className={styles.statusBadge}>
            <span className={styles.pulseDot} />
            Under Active Development
          </div>

          <h1 className={styles.title}>
            Custom Model Training is <span className="text-gradient">Coming Soon</span>
          </h1>

          <p className={styles.subtitle}>
            We are engineering high-throughput GPU training pipelines powered by NVIDIA A10G clusters.
            Soon, you&apos;ll be able to fine-tune open-source foundation models with LoRA and QLoRA on your own datasets.
          </p>

          {/* Highlights Grid */}
          <div className={styles.highlightsGrid}>
            <div className={styles.highlightCard}>
              <div className={styles.highlightIcon}>
                <Cpu size={20} />
              </div>
              <div className={styles.highlightContent}>
                <h4>LoRA & QLoRA Tuning</h4>
                <p>Train lightweight adapter weights that capture your exact style without high compute overhead.</p>
              </div>
            </div>

            <div className={styles.highlightCard}>
              <div className={styles.highlightIcon}>
                <Zap size={20} />
              </div>
              <div className={styles.highlightContent}>
                <h4>500+ Base LLMs</h4>
                <p>Select directly from HuggingFace or our curated verified models (Llama 3, Mistral, Qwen).</p>
              </div>
            </div>

            <div className={styles.highlightCard}>
              <div className={styles.highlightIcon}>
                <BarChart3 size={20} />
              </div>
              <div className={styles.highlightContent}>
                <h4>Live Telemetry</h4>
                <p>Real-time training loss graphs, perplexity metrics, and epoch checkpoints in your browser.</p>
              </div>
            </div>

            <div className={styles.highlightCard}>
              <div className={styles.highlightIcon}>
                <ShieldCheck size={20} />
              </div>
              <div className={styles.highlightContent}>
                <h4>Private Weights</h4>
                <p>Your trained model weights are encrypted, isolated to your account, and instantly exportable.</p>
              </div>
            </div>
          </div>

          {/* Notification Action */}
          <div className={styles.actionRow}>
            <button
              type="button"
              className={`btn btn-secondary ${styles.notifyButton} ${notified ? styles.notifyButtonDone : ""}`}
              onClick={notified ? undefined : handleNotify}
            >
              {notified ? (
                <>
                  <Check size={16} className={styles.checkIcon} />
                  <span>You&apos;ll be notified on launch</span>
                </>
              ) : (
                <>
                  <Bell size={16} />
                  <span>Notify Me When Ready</span>
                </>
              )}
            </button>
          </div>

          {/* Callout: Live Alternative */}
          <div className={styles.liveAlternativeCallout}>
            <div className={styles.calloutText}>
              <div className={styles.calloutHeader}>
                <Sparkles size={16} className={styles.sparkleIcon} />
                <strong>Ready Today: RAG AI Experts</strong>
              </div>
              <p>
                Don&apos;t wait for training. You can turn your documents, PDFs, audio, and videos into an interactive,
                citation-backed AI expert in 30 seconds.
              </p>
            </div>
            <Link href="/experts/new" className="btn btn-primary">
              <span>Create RAG AI Expert</span>
              <ArrowRight size={15} />
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
