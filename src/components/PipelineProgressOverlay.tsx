"use client";

import { useState, useEffect, useRef } from "react";
import styles from "./PipelineProgressOverlay.module.css";
import { AudioLines, Cpu, CheckCircle2, Sparkles, AlertCircle } from "lucide-react";

/* ── Types ── */
export interface PipelineEvent {
  type: "progress" | "complete" | "error";
  stage?: "chunking" | "generating" | "validating" | "deduplicating" | "complete" | "segmenting" | "transcribing";
  message?: string;
  chunksTotal?: number;
  chunksProcessed?: number;
  pairsGenerated?: number;
  segmentsTotal?: number;
  segmentsProcessed?: number;
  clipsGenerated?: number;
  // Complete event fields
  ok?: boolean;
  jsonl?: string;
  evalJsonl?: string;
  stats?: Record<string, unknown>;
  systemPrompt?: string;
  pairs?: unknown[];
  trainPairs?: unknown[];
  evalPairs?: unknown[];
  // Error event fields
  error?: string;
}

export interface PipelineProgressOverlayProps {
  visible?: boolean;
  event?: PipelineEvent | null;
  latestEvent?: PipelineEvent | null;
  onComplete?: (data: any) => void;
  onError?: (error: string) => void;
  onClose?: () => void;
}

/* ── Pipeline stages (friendly names) ── */
const STAGES = [
  {
    id: "chunking",
    label: "Segmenting Audio",
    friendlyDesc: "Running VAD segmentation to split audio into Noorani Qaida letter/syllable clips",
    icon: AudioLines,
  },
  {
    id: "generating",
    label: "Bootstrap Transcription",
    friendlyDesc: "Generating initial phonetic and sifat alignments for each audio clip",
    icon: Cpu,
  },
  {
    id: "validating",
    label: "Quality & Dedup",
    friendlyDesc: "Checking duration, clipping, and removing near-duplicate phonetic patterns",
    icon: CheckCircle2,
  },
  {
    id: "complete",
    label: "Complete",
    friendlyDesc: "Your ASR training dataset is ready!",
    icon: Sparkles,
  },
] as const;

type StageId = (typeof STAGES)[number]["id"];

function getStageIndex(stage?: string): number {
  if (!stage) return 0;
  if (stage === "segmenting" || stage === "chunking") return 0;
  if (stage === "transcribing" || stage === "generating") return 1;
  if (stage === "validating" || stage === "deduplicating") return 2;
  if (stage === "complete") return 3;
  return 0;
}

