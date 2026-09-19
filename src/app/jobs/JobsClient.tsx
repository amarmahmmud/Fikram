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

const PAGE_SIZE = 50;

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

function ChevronDownIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function CalendarIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
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

/* ─── Skeleton Card ─── */
function SkeletonCard() {
  return (
    <div className={styles.skeletonCard}>
      <div className={styles.skeletonHeader}>
        <div className={styles.skeletonAvatar} />
        <div className={styles.skeletonLines}>
          <div className={styles.skeletonLine} />
          <div className={styles.skeletonLine} />
        </div>
      </div>
      <div className={styles.skeletonBody} />
      <div className={styles.skeletonFooter}>
        <div className={styles.skeletonBadge} />
        <div className={styles.skeletonActions}>
          <div className={styles.skeletonActionBtn} />
          <div className={styles.skeletonActionBtn} />
        </div>
      </div>
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

  const typeLabel = itemType === "job" ? "training job" : "RAG AI Expert";

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
                Remove {itemType === "job" ? "Job" : "RAG AI Expert"}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Helper: clean description from bracket config tags ─── */
function cleanDescription(desc: string | null): string {
  if (!desc) return "Grounded RAG AI Expert with verified knowledge base.";
  return desc
    .replace(/\[(Category|Tags|Mode|WebSearch):[^\]]+\]/gi, "")
    .trim() || "Grounded RAG AI Expert with verified knowledge base.";
}

/* ─── Helper: relative date ─── */
function formatRelativeDate(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    if (diffDays === 0) return "Today";
    if (diffDays === 1) return "Yesterday";
    if (diffDays < 7) return `${diffDays}d ago`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
    return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: date.getFullYear() !== now.getFullYear() ? "numeric" : undefined });
  } catch {
    return "";
  }
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
  const [hasMoreJobs, setHasMoreJobs] = useState(initialJobs.length === PAGE_SIZE);
  
  const [expertsPage, setExpertsPage] = useState(1);
  const [hasMoreExperts, setHasMoreExperts] = useState(initialExperts.length === PAGE_SIZE);

  const [loadingMore, setLoadingMore] = useState(false);

  // Track which items were loaded after initial render (for entrance animations)
  const [newItemIds, setNewItemIds] = useState<Set<string>>(new Set());
  // Track when all items have been loaded (show the "all loaded" indicator briefly)
  const [showAllLoaded, setShowAllLoaded] = useState<"jobs" | "experts" | null>(null);

  useEffect(() => {
    setJobs(initialJobs);
    setJobsPage(1);
    setHasMoreJobs(initialJobs.length === PAGE_SIZE);
    
    setExperts(initialExperts);
    setExpertsPage(1);
    setHasMoreExperts(initialExperts.length === PAGE_SIZE);
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
      const from = page * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;
      
      const { data, error } = await supabase
        .from(isJobs ? "jobs" : "experts")
        .select("*")
        .order("created_at", { ascending: false })
        .range(from, to);

      if (error) throw error;
      
      if (data && data.length > 0) {
        const loadedIds = new Set(data.map((item: any) => item.id));

        if (isJobs) {
          setJobs(prev => {
            const existingIds = new Set(prev.map(j => j.id));
            const newItems = data.filter(j => !existingIds.has(j.id));
            return [...prev, ...(newItems as Job[])];
          });
          setJobsPage(p => p + 1);
          if (data.length < PAGE_SIZE) {
            setHasMoreJobs(false);
            setShowAllLoaded("jobs");
            setTimeout(() => setShowAllLoaded(null), 4000);
          }
        } else {
          setExperts(prev => {
            const existingIds = new Set(prev.map(e => e.id));
            const newItems = data.filter(e => !existingIds.has(e.id));
            return [...prev, ...(newItems as Expert[])];
          });
          setExpertsPage(p => p + 1);
          if (data.length < PAGE_SIZE) {
            setHasMoreExperts(false);
            setShowAllLoaded("experts");
            setTimeout(() => setShowAllLoaded(null), 4000);
          }
        }

        // Mark new items for entrance animation
        setNewItemIds(prev => new Set([...prev, ...loadedIds]));
      } else {
        if (isJobs) {
          setHasMoreJobs(false);
          setShowAllLoaded("jobs");
        } else {
          setHasMoreExperts(false);
          setShowAllLoaded("experts");
        }
        setTimeout(() => setShowAllLoaded(null), 4000);
      }
    } catch (err) {
      console.error(`Failed to fetch more ${isJobs ? 'jobs' : 'experts'}:`, err);
      setToast({ message: `Failed to load more ${isJobs ? 'jobs' : 'RAG AI Experts'}. Please try again.`, type: "error" });
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
          message: deleteTarget.type === "job" ? "Job removed successfully" : "RAG AI Expert removed successfully",
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

  // Determine if we should show "all loaded" for the current tab
  const currentHasMore = activeTab === "jobs" ? hasMoreJobs : hasMoreExperts;
  const currentShowAllLoaded = showAllLoaded === activeTab;
  const currentItems = activeTab === "jobs" ? jobs : experts;

  return (
    <>
      {/* ── Topbar ── */}
      <div className="topbar">
        <span className="topbar-title">My Creations</span>
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
            title="Custom Training is coming soon"
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
            RAG AI Experts
            <span className={styles.tabCount}>{experts.length}</span>
          </button>
          <button
            className={`${styles.tab}`}
            disabled
            style={{ opacity: 0.5, cursor: "not-allowed" }}
          >
            Custom Training (Coming Soon)
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
              <h3 className={styles.emptyTitle}>No training jobs yet</h3>
              <p className={styles.emptyDesc}>
                Custom model training is coming soon. You'll be able to train AI models on your own data.
              </p>
              <button
                className="btn btn-primary"
                disabled
                style={{ opacity: 0.5, cursor: "not-allowed" }}
                title="Custom Training is coming soon"
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
          /* ── Experts Tab — Card Grid Layout ── */
          experts.length === 0 ? (
            <div className={styles.emptyState}>
              <div className={styles.emptyIcon}>
                <BotIcon />
              </div>
              <h3 className={styles.emptyTitle}>No RAG AI Experts yet</h3>
              <p className={styles.emptyDesc}>
                Create your first RAG AI Expert — it answers questions using your uploaded documents as a verified knowledge base.
              </p>
              <Link href="/experts/new" className="btn btn-primary">Create First RAG AI Expert</Link>
            </div>
          ) : (
            <>
              <div className={styles.cardGrid}>
                {experts.map((exp, index) => (
                  <div
                    key={exp.id}
                    className={`${styles.expertCard} ${newItemIds.has(exp.id) ? styles.cardEnter : ""} ${removingId === exp.id ? styles.cardRemoving : ""}`}
                    style={newItemIds.has(exp.id) ? { animationDelay: `${(index % PAGE_SIZE) * 60}ms` } : undefined}
                  >
                    {/* Card Header */}
                    <div className={styles.cardHeader}>
                      <div className={styles.cardAvatar}>
                        {exp.name.charAt(0).toUpperCase()}
                      </div>
                      <div className={styles.cardTitleGroup}>
                        <div className={styles.cardName} title={exp.name}>{exp.name}</div>
                        <div className={styles.cardDate}>
                          <CalendarIcon />
                          {formatRelativeDate(exp.created_at)}
                        </div>
                      </div>
                    </div>

                    {/* Description */}
                    <div className={styles.cardDescription}>
                      {cleanDescription(exp.description)}
                    </div>

                    {/* Footer */}
                    <div className={styles.cardFooter}>
                      <div className={styles.cardTypeBadge}>
                        <span className={styles.cardTypeDot} />
                        RAG (Grounded)
                      </div>
                      <div className={styles.cardActions}>
                        <Link
                          href={`/experts/${exp.id}/chat`}
                          className={`${styles.cardActionBtn} ${styles.chatBtn}`}
                          aria-label={`Chat with: ${exp.name}`}
                        >
                          <ChatIcon size={13} />
                          Chat
                        </Link>
                        <button
                          className={`${styles.cardActionBtn} ${styles.deleteBtn}`}
                          onClick={() => setDeleteTarget({ type: "expert", id: exp.id, name: exp.name })}
                          aria-label={`Remove RAG AI Expert: ${exp.name}`}
                        >
                          <TrashIcon size={13} />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}

                {/* Skeleton loading cards while fetching */}
                {loadingMore && activeTab === "experts" && (
                  <>
                    <SkeletonCard />
                    <SkeletonCard />
                    <SkeletonCard />
                  </>
                )}
              </div>
            </>
          )
        )}

        {/* ── Pagination Bar ── */}
        {currentItems.length > 0 && (
          <div className={styles.paginationBar}>
            {/* Count indicator */}
            <div className={styles.paginationInfo}>
              Showing{" "}
              <span className={styles.paginationInfoBold}>{currentItems.length}</span>
              {" "}{activeTab === "experts" ? (currentItems.length !== 1 ? "RAG AI Experts" : "RAG AI Expert") : (currentItems.length !== 1 ? "jobs" : "job")}
              {!currentHasMore && !currentShowAllLoaded && (
                <> · All loaded</>
              )}
            </div>

            {/* Load More button */}
            {currentHasMore && (
              <button
                onClick={fetchNextPage}
                className={styles.loadMoreBtn}
                disabled={loadingMore}
              >
                <span className={styles.loadMoreBtnText}>
                  {loadingMore ? "Loading..." : "Load More"}
                </span>
                <span className={styles.loadMoreIcon}>
                  {loadingMore ? (
                    <span className={styles.spinner} />
                  ) : (
                    <ChevronDownIcon size={16} />
                  )}
                </span>
              </button>
            )}

            {/* All loaded indicator (shows briefly after last page loads) */}
            {currentShowAllLoaded && (
              <div className={styles.allLoadedIndicator}>
                <CheckCircleIcon size={14} />
                All {activeTab === "experts" ? "RAG AI Experts" : "jobs"} loaded
              </div>
            )}
          </div>
        )}
      </div>

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
