"use client";

import Link from "next/link";
import { useState, useEffect, use, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import styles from "./page.module.css";
import type { Database } from "@/lib/supabase/types";
import { PublishModal } from "@/components/PublishModal";
import { apiClient } from "@/lib/apiClient";
import { Globe, RotateCcw, Sparkles, Server, Package, Cpu, BarChart3, CheckCircle2, AlertTriangle, Info } from "lucide-react";
import ComingSoonButton from "@/components/ComingSoonButton";
import { ASREvalReport, formatPER, perToGrade } from "@/lib/evaluator";
import { TAJWEED_RULE_LABELS, TajweedRule } from "@/lib/qps-types";

type Job = Database["public"]["Tables"]["jobs"]["Row"];

export default function JobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);
  const supabase = createClient();

  const [job, setJob] = useState<Job | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [publishModalOpen, setPublishModalOpen] = useState(false);
  const [liveElapsed, setLiveElapsed] = useState(0);
  const [showTechDetails, setShowTechDetails] = useState(false);

  const fetchJob = useCallback(async () => {
    try {
      const data = await apiClient.get<any>(`/api/jobs/sync?id=${resolvedParams.id}`);
      if (data.ok && data.job) {
        setJob(data.job);
      } else {
        const { data: dbData, error: dbError } = await supabase
          .from("jobs")
          .select("*")
          .eq("id", resolvedParams.id)
          .single();

        if (dbError) throw dbError;
        setJob(dbData);
      }
    } catch (err: any) {
      console.error("Error fetching job:", err);
      setError(err.message || "Failed to load job");
    } finally {
      setLoading(false);
    }
  }, [resolvedParams.id, supabase]);

  useEffect(() => {
    fetchJob();
  }, [fetchJob]);

  // Real-time polling while job is pending or running
  useEffect(() => {
    if (!job || (job.status !== "pending" && job.status !== "running")) return;

    const interval = setInterval(() => {
      fetchJob();
    }, 4000);

    return () => clearInterval(interval);
  }, [job, fetchJob]);

  // Live elapsed timer — ticks every second while running/pending
  useEffect(() => {
    if (!job?.started_at || job.status === "completed" || job.status === "failed" || job.status === "cancelled") return;
    const start = new Date(job.started_at).getTime();
    const tick = () => setLiveElapsed(Math.max(0, Math.floor((Date.now() - start) / 1000)));
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [job?.started_at, job?.status]);

  async function handleMarkFailed() {
    if (!job) return;
    if (!confirm("Are you sure you want to mark this job as failed?")) return;
    setActionLoading(true);
    try {
      const data = await apiClient.post<any>("/api/jobs/sync", { jobId: job.id, action: "fail" });
      if (data.ok && data.job) {
        setJob(data.job);
      }
    } catch (err) {
      console.error("Failed to mark job as failed:", err);
    } finally {
      setActionLoading(false);
    }
  }

  if (loading) {
    return (
      <>
        <div className="topbar">
          <Link href="/jobs" className="btn btn-ghost btn-sm">← Jobs</Link>
          <span className="topbar-title">Loading Job...</span>
        </div>
        <div className="page-content" style={{ textAlign: "center", padding: "100px 0" }}>
          <div className="spinner" style={{ margin: "0 auto 16px" }} />
          <p style={{ color: "var(--text-muted)" }}>Fetching job details from database...</p>
        </div>
      </>
    );
  }

  if (error || !job) {
    return (
      <>
        <div className="topbar">
          <Link href="/jobs" className="btn btn-ghost btn-sm">← Jobs</Link>
          <span className="topbar-title">Job Not Found</span>
        </div>
        <div className="page-content" style={{ textAlign: "center", padding: "100px 0" }}>
          <div style={{ fontSize: "1.5rem", marginBottom: 16, color: "var(--text-muted)" }}>◇</div>
          <h3>Job Not Found</h3>
          <p style={{ color: "var(--text-muted)", marginBottom: 24 }}>{error || "Could not find this job."}</p>
          <Link href="/jobs" className="btn btn-primary btn-sm">Return to Jobs List</Link>
        </div>
      </>
    );
  }

  const isCompleted = job.status === "completed";
  const isRunning   = job.status === "running";
  const isPending   = job.status === "pending";
  const isFailed    = job.status === "failed" || job.status === "cancelled";

  const config = (job.config || {}) as Record<string, any>;
  const epochs = config.epochs ?? 3; // Typically higher for ASR
  const lr = config.learningRate ?? 0.0003;
  const batchSize = config.batchSize ?? 8;
  const datasetFileName = job.dataset_url ? job.dataset_url.split("/").pop()?.split("?")[0] : "Uploaded Audio Dataset";
  const estimatedTrainingSec = config.estimated_training_seconds ?? (config.estimatedTime ? parseInt(config.estimatedTime) * 60 : 1200);

  // Calculate elapsed or total duration
  const getElapsedSec = () => {
    if (!job.started_at) return 0;
    const start = new Date(job.started_at).getTime();
    const end = job.finished_at || job.completed_at
      ? new Date(job.finished_at || job.completed_at || "").getTime()
      : Date.now();
    return Math.max(0, Math.floor((end - start) / 1000));
  };

  const elapsedSec = isRunning ? liveElapsed : getElapsedSec();
  const mins = Math.floor(elapsedSec / 60);
  const secs = elapsedSec % 60;
  const durationStr = mins > 0 ? `${mins}m ${secs.toString().padStart(2, "0")}s` : `${secs}s`;

  // Progress calculation
  const progressPercent = isCompleted
    ? 100
    : isFailed
    ? 100
    : isPending
    ? 5
    : Math.min(95, Math.round((elapsedSec / estimatedTrainingSec) * 100));

  // ETA calculation
  const etaSec = isRunning && estimatedTrainingSec > 0
    ? Math.max(0, estimatedTrainingSec - elapsedSec)
    : 0;
  const etaStr = etaSec > 60
    ? `~${Math.ceil(etaSec / 60)}m remaining`
    : etaSec > 0
    ? `~${etaSec}s remaining`
    : "";

  // Training phases
  const phases = [
    {
      id: "queued",
      label: "Job Queued",
      friendlyLabel: "Waiting in line",
      techDetail: `Job ${job.id.substring(0, 8)} submitted to Modal GPU cluster`,
      status: isPending ? "active" : "done",
      icon: "⏳",
    },
    {
      id: "gpu",
      label: "GPU Allocated",
      friendlyLabel: "GPU reserved for your model",
      techDetail: "NVIDIA A10G or L4 provisioned",
      status: isPending ? "pending" : "done",
      icon: Server,
    },
    {
      id: "loading",
      label: "Loading Model",
      friendlyLabel: "Setting up the ASR model",
      techDetail: `Loading ${job.base_model} CTC checkpoint with adapter`,
      status: isPending ? "pending" : (isRunning && elapsedSec < 45) ? "active" : isRunning || isCompleted ? "done" : "pending",
      icon: Package,
    },
    {
      id: "training",
      label: "Training",
      friendlyLabel: "Training on audio pairs",
      techDetail: `${epochs} epochs × batch ${batchSize} | LR: ${lr} | CTC Loss`,
      status: isRunning && elapsedSec >= 45 ? "active" : isCompleted ? "done" : "pending",
      icon: Cpu,
    },
    {
      id: "evaluating",
      label: "Evaluating",
      friendlyLabel: "Testing accuracy (PER/CER)",
      techDetail: `Computing Phoneme Error Rate on held-out eval pairs`,
      status: isCompleted
        ? (config.eval_status === "completed" ? "done"
          : config.eval_status === "running" ? "active"
          : config.eval_status === "unavailable" ? "done"
          : config.eval_dataset_url ? "active" : "done")
        : "pending",
      icon: BarChart3,
    },
    {
      id: "complete",
      label: "Complete",
      friendlyLabel: "Your ASR model is ready!",
      techDetail: `Finished in ${durationStr}. Checkpoint available at ${job.result_url}`,
      status: isCompleted ? "done" : isFailed ? "failed" : "pending",
      icon: CheckCircle2,
    },
  ];

  const activePhase = phases.find(p => p.status === "active");
  const explainerText = isFailed
    ? "Something went wrong during training. You can retry with the same dataset."
    : isCompleted
    ? "Training is complete! Review the evaluation metrics below."
    : isPending
    ? "Your job is in the queue. It will start automatically once a GPU becomes available."
    : activePhase?.id === "loading"
    ? `We're loading ${job.base_model} onto the GPU and configuring the CTC adapter.`
    : activePhase?.id === "training"
    ? `Your model is learning to align audio with phonemes. Running ${epochs} epoch${epochs > 1 ? "s" : ""}.`
    : "Processing your ASR training job...";

  return (
    <>
      <div className="topbar">
        <Link href="/jobs" className="btn btn-ghost btn-sm">← Jobs</Link>
        <span className="topbar-title" style={{ flex: 1, textAlign: "center" }}>
          {job.name}
        </span>
        <span className={`badge ${isCompleted ? "badge-success" : isRunning ? "badge-warning" : isFailed ? "badge-error" : "badge-default"}`}>
          <span className={`status-dot ${job.status}`} />
          {job.status.toUpperCase()}
        </span>
      </div>

      <div className="page-content">
        {/* Header row */}
        <div className={styles.headerRow}>
          <div>
            <h2 className={styles.jobTitle}>{job.name}</h2>
            <p className={styles.jobMeta}>
              Job <span className="font-mono">#{job.id.substring(0, 8)}</span>
              &nbsp;·&nbsp;Created {new Date(job.created_at).toLocaleString()}
              {(job.finished_at || job.completed_at) && (
                <>&nbsp;·&nbsp;Finished {new Date(job.finished_at || job.completed_at || "").toLocaleString()}</>
              )}
            </p>
          </div>
          <div className={styles.headerActions}>
            {isCompleted && (
              <>
                <Link
                  href={`/playground/${job.id}`}
                  className="btn btn-sm btn-primary"
                  style={{
                    gap: 6,
                    background: "linear-gradient(135deg, rgba(0, 229, 200, 0.9), rgba(16, 185, 129, 0.9))",
                    boxShadow: "0 0 16px rgba(0, 229, 200, 0.35)",
                    color: "#000",
                    fontWeight: 700,
                  }}
                >
                  <Sparkles size={14} />
                  Test in Playground
                </Link>
                <ComingSoonButton
                  feature="retrain"
                  className="btn btn-sm btn-secondary"
                  style={{ gap: 6 }}
                >
                  <RotateCcw size={14} />
                  Retrain
                </ComingSoonButton>
                <button
                  className="btn btn-sm btn-secondary"
                  onClick={() => setPublishModalOpen(true)}
                  style={{ gap: 6 }}
                >
                  <Globe size={16} />
                  {(typeof job.config === "object" && job.config !== null && (job.config as Record<string, unknown>).published) ? "Published (Share)" : "Publish & Share"}
                </button>
              </>
            )}
            {isFailed && job.dataset_url && (
              <ComingSoonButton
                feature="retrain"
                className="btn btn-sm btn-primary"
                style={{ gap: 6 }}
              >
                <RotateCcw size={14} />
                Retry Training
              </ComingSoonButton>
            )}
          </div>
        </div>

        <div className={styles.grid}>
          {/* Left col */}
          <div className={styles.leftCol}>
            {/* Live Status Card */}
            <div className="card">
              <div className={styles.cardHead}>
                <span className={styles.cardTitle}>Training Status</span>
                <span className="font-mono" style={{ fontSize: "0.8125rem", color: isCompleted ? "var(--success)" : isRunning ? "var(--warning)" : isFailed ? "var(--error)" : "var(--text-muted)" }}>
                  {isCompleted ? "Complete" : isRunning ? `${progressPercent}%` : isFailed ? "Failed" : "Queued"}
                </span>
              </div>

              <div className="progress-bar" style={{ marginTop: 12 }}>
                <div 
                  className="progress-fill" 
                  style={{ 
                    width: `${progressPercent}%`,
                    backgroundColor: isFailed ? "var(--error)" : undefined,
                    transition: "width 1s ease" 
                  }} 
                />
              </div>

              <div className={styles.timerRow}>
                <div className={styles.timerItem}>
                  <span className={styles.timerValue}>{durationStr}</span>
                  <span className={styles.timerLabel}>elapsed</span>
                </div>
                {etaStr && (
                  <div className={styles.timerItem}>
                    <span className={`${styles.timerValue} ${styles.timerEta}`}>{etaStr}</span>
                    <span className={styles.timerLabel}>estimated</span>
                  </div>
                )}
                <div className={styles.timerItem}>
                  <span className={styles.timerLabel}>Engine: Modal.com GPU</span>
                </div>
              </div>
            </div>

            {/* Explainer */}
            <div className={styles.explainerCard} aria-live="polite">
              <div className={styles.explainerHeader}>
                <span className={styles.explainerDot} style={{
                  background: isCompleted ? "var(--success)" : isFailed ? "var(--error)" : isRunning ? "var(--warning)" : "var(--text-muted)",
                  animation: isRunning || isPending ? "pulse-dot 2s infinite" : "none",
                }} />
                <span className={styles.explainerTitle}>
                  {isCompleted ? "Training Complete" : isFailed ? "Training Failed" : isPending ? "Waiting to Start" : "Training in Progress"}
                </span>
              </div>
              <p className={styles.explainerText}>{explainerText}</p>
            </div>

            {/* Pipeline Timeline */}
            <div className="card">
              <div className={styles.cardHead} style={{ marginBottom: 16 }}>
                <span className={styles.cardTitle}>Pipeline</span>
                <button
                  className={styles.techToggle}
                  onClick={() => setShowTechDetails(!showTechDetails)}
                >
                  {showTechDetails ? "Simple View" : "Technical Details"}
                </button>
              </div>
              <div className={styles.phaseTimeline}>
                {phases.map((phase, idx) => (
                  <div key={phase.id} className={`${styles.phaseItem} ${styles[`phase_${phase.status}`]}`}>
                    <div className={styles.phaseIconCol}>
                      <div className={styles.phaseIcon}>
                        {phase.status === "done" ? (
                          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                            <path d="M2.5 7.5L5.5 10.5L11.5 3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        ) : phase.status === "failed" ? (
                          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                            <path d="M3.5 3.5L10.5 10.5M10.5 3.5L3.5 10.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                          </svg>
                        ) : (
                          <phase.icon size={13} />
                        )}
                      </div>
                      {idx < phases.length - 1 && (
                        <div className={`${styles.phaseConnector} ${phase.status === "done" ? styles.phaseConnectorDone : ""}`} />
                      )}
                    </div>
                    <div className={styles.phaseContent}>
                      <span className={styles.phaseLabel}>
                        {showTechDetails ? phase.label : phase.friendlyLabel}
                      </span>
                      {showTechDetails && (
                        <span className={styles.phaseTechDetail}>{phase.techDetail}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* ── ASR Evaluation Report ── */}
            {isCompleted && (() => {
              const evalStatus = config.eval_status as string | undefined;
              const evalResult = config.eval_result as ASREvalReport | undefined;
              const evalError = config.eval_error as string | undefined;

              if (!evalStatus && !evalResult) return null;

              if (evalStatus === "running") {
                return (
                  <div className={styles.evalCard}>
                    <div className={styles.evalHeader}>
                      <span className={styles.evalTitle} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                        <BarChart3 size={15} />
                        <span>ASR Evaluation</span>
                      </span>
                    </div>
                    <div className={styles.evalStatusRunning}>
                      <div className={styles.evalSpinner} />
                      <span>Computing PER metrics...</span>
                    </div>
                  </div>
                );
              }

              if (evalResult) {
                const { grade, label, color } = perToGrade(evalResult.per);

                return (
                  <div className={styles.evalCard}>
                    <div className={styles.evalHeader}>
                      <span className={styles.evalTitle} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                        <BarChart3 size={15} />
                        <span>ASR Evaluation Report</span>
                      </span>
                      <span className={styles.evalBadge} style={{ backgroundColor: color, color: '#fff' }}>
                        Grade: {grade} ({label})
                      </span>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8 text-center mt-6">
                      <div className="p-4 bg-gray-50 border rounded">
                        <div className="text-3xl font-bold" style={{ color }}>
                          {formatPER(evalResult.per)}
                        </div>
                        <div className="text-sm text-gray-500 font-medium">Phoneme Error Rate</div>
                      </div>
                      <div className="p-4 bg-gray-50 border rounded">
                        <div className="text-3xl font-bold text-gray-700">
                          {formatPER(evalResult.cer)}
                        </div>
                        <div className="text-sm text-gray-500 font-medium">Char Error Rate</div>
                      </div>
                      <div className="p-4 bg-gray-50 border rounded">
                        <div className="text-3xl font-bold text-emerald-600">
                          {evalResult.exact_match_pct !== undefined ? `${evalResult.exact_match_pct}%` : evalResult.exactMatchPct !== undefined ? `${evalResult.exactMatchPct}%` : "—"}
                        </div>
                        <div className="text-sm text-gray-500 font-medium">Exact Match</div>
                      </div>
                      <div className="p-4 bg-gray-50 border rounded">
                        <div className="text-3xl font-bold text-blue-600">
                          {evalResult.count_match_pct !== undefined ? `${evalResult.count_match_pct}%` : evalResult.countMatchPct !== undefined ? `${evalResult.countMatchPct}%` : "—"}
                        </div>
                        <div className="text-sm text-gray-500 font-medium">Count Match (±1)</div>
                      </div>
                    </div>

                    {/* Diagnostics */}
                    {evalResult.diagnosticGuidance && evalResult.diagnosticGuidance.length > 0 && (
                      <div className="mb-8 p-4 border-l-4 border-l-primary bg-primary/5 rounded-r">
                        <h4 className="font-medium mb-2">Diagnostics</h4>
                        <ul className="space-y-2">
                          {evalResult.diagnosticGuidance.map((diag, i) => (
                            <li key={i} className="text-sm flex gap-2 items-start">
                              {diag.level === "warning" || diag.level === "action" ? (
                                <AlertTriangle size={14} style={{ color: "var(--warning)", flexShrink: 0, marginTop: 3 }} />
                              ) : (
                                <Info size={14} style={{ color: "var(--info)", flexShrink: 0, marginTop: 3 }} />
                              )}
                              <span>{diag.message}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Rule Accuracy */}
                    {evalResult.perTajweedRule && Object.keys(evalResult.perTajweedRule).length > 0 && (
                      <div className="mb-8">
                        <h4 className="font-medium mb-4 text-gray-700 uppercase text-xs tracking-wider">Tajweed Rule Accuracy</h4>
                        <div className="space-y-3">
                          {Object.entries(evalResult.perTajweedRule).map(([rule, acc]) => (
                            <div key={rule} className="flex items-center gap-4 text-sm">
                              <div className="w-1/3">{TAJWEED_RULE_LABELS[rule as TajweedRule] || rule}</div>
                              <div className="w-1/2 bg-gray-200 h-2 rounded-full overflow-hidden">
                                <div 
                                  className="h-full" 
                                  style={{ 
                                    width: `${acc.accuracy * 100}%`,
                                    backgroundColor: acc.accuracy > 0.8 ? '#10b981' : acc.accuracy > 0.6 ? '#f59e0b' : '#ef4444'
                                  }}
                                />
                              </div>
                              <div className="w-1/6 text-right tabular-nums">
                                {Math.round(acc.accuracy * 100)}%
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Confusions */}
                    {evalResult.confusionMatrix && evalResult.confusionMatrix.length > 0 && (
                      <div>
                        <h4 className="font-medium mb-4 text-gray-700 uppercase text-xs tracking-wider">Top Confusions (Expected → Model output)</h4>
                        <div className="flex flex-wrap gap-2">
                          {evalResult.confusionMatrix.slice(0, 10).map((conf, i) => (
                            <div key={i} className="bg-gray-50 border rounded px-3 py-1 text-sm font-mono flex items-center gap-2">
                              <span>{conf.expected}</span>
                              <span className="text-gray-400">→</span>
                              <span className="text-red-500">{conf.got}</span>
                              <span className="text-gray-400 ml-1 text-xs">{conf.count}x</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              }

              return null;
            })()}
          </div>

          {/* Right col */}
          <div className={styles.rightCol}>
            {/* Configuration */}
            <div className="card">
              <span className={styles.cardTitle} style={{ display: "block", marginBottom: 16 }}>Configuration</span>
              {[
                ["Base Model", job.base_model],
                ["Task", "Phonetic ASR / Tajweed"],
                ["Epochs", epochs],
                ["Learning Rate", lr],
                ["Batch Size", batchSize],
                ["Dataset File", datasetFileName],
                ["Duration", durationStr],
              ].map(([label, value]) => (
                <div key={String(label)} className={styles.configRow}>
                  <span className={styles.configLabel}>{label}</span>
                  <span className={styles.configValue} style={{ maxWidth: "200px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {String(value)}
                  </span>
                </div>
              ))}
            </div>

            {/* Actions */}
            <div className="card">
              <span className={styles.cardTitle} style={{ display: "block", marginBottom: 16 }}>Actions</span>
              <div className={styles.actionsList}>
                {isCompleted && (
                  <Link
                    href={`/playground/${job.id}`}
                    className="btn btn-primary w-full"
                    style={{
                      textAlign: "center",
                      gap: 6,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      background: "linear-gradient(135deg, rgba(0, 229, 200, 0.9), rgba(16, 185, 129, 0.9))",
                      boxShadow: "0 0 16px rgba(0, 229, 200, 0.35)",
                      color: "#000",
                      fontWeight: 700,
                      marginBottom: 4,
                    }}
                  >
                    <Sparkles size={15} />
                    Launch Test Playground
                  </Link>
                )}
                {(isCompleted || (isFailed && job.dataset_url)) && (
                  <ComingSoonButton
                    feature="retrain"
                    className="btn btn-secondary w-full"
                    style={{ textAlign: "center", gap: 6, display: "flex", alignItems: "center", justifyContent: "center" }}
                  >
                    <RotateCcw size={14} />
                    {isFailed ? "Retry with Same Dataset" : "Retrain with New Parameters"}
                  </ComingSoonButton>
                )}

                {job.result_url && (
                  <div className={styles.configRow} style={{ padding: "8px 0", fontSize: "0.75rem", color: "var(--text-muted)", flexDirection: "column", alignItems: "flex-start", gap: 4 }}>
                    <span>Model Checkpoint (HuggingFace):</span>
                    <span className="font-mono bg-gray-50 px-2 py-1 rounded w-full overflow-hidden text-ellipsis" style={{ color: "var(--accent)" }}>{job.result_url}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {job && (
        <PublishModal
          isOpen={publishModalOpen}
          onClose={() => setPublishModalOpen(false)}
          type="job"
          id={job.id}
          initialTitle={(typeof job.config === "object" && job.config !== null && (job.config as Record<string, unknown>).public_title as string) || job.name}
          initialDescription={(typeof job.config === "object" && job.config !== null && (job.config as Record<string, unknown>).public_description as string) || ""}
          initialCategory={(typeof job.config === "object" && job.config !== null && (job.config as Record<string, unknown>).category as string) || "General"}
          initialPublished={Boolean(typeof job.config === "object" && job.config !== null && (job.config as Record<string, unknown>).published)}
          onPublishSuccess={(isPub, updatedData) => {
            if (updatedData) {
              setJob(updatedData as Job);
            } else {
              fetchJob();
            }
          }}
        />
      )}
    </>
  );
}
