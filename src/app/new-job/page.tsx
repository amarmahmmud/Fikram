"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Cpu, Sparkles, ArrowRight, ArrowLeft, Check, Bell, Layers, Zap, BarChart3, ShieldCheck, Globe } from "lucide-react";
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
            Soon, you&apos;ll be able to fine-tune foundation models on your own datasets to capture your unique voice and domain expertise.
          </p>

          {/* Highlights Grid */}
          <div className={styles.highlightsGrid}>
            <div className={styles.highlightCard}>
              <div className={styles.highlightIcon}>
                <Cpu size={20} />
              </div>
              <div className={styles.highlightContent}>
                <h4>Efficient Fine-Tuning</h4>
                <p>Adapt models to your voice without heavy infrastructure or compute overhead.</p>
              </div>
            </div>

            <div className={styles.highlightCard}>
              <div className={styles.highlightIcon}>
                <Zap size={20} />
              </div>
              <div className={styles.highlightContent}>
                <h4>Top Open-Source LLMs</h4>
                <p>Choose from leading foundation models like Llama 3, Mistral, and Qwen.</p>
              </div>
            </div>

            <div className={styles.highlightCard}>
              <div className={styles.highlightIcon}>
                <BarChart3 size={20} />
              </div>
              <div className={styles.highlightContent}>
                <h4>Real-Time Progress</h4>
                <p>Track training loss, metrics, and checkpoints live in your browser.</p>
              </div>
            </div>

            <div className={styles.highlightCard}>
              <div className={styles.highlightIcon}>
                <ShieldCheck size={20} />
              </div>
              <div className={styles.highlightContent}>
                <h4>Private & Secure</h4>
                <p>Your data and trained weights remain encrypted and isolated to your account.</p>
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
                Upload your files and get an accurate, citation-backed AI expert in seconds.
              </p>
            </div>
            <div className={styles.calloutActions}>
              <Link href="/experts/new" className="btn btn-primary">
                <Sparkles size={15} />
                <span>Create RAG AI Expert</span>
                <ArrowRight size={15} />
              </Link>
              <Link href="/browse" className="btn btn-secondary">
                <Globe size={15} />
                <span>Browse Models</span>
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