/* ── Component ── */
export default function PipelineProgressOverlay({
  visible = true,
  onComplete,
  onError,
  latestEvent,
  event,
  onClose,
}: PipelineProgressOverlayProps) {
  const activeEvent = latestEvent || event;
  const [showDetails, setShowDetails] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [pairsCount, setPairsCount] = useState(0);
  const [displayPairs, setDisplayPairs] = useState(0);
  const startTimeRef = useRef<number>(Date.now());
  const logEndRef = useRef<HTMLDivElement>(null);
  const hasCompletedRef = useRef(false);

  // Reset on visibility change
  useEffect(() => {
    if (visible) {
      startTimeRef.current = Date.now();
      setElapsedMs(0);
      setLogs([]);
      setPairsCount(0);
      setDisplayPairs(0);
      setShowDetails(false);
      hasCompletedRef.current = false;
    }
  }, [visible]);

  // Elapsed timer
  useEffect(() => {
    if (!visible || hasCompletedRef.current) return;
    const interval = setInterval(() => {
      setElapsedMs(Date.now() - startTimeRef.current);
    }, 1000);
    return () => clearInterval(interval);
  }, [visible]);

  // Process incoming events
  useEffect(() => {
    if (!activeEvent || !visible) return;

    if (activeEvent.type === "progress") {
      if (activeEvent.pairsGenerated !== undefined) {
        setPairsCount(activeEvent.pairsGenerated);
      } else if (activeEvent.clipsGenerated !== undefined) {
        setPairsCount(activeEvent.clipsGenerated);
      }
      if (activeEvent.message) {
        setLogs((prev) => {
          // Avoid duplicate consecutive messages
          if (prev.length > 0 && prev[prev.length - 1] === activeEvent.message) return prev;
          return [...prev, activeEvent.message!];
        });
      }
    } else if (activeEvent.type === "complete" && !hasCompletedRef.current) {
      hasCompletedRef.current = true;
      if (activeEvent.pairsGenerated !== undefined) {
        setPairsCount(activeEvent.pairsGenerated);
      } else if (activeEvent.clipsGenerated !== undefined) {
        setPairsCount(activeEvent.clipsGenerated);
      }
      // Small delay so user sees the "Complete" stage
      setTimeout(() => {
        onComplete?.({
          jsonl: activeEvent.jsonl || "",
          evalJsonl: activeEvent.evalJsonl || "",
          stats: activeEvent.stats || {},
          systemPrompt: activeEvent.systemPrompt || "",
        });
      }, 1500);
    } else if (activeEvent.type === "error") {
      hasCompletedRef.current = true;
      onError?.(activeEvent.error || "An unknown error occurred");
    }
  }, [activeEvent, visible, onComplete, onError]);

  // Smooth number animation for pairs counter
  useEffect(() => {
    if (displayPairs === pairsCount) return;
    const diff = pairsCount - displayPairs;
    const step = Math.max(1, Math.ceil(diff / 10));
    const timer = setTimeout(() => {
      setDisplayPairs((prev) => Math.min(prev + step, pairsCount));
    }, 40);
    return () => clearTimeout(timer);
  }, [displayPairs, pairsCount]);

  // Auto-scroll logs
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  if (!visible) return null;

  const currentStageIdx = getStageIndex(activeEvent?.stage);
  const chunksTotal = activeEvent?.chunksTotal || activeEvent?.segmentsTotal || 0;
  const chunksProcessed = activeEvent?.chunksProcessed || activeEvent?.segmentsProcessed || 0;
  const progressPercent = chunksTotal > 0 ? Math.round((chunksProcessed / chunksTotal) * 100) : 0;
  const isComplete = activeEvent?.stage === "complete" || activeEvent?.type === "complete";
  const isError = activeEvent?.type === "error";

  // ETA calculation
  const elapsedSec = Math.floor(elapsedMs / 1000);
  let etaStr = "";
  if (chunksProcessed > 0 && chunksTotal > 0 && !isComplete && !isError) {
    const avgPerChunk = elapsedMs / chunksProcessed;
    const remaining = (chunksTotal - chunksProcessed) * avgPerChunk;
    const remainingSec = Math.ceil(remaining / 1000);
    if (remainingSec > 60) {
      etaStr = `~${Math.ceil(remainingSec / 60)}m remaining`;
    } else {
      etaStr = `~${remainingSec}s remaining`;
    }
  }

  const formatElapsed = (ms: number) => {
    const totalSec = Math.floor(ms / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return m > 0 ? `${m}m ${s.toString().padStart(2, "0")}s` : `${s}s`;
  };

  return (
    <div className={styles.overlay} role="dialog" aria-label="Dataset generation progress">
      <div className={styles.modal}>
        {/* Header */}
        <div className={styles.header}>
          <div className={styles.headerIcon}>
            {isError ? <AlertCircle size={28} /> : isComplete ? <Sparkles size={28} /> : <Cpu size={28} />}
          </div>
          <h2 className={styles.headerTitle}>
            {isError
              ? "Generation Failed"
              : isComplete
              ? "Dataset Ready!"
              : "Building Your Training Dataset"}
          </h2>
          <p className={styles.headerDesc}>
            {isError
              ? latestEvent?.error
              : isComplete
              ? "Your AI-generated training data is ready to use"
              : "Our AI is reading your document and creating high-quality training pairs"}
          </p>
        </div>

        {/* Stage stepper */}
        {!isError && (
          <div className={styles.stepper}>
            {STAGES.map((stage, idx) => {
              const isDone = idx < currentStageIdx || isComplete;
              const isActive = idx === currentStageIdx && !isComplete;
              return (
                <div
                  key={stage.id}
                  className={`${styles.step} ${isDone ? styles.stepDone : ""} ${
                    isActive ? styles.stepActive : ""
                  }`}
                >
                  <div className={styles.stepIcon}>
                    {isDone ? (
                      <CheckCircle2 size={16} />
                    ) : (
                      <stage.icon size={16} />
                    )}
                  </div>
                  <span className={styles.stepLabel}>{stage.label}</span>
                  {idx < STAGES.length - 1 && (
                    <div className={`${styles.stepConnector} ${isDone ? styles.stepConnectorDone : ""}`} />
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Progress bar + stats */}
        {!isError && !isComplete && (
          <div className={styles.progressSection}>
            <div className={styles.progressBar}>
              <div
                className={styles.progressFill}
                style={{ width: `${Math.max(progressPercent, 3)}%` }}
              />
            </div>
            <div className={styles.statsRow}>
              <div className={styles.stat}>
                <span className={styles.statValue}>
                  {chunksProcessed}/{chunksTotal || "—"}
                </span>
                <span className={styles.statLabel}>sections processed</span>
              </div>
              <div className={styles.stat}>
                <span className={`${styles.statValue} ${styles.pairsCounter}`}>
                  {displayPairs}
                </span>
                <span className={styles.statLabel}>training pairs created</span>
              </div>
              <div className={styles.stat}>
                <span className={styles.statValue}>{formatElapsed(elapsedMs)}</span>
                <span className={styles.statLabel}>elapsed</span>
              </div>
              {etaStr && (
                <div className={styles.stat}>
                  <span className={`${styles.statValue} ${styles.etaValue}`}>{etaStr}</span>
                  <span className={styles.statLabel}>estimated</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Completed stats */}
        {isComplete && (
          <div className={styles.completeStats}>
            <div className={styles.completeStat}>
              <span className={styles.completeStatValue}>{displayPairs}</span>
              <span className={styles.completeStatLabel}>training pairs</span>
            </div>
            <div className={styles.completeStat}>
              <span className={styles.completeStatValue}>{chunksTotal}</span>
              <span className={styles.completeStatLabel}>sections analyzed</span>
            </div>
            <div className={styles.completeStat}>
              <span className={styles.completeStatValue}>{formatElapsed(elapsedMs)}</span>
              <span className={styles.completeStatLabel}>total time</span>
            </div>
          </div>
        )}

        {/* What's happening explainer */}
        {!isError && !isComplete && currentStageIdx < STAGES.length && (
          <div className={styles.explainer} aria-live="polite">
            <span className={styles.explainerDot} />
            <span>{STAGES[currentStageIdx].friendlyDesc}</span>
          </div>
        )}

        {/* Show Details toggle */}
        {!isError && logs.length > 0 && (
          <div className={styles.detailsSection}>
            <button
              className={styles.detailsToggle}
              onClick={() => setShowDetails(!showDetails)}
              aria-expanded={showDetails}
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 12 12"
                className={`${styles.chevron} ${showDetails ? styles.chevronOpen : ""}`}
              >
                <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
              </svg>
              {showDetails ? "Hide Technical Details" : "Show Technical Details"}
            </button>

            {showDetails && (
              <div className={styles.terminal}>
                <div className={styles.terminalHeader}>
                  <div className={styles.terminalDot} style={{ background: "#ff5f56" }} />
                  <div className={styles.terminalDot} style={{ background: "#ffbd2e" }} />
                  <div className={styles.terminalDot} style={{ background: "#27c93f" }} />
                  <span className={styles.terminalTitle}>pipeline_events.log</span>
                </div>
                <div className={styles.terminalBody}>
                  {logs.map((log, i) => (
                    <div key={i} className={styles.terminalLine}>
                      <span className={styles.terminalTimestamp}>
                        [{String(Math.floor(i * (elapsedSec / Math.max(logs.length, 1)))).padStart(3, " ")}s]
                      </span>
                      {log}
                    </div>
                  ))}
                  {!isComplete && (
                    <div className={`${styles.terminalLine} ${styles.terminalPulse}`}>
                      <span className={styles.terminalCursor}>▊</span>
                    </div>
                  )}
                  <div ref={logEndRef} />
                </div>
              </div>
            )}
          </div>
        )}

        {/* Error retry */}
        {isError && (
          <div className={styles.errorActions}>
            <p className={styles.errorHint}>
              This can happen due to temporary API limits or an incompatible document format.
              You can try again or use a different file.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
