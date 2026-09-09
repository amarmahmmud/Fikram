"use client";

import Link from "next/link";
import { useState, useEffect, use, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import styles from "./page.module.css";
import type { Database } from "@/lib/supabase/types";
import { PublishModal } from "@/components/PublishModal";
import { apiClient } from "@/lib/apiClient";
import { Globe, RotateCcw } from "lucide-react";

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
  const epochs = config.epochs ?? 1;
  const lr = config.learningRate ?? 0.0001;
  const batchSize = config.batchSize ?? 2;
  const detectedFamily = config.detected_family as string | undefined;
  const datasetFileName = job.dataset_url ? job.dataset_url.split("/").pop()?.split("?")[0] : "Uploaded Dataset";
  const estimatedTrainingSec = config.estimated_training_seconds ?? (config.estimatedTime ? parseInt(config.estimatedTime) * 60 : 720);


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

  // Progress calculation — based on elapsed vs estimated
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

  // Training phases — derived from real job state
  const phases = [
    {
      id: "queued",
      label: "Job Queued",
      friendlyLabel: "Waiting in line",
      techDetail: `Job ${job.id.substring(0, 8)} submitted to Modal.com GPU cluster`,
      status: isPending ? "active" : "done",
      icon: "⏳",
    },
    {
      id: "gpu",
      label: "GPU Allocated",
      friendlyLabel: "GPU reserved for your model",
      techDetail: "NVIDIA L4 24GB VRAM container provisioned",
      status: isPending ? "pending" : "done",
      icon: "🖥️",
    },
    {
      id: "loading",
      label: "Loading Model",
      friendlyLabel: "Setting up the AI model",
      techDetail: `Loading ${job.base_model} with ${job.method.toUpperCase()} adapter (r=16, alpha=16)`,
      status: isPending ? "pending" : (isRunning && elapsedSec < 45) ? "active" : isRunning || isCompleted ? "done" : "pending",
      icon: "📦",
    },
    {
      id: "training",
      label: "Training",
      friendlyLabel: "Your model is learning from the data",
      techDetail: `${epochs} epochs × batch ${batchSize} | LR: ${lr} | AdamW optimizer`,
      status: isRunning && elapsedSec >= 45 ? "active" : isCompleted ? "done" : "pending",
      icon: "🧠",
    },
    {
      id: "uploading",
      label: "Saving Weights",
      friendlyLabel: "Saving your trained model",
      techDetail: `Uploading LoRA adapter weights to Cloudflare R2`,
      status: isCompleted ? "done" : "pending",
      icon: "💾",
    },
    {
      id: "evaluating",
      label: "Evaluating",
      friendlyLabel: "Testing your model's accuracy",
      techDetail: `Running held-out test set through LLM-as-a-Judge evaluation`,
      status: isCompleted
        ? (config.eval_status === "completed" ? "done"
          : config.eval_status === "running" ? "active"
          : config.eval_status === "unavailable" ? "done"
          : config.eval_dataset_url ? "active" : "done")
        : "pending",
      icon: "📊",
    },
    {
      id: "complete",
      label: "Complete",
      friendlyLabel: "Your model is ready!",
      techDetail: `Finished in ${durationStr}. Adapter available at ${job.result_url || "adapters/" + job.id}`,
      status: isCompleted ? "done" : isFailed ? "failed" : "pending",
      icon: "✨",
    },
  ];

  // "What's happening" explainer text
  const activePhase = phases.find(p => p.status === "active");
  const explainerText = isFailed
    ? "Something went wrong during training. You can retry with the same dataset."
    : isCompleted
    ? "Training is complete! Your custom AI model is ready to test in the playground."
    : isPending
    ? "Your job is in the queue. It will start automatically once a GPU becomes available (usually within a minute)."
    : activePhase?.id === "loading"
    ? `We're loading ${job.base_model} onto the GPU and configuring the fine-tuning adapter. This takes about 30-45 seconds.`
    : activePhase?.id === "training"
    ? `Your model is learning from the training data. Each pass through your data (called an 'epoch') helps it become more accurate. Running ${epochs} epoch${epochs > 1 ? "s" : ""}.`
    : "Processing your training job...";

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
                  href={`/new-job?retrain=${job.id}`}
                  className="btn btn-sm btn-secondary"
                  style={{ gap: 6 }}
                >
                  <RotateCcw size={14} />
                  Retrain
                </Link>
                <button
                  className="btn btn-sm btn-secondary"
                  onClick={() => setPublishModalOpen(true)}
                  style={{ gap: 6 }}
                >
                  <Globe size={16} />
                  {(typeof job.config === "object" && job.config !== null && (job.config as Record<string, unknown>).published) ? "Published (Share)" : "Publish & Share"}
                </button>
                <Link 
                  href={`/playground/${job.id}`} 
                  className="btn btn-sm btn-primary"
                >
                  ▷ Test in Playground
                </Link>
              </>
            )}
            {isFailed && job.dataset_url && (
              <Link
                href={`/new-job?retrain=${job.id}`}
                className="btn btn-sm btn-primary"
                style={{ gap: 6 }}
              >
                <RotateCcw size={14} />
                Retry Training
              </Link>
            )}
            {job.dataset_url && (
              <a href={job.dataset_url} target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-sm">
                View Dataset
              </a>
            )}
          </div>
        </div>

        <div className={styles.grid}>
          {/* Left col */}
          <div className={styles.leftCol}>
            {/* Live Status Card — with real progress + timer */}
            <div className="card">
              <div className={styles.cardHead}>
                <span className={styles.cardTitle}>Training Status</span>
                <span className="font-mono" style={{ fontSize: "0.8125rem", color: isCompleted ? "var(--success)" : isRunning ? "var(--warning)" : isFailed ? "var(--error)" : "var(--text-muted)" }}>
                  {isCompleted ? "Complete" : isRunning ? `${progressPercent}%` : isFailed ? "Failed" : "Queued"}
                </span>
              </div>

              {/* Progress bar */}
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

              {/* Timer row */}
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
                  <span className={styles.timerLabel}>Engine: Modal.com (NVIDIA L4)</span>
                </div>
              </div>
            </div>

            {/* What's Happening — friendly explainer */}
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

            {/* Phase Timeline */}
            <div className="card">
              <div className={styles.cardHead} style={{ marginBottom: 16 }}>
                <span className={styles.cardTitle}>Training Pipeline</span>
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
                          <span style={{ fontSize: "0.75rem" }}>{phase.icon}</span>
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

            {/* ── Evaluation Report Card ── */}
            {isCompleted && (() => {
              const evalStatus = config.eval_status as string | undefined;
              const evalResult = config.eval_result as Record<string, any> | undefined;
              const evalError = config.eval_error as string | undefined;

              // Not evaluated yet and no eval set
              if (!evalStatus && !evalResult) return null;

              // Evaluation is running
              if (evalStatus === "running") {
                return (
                  <div className={styles.evalCard}>
                    <div className={styles.evalHeader}>
                      <span className={styles.evalTitle}>📊 Evaluation Report</span>
                    </div>
                    <div className={styles.evalStatusRunning}>
                      <div className={styles.evalSpinner} />
                      <span>Evaluating your model against held-out test questions... This may take a few minutes.</span>
                    </div>
                  </div>
                );
              }

              // Evaluation unavailable
              if (evalStatus === "unavailable") {
                return (
                  <div className={styles.evalCard}>
                    <div className={styles.evalHeader}>
                      <span className={styles.evalTitle}>📊 Evaluation Report</span>
                      <span className={`${styles.evalBadge} ${styles.evalBadgeWarn}`}>Unavailable</span>
                    </div>
                    <p className={styles.explainerText}>
                      {evalError || "Automatic evaluation could not be completed. You can still test your model in the playground and publish it."}
                    </p>
                  </div>
                );
              }

              // Evaluation completed — show the Report Card
              if (evalResult) {
                const pct = evalResult.overallPercentage as number ?? 0;
                const avgScore = evalResult.overallScore as number ?? 0;
                const categories = (evalResult.categoryScores || {}) as Record<string, { avg: number; count: number; percentage: number }>;
                const failedExamples = (evalResult.failedExamples || []) as Array<{
                  prompt: string; sourceQuote: string; reasoning: string; score: number;
                }>;
                const guidance = evalResult.guidance as { summary: string; primaryAction: string; actionLabel: string } | null;
                const isGood = avgScore >= 4.0;
                const isOkay = avgScore >= 3.0 && avgScore < 4.0;

                const colorClass = isGood ? "Good" : isOkay ? "Warn" : "Bad";

                // Friendly category labels
                const categoryLabels: Record<string, string> = {
                  recall: "Fact Recall",
                  application: "Application",
                  format_following: "Format",
                  meta_cognitive: "Self-Awareness",
                  contrastive: "Comparisons",
                  boundary: "Boundaries",
                  unknown: "Other",
                };

                return (
                  <div className={styles.evalCard}>
                    <div className={styles.evalHeader}>
                      <span className={styles.evalTitle}>📊 Evaluation Report</span>
                      <span className={`${styles.evalBadge} ${styles[`evalBadge${colorClass}`]}`}>
                        {isGood ? "Ready to Publish" : isOkay ? "Needs Improvement" : "Needs Work"}
                      </span>
                    </div>

                    {/* Overall Score */}
                    <div className={styles.evalScoreRing}>
                      <div style={{ textAlign: "center" }}>
                        <div className={`${styles.evalPercentage} ${styles[`evalPercentage${colorClass}`]}`}>
                          {pct}%
                        </div>
                        <div className={styles.evalSubtext}>
                          {avgScore.toFixed(1)}/5.0 · {evalResult.totalEvaluated} questions tested
                        </div>
                      </div>
                    </div>

                    {/* Category Breakdown */}
                    {Object.keys(categories).length > 0 && (
                      <div className={styles.evalCategories}>
                        {Object.entries(categories).map(([cat, data]) => {
                          const catColor = data.percentage >= 80 ? "#10b981" : data.percentage >= 60 ? "#fbbf24" : "#ef4444";
                          return (
                            <div key={cat} className={styles.evalCategoryItem}>
                              <div className={styles.evalCategoryLabel}>
                                {categoryLabels[cat] || cat}
                              </div>
                              <div className={styles.evalCategoryScore} style={{ color: catColor }}>
                                {data.percentage}%
                              </div>
                              <div className={styles.evalCategoryCount}>
                                {data.count} question{data.count !== 1 ? "s" : ""}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Failed Examples (trust-building transparency) */}
                    {failedExamples.length > 0 && (
                      <div className={styles.evalFailedSection}>
                        <div className={styles.evalFailedTitle}>
                          Where the model struggled ({failedExamples.length} example{failedExamples.length !== 1 ? "s" : ""})
                        </div>
                        {failedExamples.map((ex, idx) => (
                          <div key={idx} className={styles.evalFailedItem}>
                            <div className={styles.evalFailedQuestion}>
                              Q: {ex.prompt.length > 150 ? ex.prompt.substring(0, 150) + "…" : ex.prompt}
                            </div>
                            <div className={styles.evalFailedMeta}>
                              <span className={styles.evalFailedScore}>{ex.score}/5</span>
                            </div>
                            {ex.sourceQuote && (
                              <div className={styles.evalFailedQuote}>
                                &ldquo;{ex.sourceQuote.length > 200 ? ex.sourceQuote.substring(0, 200) + "…" : ex.sourceQuote}&rdquo;
                              </div>
                            )}
                            <div className={styles.evalFailedReasoning}>{ex.reasoning}</div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Guidance & Actions */}
                    {guidance && guidance.primaryAction !== "none" && (
                      <div className={styles.evalGuidance}>
                        <p className={styles.evalGuidanceText}>{guidance.summary}</p>
                        <div className={styles.evalGuidanceActions}>
                          {/* Lightweight action: retrain (routes through cost estimation) */}
                          {(guidance.primaryAction === "add_data" || guidance.primaryAction === "more_steps") && (
                            <Link
                              href={`/new-job?retrain=${job.id}`}
                              className="btn btn-sm btn-primary"
                              style={{ gap: 6, display: "inline-flex", alignItems: "center" }}
                            >
                              <RotateCcw size={14} />
                              {guidance.actionLabel}
                            </Link>
                          )}
                          {/* Heavyweight action: different model → fresh job setup with cost preview */}
                          {guidance.primaryAction === "different_model" && (
                            <Link
                              href="/new-job"
                              className="btn btn-sm btn-secondary"
                              style={{ gap: 6, display: "inline-flex", alignItems: "center" }}
                            >
                              {guidance.actionLabel} →
                            </Link>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Good score — prominent Publish CTA */}
                    {isGood && (
                      <div style={{ marginTop: 16, textAlign: "center" }}>
                        <button
                          className="btn btn-primary"
                          onClick={() => setPublishModalOpen(true)}
                          style={{ gap: 8, display: "inline-flex", alignItems: "center", padding: "10px 24px" }}
                        >
                          <Globe size={16} />
                          Publish Your Model
                        </button>
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
            {/* Real Configuration */}
            <div className="card">
              <span className={styles.cardTitle} style={{ display: "block", marginBottom: 16 }}>Configuration</span>
              {[
                ["Base Model", job.base_model],
                ...(detectedFamily ? [["Model Family", detectedFamily]] : []),
                ["Method", job.method.toUpperCase()],
                ["Epochs", epochs],
                ["Learning Rate", lr],
                ["Batch Size", batchSize],
                ["Dataset File", datasetFileName],
                ["Duration", durationStr],
                ["Credits", `${job.credits_used || 28} credits`],
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
                    style={{ textAlign: "center" }}
                  >
                    ▷ Test in Playground
                  </Link>
                )}

                {(isCompleted || (isFailed && job.dataset_url)) && (
                  <Link
                    href={`/new-job?retrain=${job.id}`}
                    className="btn btn-secondary w-full"
                    style={{ textAlign: "center", gap: 6, display: "flex", alignItems: "center", justifyContent: "center" }}
                  >
                    <RotateCcw size={14} />
                    {isFailed ? "Retry with Same Dataset" : "Retrain with New Parameters"}
                  </Link>
                )}


                {job.result_url && (
                  <div className={styles.configRow} style={{ padding: "8px 0", fontSize: "0.75rem", color: "var(--text-muted)" }}>
                    <span>LoRA Prefix:</span>
                    <span className="font-mono" style={{ color: "var(--accent)" }}>{job.result_url}</span>
                  </div>
                )}

                <Link href="/new-job" className="btn btn-ghost w-full" style={{ color: "var(--text-muted)", textAlign: "center" }}>
                  Fine-Tune Another Model
                </Link>
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
