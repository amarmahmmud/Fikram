"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { apiClient } from "@/lib/apiClient";
import styles from "./page.module.css";
import type { Database } from "@/lib/supabase/types";

type Job = Database["public"]["Tables"]["jobs"]["Row"];
type Expert = Database["public"]["Tables"]["experts"]["Row"];

const STATUS_MAP: Record<string, { cls: string; label: string }> = {
  completed: { cls: "badge-success", label: "Completed" },
  running:   { cls: "badge-warning", label: "Running" },
  failed:    { cls: "badge-error",   label: "Failed" },
  pending:   { cls: "badge-default", label: "Pending" },
  cancelled: { cls: "badge-default", label: "Cancelled" },
};

/* ─── SVG Icons (inline to avoid extra dependency) ─── */
function TrashIcon({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </svg>
  );
}

function EyeIcon({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function CheckCircleIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  );
}

function AlertCircleIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}

function XIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function BriefcaseIcon({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
      <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
    </svg>
  );
}

function BotIcon({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="10" rx="2" />
      <circle cx="12" cy="5" r="2" />
      <path d="M12 7v4" />
      <line x1="8" y1="16" x2="8" y2="16" />
      <line x1="16" y1="16" x2="16" y2="16" />
    </svg>
  );
}

function ChatIcon({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

/* ─── Toast Component ─── */
function Toast({ message, type, onDismiss }: { message: string; type: "success" | "error" | "warning"; onDismiss: () => void }) {
  const [exiting, setExiting] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const dismiss = useCallback(() => {
    setExiting(true);
    setTimeout(onDismiss, 250);
  }, [onDismiss]);

  useEffect(() => {
    timerRef.current = setTimeout(dismiss, 7000);
    return () => clearTimeout(timerRef.current);
  }, [dismiss]);

  const handleMouseEnter = () => clearTimeout(timerRef.current);
  const handleMouseLeave = () => {
    timerRef.current = setTimeout(dismiss, 4000);
  };

  const typeClass =
    type === "success"
      ? styles.toastSuccess
      : type === "warning"
      ? styles.toastWarning
      : styles.toastError;

  return (
    <div
      className={`${styles.toast} ${typeClass} ${exiting ? styles.toastExiting : ""}`}
      role="status"
      aria-live="polite"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <span className={styles.toastIcon}>
        {type === "success" ? <CheckCircleIcon /> : <AlertCircleIcon />}
      </span>
      <span style={{ maxWidth: 460, whiteSpace: "normal", lineHeight: 1.4 }}>{message}</span>
      <button className={styles.toastDismiss} onClick={dismiss} aria-label="Dismiss notification">
        <XIcon />
      </button>
    </div>
  );
}

/* ─── Confirmation Modal Component ─── */
function ConfirmModal({
  itemName,
  itemType,
  loading,
  onConfirm,
  onCancel,
}: {
  itemName: string;
  itemType: "job" | "expert";
  loading: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  // Focus the Cancel button by default (safe action)
  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  // Close on Escape key
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !loading) onCancel();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onCancel, loading]);

  const typeLabel = itemType === "job" ? "fine-tuning job" : "smart assistant";

  return (
    <div className={styles.modalOverlay} onClick={loading ? undefined : onCancel} role="dialog" aria-modal="true" aria-labelledby="confirm-modal-title">
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalIcon}>
          <TrashIcon size={22} />
        </div>
        <h3 className={styles.modalTitle} id="confirm-modal-title">
          Remove <span className={styles.modalItemName}>{itemName}</span>?
        </h3>
        <p className={styles.modalBody}>
          This will permanently remove this {typeLabel} and its associated data. This action cannot be undone.
        </p>
        <div className={styles.modalActions}>
          <button
            ref={cancelRef}
            className={styles.modalCancelBtn}
            onClick={onCancel}
            disabled={loading}
          >
            Cancel
          </button>
          <button
            className={styles.modalDeleteBtn}
            onClick={onConfirm}
            disabled={loading}
          >
            {loading ? (
              <>
                <span className={styles.spinner} />
                Removing...
              </>
            ) : (
              <>
                <TrashIcon size={14} />
                Remove {itemType === "job" ? "Job" : "Assistant"}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Main Component ─── */
export default function JobsClient({ jobs: initialJobs, experts: initialExperts }: { jobs: Job[]; experts: Expert[] }) {
  const router = useRouter();
  const supabase = createClient();
  const [jobs, setJobs] = useState<Job[]>(initialJobs);
  const [experts, setExperts] = useState<Expert[]>(initialExperts);
  const [syncing, setSyncing] = useState(false);
  const [activeTab, setActiveTab] = useState<"jobs" | "experts">("experts");

  const [jobsPage, setJobsPage] = useState(1);
  const [hasMoreJobs, setHasMoreJobs] = useState(initialJobs.length === 50);
  
  const [expertsPage, setExpertsPage] = useState(1);
  const [hasMoreExperts, setHasMoreExperts] = useState(initialExperts.length === 50);

  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    setJobs(initialJobs);
    setJobsPage(1);
    setHasMoreJobs(initialJobs.length === 50);
    
    setExperts(initialExperts);
    setExpertsPage(1);
    setHasMoreExperts(initialExperts.length === 50);
  }, [initialJobs, initialExperts]);

  // Delete state
  const [deleteTarget, setDeleteTarget] = useState<{ type: "job" | "expert"; id: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  // Toast state
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" | "warning" } | null>(null);

  // Background sync for all running/pending jobs
  async function syncAllJobs() {
    setSyncing(true);
    try {
      const json = await apiClient.get<any>("/api/jobs/sync");
      if (json.ok) {
        const { data } = await supabase
          .from("jobs")
          .select("*")
          .order("created_at", { ascending: false });
        if (data) setJobs(data);
      }
    } catch (err) {
      console.error("Failed to sync jobs:", err);
    } finally {
      setSyncing(false);
    }
  }

  async function fetchNextPage() {
    const isJobs = activeTab === "jobs";
    if (loadingMore || (isJobs ? !hasMoreJobs : !hasMoreExperts)) return;
    
    setLoadingMore(true);
    try {
      const page = isJobs ? jobsPage : expertsPage;
      const from = page * 50;
      const to = from + 49;
      
      const { data, error } = await supabase
        .from(isJobs ? "jobs" : "experts")
        .select("*")
        .order("created_at", { ascending: false })
        .range(from, to);

      if (error) throw error;
      
      if (data && data.length > 0) {
        if (isJobs) {
          setJobs(prev => {
            const existingIds = new Set(prev.map(j => j.id));
            const newItems = data.filter(j => !existingIds.has(j.id));
            return [...prev, ...(newItems as Job[])];
          });
          setJobsPage(p => p + 1);
          if (data.length < 50) setHasMoreJobs(false);
        } else {
          setExperts(prev => {
            const existingIds = new Set(prev.map(e => e.id));
            const newItems = data.filter(e => !existingIds.has(e.id));
            return [...prev, ...(newItems as Expert[])];
          });
          setExpertsPage(p => p + 1);
          if (data.length < 50) setHasMoreExperts(false);
        }
      } else {
        if (isJobs) setHasMoreJobs(false);
        else setHasMoreExperts(false);
      }
    } catch (err) {
      console.error(`Failed to fetch more ${isJobs ? 'jobs' : 'experts'}:`, err);
    } finally {
      setLoadingMore(false);
    }
  }

  useEffect(() => {
    const hasActive = initialJobs.some((j) => j.status === "running" || j.status === "pending");
    if (hasActive) {
      syncAllJobs();
    }
  }, []);

  // Delete handler
  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);

    try {
      const endpoint = deleteTarget.type === "job"
        ? `/api/jobs/${deleteTarget.id}`
        : `/api/experts/${deleteTarget.id}`;

      await apiClient.delete<any>(endpoint);

      // Trigger row fade-out animation
      setRemovingId(deleteTarget.id);
      setDeleteTarget(null);

      // Wait for animation then remove from state
      setTimeout(() => {
        if (deleteTarget.type === "job") {
          setJobs((prev) => prev.filter((j) => j.id !== deleteTarget.id));
        } else {
          setExperts((prev) => prev.filter((e) => e.id !== deleteTarget.id));
        }
        setRemovingId(null);
        setToast({
          message: deleteTarget.type === "job" ? "Job removed successfully" : "Assistant removed successfully",
          type: "success",
        });
      }, 350);
    } catch (err: any) {
      console.error("Delete failed:", err);
      setDeleteTarget(null);
      const isUnderReview = err?.data?.underReview || err?.status === 423;
      setToast({
        message: err?.data?.error || err?.message || "Failed to remove item. Please try again.",
        type: isUnderReview ? "warning" : "error",
      });
    } finally {
      setDeleting(false);
    }
  }

  const counts = {
    total:     jobs.length,
    running:   jobs.filter((j) => j.status === "running").length,
    completed: jobs.filter((j) => j.status === "completed").length,
    failed:    jobs.filter((j) => j.status === "failed" || j.status === "cancelled").length,
  };

  const isJobActive = (status: string) => status === "running" || status === "pending";

  return (
    <>
      {/* ── Topbar ── */}
      <div className="topbar">
        <span className="topbar-title">Fine-Tuning Jobs</span>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button
            className="btn btn-ghost btn-sm"
            onClick={syncAllJobs}
            disabled={syncing}
            title="Refresh and sync job statuses"
          >
            {syncing ? "Syncing..." : "Sync Status"}
          </button>
          <button
            className="btn btn-secondary btn-sm"
            disabled
            style={{ opacity: 0.5, cursor: "not-allowed" }}
            title="Custom Fine-Tuning is coming soon"
          >
            + New Job
          </button>
        </div>
      </div>

      <div className="page-content">
        {/* ── Stats Bar ── */}
        <div className={styles.statsBar}>
          {[
            { label: "Total",     value: counts.total,     cls: "" },
            { label: "Running",   value: counts.running,   cls: "warning" },
            { label: "Completed", value: counts.completed, cls: "success" },
            { label: "Failed",    value: counts.failed,    cls: "error" },
          ].map((s) => (
            <div key={s.label} className={styles.statBubble}>
              <span className={styles.statBubbleValue} style={{ color: s.cls ? `var(--${s.cls})` : "var(--text-primary)" }}>
                {s.value}
              </span>
              <span className={styles.statBubbleLabel}>{s.label}</span>
            </div>
          ))}
        </div>

        {/* ── Tabs ── */}
        <div className={styles.tabBar}>
          <button
            className={`${styles.tab} ${activeTab === "experts" ? styles.tabActive : ""}`}
            onClick={() => setActiveTab("experts")}
            role="tab"
            aria-selected={activeTab === "experts"}
          >
            Smart Assistants
            <span className={styles.tabCount}>{experts.length}</span>
          </button>
          <button
            className={`${styles.tab}`}
            disabled
            style={{ opacity: 0.5, cursor: "not-allowed" }}
          >
            Fine-Tuning Jobs (Coming Soon)
            <span className={styles.tabCount}>{jobs.length}</span>
          </button>
        </div>


        {/* ── Jobs Tab ── */}
        {activeTab === "jobs" ? (
          jobs.length === 0 ? (
            <div className={styles.emptyState}>
              <div className={styles.emptyIcon}>
                <BriefcaseIcon />
              </div>
              <h3 className={styles.emptyTitle}>No fine-tuning jobs yet</h3>
              <p className={styles.emptyDesc}>
                Create your first fine-tuning job to start training a custom AI model on your data.
              </p>
              <button
                className="btn btn-primary"
                disabled
                style={{ opacity: 0.5, cursor: "not-allowed" }}
                title="Custom Fine-Tuning is coming soon"
              >
                Coming Soon
              </button>
            </div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Job Name</th>
                    <th>Model</th>
                    <th>Method</th>
                    <th>Credits</th>
                    <th>Date</th>
                    <th>Status</th>
                    <th style={{ textAlign: "right", width: 100 }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {jobs.map((job) => {
                    const s = STATUS_MAP[job.status] ?? STATUS_MAP.pending;
                    const active = isJobActive(job.status);
                    return (
                      <tr
                        key={job.id}
                        className={removingId === job.id ? styles.rowRemoving : ""}
                      >
                        <td style={{ fontWeight: 600, color: "var(--text-primary)" }}>{job.name}</td>
                        <td>
                          <span className="font-mono" style={{ fontSize: "0.8125rem" }}>
                            {job.base_model.split("/").pop()}
                          </span>
                        </td>
                        <td>
                          <span className="badge badge-indigo">{job.method.toUpperCase()}</span>
                        </td>
                        <td className="font-mono">{job.credits_used > 0 ? `${job.credits_used}` : "—"}</td>
                        <td style={{ fontSize: "0.8125rem", color: "var(--text-muted)" }}>
                          {new Date(job.created_at).toLocaleDateString()}
                        </td>
                        <td>
                          <span className={`badge ${s.cls}`}>
                            <span className={`status-dot ${job.status}`} />
                            {s.label}
                          </span>
                        </td>
                        <td>
                          <div className={styles.actionCell}>
                            {/* View button */}
                            <div className={styles.tooltipWrap}>
                              <Link
                                href={`/jobs/${job.id}`}
                                className={`${styles.actionBtn} ${styles.actionBtnView}`}
                                aria-label={`View job: ${job.name}`}
                              >
                                <EyeIcon />
                              </Link>
                              <span className={styles.tooltip}>View details</span>
                            </div>

                            <span className={styles.actionDivider} />

                            {/* Delete button */}
                            <div className={styles.tooltipWrap}>
                              <button
                                className={`${styles.actionBtn} ${styles.actionBtnDelete}`}
                                onClick={() => setDeleteTarget({ type: "job", id: job.id, name: job.name })}
                                disabled={active}
                                aria-label={active ? `Cannot remove active job: ${job.name}` : `Remove job: ${job.name}`}
                              >
                                <TrashIcon />
                              </button>
                              <span className={styles.tooltip}>
                                {active ? "Cannot remove active jobs" : "Remove job"}
                              </span>
                            </div>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )
        ) : (
          /* ── Experts Tab ── */
          experts.length === 0 ? (
            <div className={styles.emptyState}>
              <div className={styles.emptyIcon}>
                <BotIcon />
              </div>
              <h3 className={styles.emptyTitle}>No smart assistants yet</h3>
              <p className={styles.emptyDesc}>
                Create your first RAG smart assistant — it answers questions using your uploaded documents as a verified knowledge base.
              </p>
              <Link href="/experts/new" className="btn btn-primary">Create First Assistant</Link>
            </div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Assistant Name</th>
                    <th>Description</th>
                    <th>Type</th>
                    <th>Date Created</th>
                    <th style={{ textAlign: "right", width: 100 }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {experts.map((exp) => (
                    <tr
                      key={exp.id}
                      className={removingId === exp.id ? styles.rowRemoving : ""}
                    >
                      <td style={{ fontWeight: 600, color: "var(--text-primary)" }}>{exp.name}</td>
                      <td>
                        <span style={{
                          fontSize: "0.8125rem",
                          color: "var(--text-muted)",
                          display: "inline-block",
                          maxWidth: 300,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap"
                        }}>
                          {exp.description || "Grounded smart assistant with verified knowledge base."}
                        </span>
                      </td>
                      <td><span className="badge badge-indigo">RAG (Grounded)</span></td>
                      <td style={{ fontSize: "0.8125rem", color: "var(--text-muted)" }}>
                        {new Date(exp.created_at).toLocaleDateString()}
                      </td>
                      <td>
                        <div className={styles.actionCell}>
                          {/* Chat button */}
                          <div className={styles.tooltipWrap}>
                            <Link
                              href={`/experts/${exp.id}/chat`}
                              className={`${styles.actionBtn} ${styles.actionBtnView}`}
                              aria-label={`Chat with: ${exp.name}`}
                            >
                              <ChatIcon />
                            </Link>
                            <span className={styles.tooltip}>Open chat</span>
                          </div>

                          <span className={styles.actionDivider} />

                          {/* Delete button */}
                          <div className={styles.tooltipWrap}>
                            <button
                              className={`${styles.actionBtn} ${styles.actionBtnDelete}`}
                              onClick={() => setDeleteTarget({ type: "expert", id: exp.id, name: exp.name })}
                              aria-label={`Remove assistant: ${exp.name}`}
                            >
                              <TrashIcon />
                            </button>
                            <span className={styles.tooltip}>Remove assistant</span>
                          </div>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}
      </div>

      {/* Pagination Control */}
      {((activeTab === "jobs" && hasMoreJobs) || (activeTab === "experts" && hasMoreExperts)) && (
        <div style={{ display: "flex", justifyContent: "center", marginTop: "24px" }}>
          <button 
            onClick={fetchNextPage} 
            className="btn btn-secondary"
            disabled={loadingMore}
          >
            {loadingMore ? "Loading..." : "Load Next Page"}
          </button>
        </div>
      )}

      {/* ── Confirmation Modal ── */}
      {deleteTarget && (
        <ConfirmModal
          itemName={deleteTarget.name}
          itemType={deleteTarget.type}
          loading={deleting}
          onConfirm={handleDelete}
          onCancel={() => !deleting && setDeleteTarget(null)}
        />
      )}

      {/* ── Toast Notification ── */}
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onDismiss={() => setToast(null)}
        />
      )}
    </>
  );
}
