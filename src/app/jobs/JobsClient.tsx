"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import styles from "./page.module.css";
import type { Database } from "@/lib/supabase/types";

type Job = Database["public"]["Tables"]["jobs"]["Row"];

const STATUS_MAP: Record<string, { cls: string; label: string }> = {
  completed: { cls: "badge-success", label: "Completed" },
  running:   { cls: "badge-warning", label: "Running" },
  failed:    { cls: "badge-error",   label: "Failed" },
  pending:   { cls: "badge-default", label: "Pending" },
  cancelled: { cls: "badge-default", label: "Cancelled" },
};

export default function JobsClient({ jobs: initialJobs }: { jobs: Job[] }) {
  const router = useRouter();
  const supabase = createClient();
  const [jobs, setJobs] = useState<Job[]>(initialJobs);
  const [syncing, setSyncing] = useState(false);

  // Background sync for all running/pending jobs
  async function syncAllJobs() {
    setSyncing(true);
    try {
      const res = await fetch("/api/jobs/sync");
      const json = await res.json();
      if (json.ok) {
        // Fetch fresh list from Supabase
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

  useEffect(() => {
    // Run sync on load if there are running or pending jobs
    const hasActive = initialJobs.some((j) => j.status === "running" || j.status === "pending");
    if (hasActive) {
      syncAllJobs();
    }
  }, []);

  const counts = {
    total:     jobs.length,
    running:   jobs.filter((j) => j.status === "running").length,
    completed: jobs.filter((j) => j.status === "completed").length,
    failed:    jobs.filter((j) => j.status === "failed" || j.status === "cancelled").length,
  };

  return (
    <>
      <div className="topbar">
        <span className="topbar-title">Fine-Tuning Jobs</span>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button 
            className="btn btn-ghost btn-sm" 
            onClick={syncAllJobs} 
            disabled={syncing}
            title="Refresh and sync job statuses with GPU and storage"
          >
            {syncing ? "Syncing..." : "Sync Status"}
          </button>
          <Link href="/new-job" className="btn btn-secondary btn-sm">+ New Job</Link>
        </div>
      </div>

      <div className="page-content">
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

        {jobs.length === 0 ? (
          <div style={{ textAlign: "center", padding: "80px 24px" }}>
            <h3 style={{ marginBottom: 8 }}>No jobs yet</h3>
            <p style={{ color: "var(--text-muted)", marginBottom: 24 }}>Create your first fine-tuning job to get started.</p>
            <Link href="/new-job" className="btn btn-primary">New Fine-Tune</Link>
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
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => {
                  const s = STATUS_MAP[job.status] ?? STATUS_MAP.pending;
                  return (
                    <tr key={job.id}>
                      <td style={{ fontWeight: 600, color: "var(--text-primary)" }}>{job.name}</td>
                      <td><span className="font-mono" style={{ fontSize: "0.8125rem" }}>{job.base_model.split("/").pop()}</span></td>
                      <td><span className="badge badge-indigo">{job.method.toUpperCase()}</span></td>
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
                        <Link href={`/jobs/${job.id}`} className="btn btn-ghost btn-sm">View →</Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
