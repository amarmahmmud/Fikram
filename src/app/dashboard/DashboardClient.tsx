"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import styles from "./page.module.css";
import type { Database } from "@/lib/supabase/types";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];
type Job     = Database["public"]["Tables"]["jobs"]["Row"];

const STATUS_BADGE: Record<string, { cls: string; label: string }> = {
  completed: { cls: "badge-success", label: "Completed" },
  running:   { cls: "badge-warning", label: "Running" },
  failed:    { cls: "badge-error",   label: "Failed" },
  pending:   { cls: "badge-default", label: "Pending" },
  cancelled: { cls: "badge-default", label: "Cancelled" },
};

export default function DashboardClient({ profile, jobs: initialJobs }: { profile: Profile | null; jobs: Job[] }) {
  const router = useRouter();
  const supabase = createClient();
  const [jobs, setJobs] = useState<Job[]>(initialJobs);

  const credits = profile?.credits_balance ?? 0;
  const name = profile?.full_name ?? profile?.email?.split("@")[0] ?? "there";
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  // Auto-sync jobs on load to ensure honest status
  useEffect(() => {
    const hasActive = initialJobs.some((j: Job) => j.status === "running" || j.status === "pending");
    if (hasActive) {
      fetch("/api/jobs/sync")
        .then((res) => res.json())
        .then(async (json) => {
          if (json.ok) {
            const { data } = await supabase
              .from("jobs")
              .select("*")
              .order("created_at", { ascending: false })
              .limit(5);
            if (data) setJobs(data);
          }
        })
        .catch((err) => console.error("Dashboard sync error:", err));
    }
  }, [initialJobs, supabase]);

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push("/");
    router.refresh();
  }

  const totalJobs     = jobs.length;
  const completedJobs = jobs.filter((j: Job) => j.status === "completed").length;
  const creditsUsed   = jobs.reduce((a: number, j: Job) => a + j.credits_used, 0);

  const STATS = [
    { label: "Total Jobs",   value: String(totalJobs),     sub: "all time",      color: "var(--text-primary)" },
    { label: "Completed",    value: String(completedJobs), sub: "jobs finished", color: "var(--success)" },
    { label: "Credits Used", value: String(creditsUsed),   sub: "of 100 free",   color: "var(--text-secondary)" },
    { label: "Credits Left", value: String(credits),       sub: "remaining",     color: credits < 20 ? "var(--warning)" : "var(--text-primary)" },
  ];

  return (
    <>
      <div className="topbar">
        <span className="topbar-title">Dashboard</span>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button className="btn btn-ghost btn-sm" onClick={handleSignOut}>Sign Out</button>
        </div>
      </div>

      <div className="page-content">

        {/* ── Welcome ── */}
        <div className={styles.welcomeRow}>
          <div>
            <h2 className={styles.welcomeTitle}>{greeting}, {name.split(" ")[0]}</h2>
            <p style={{ color: "var(--text-muted)", fontSize: "0.875rem" }}>
              You have{" "}
              <strong style={{ color: credits < 20 ? "var(--warning)" : "var(--success)" }}>
                {credits} credits
              </strong>{" "}
              remaining.
              {jobs.length === 0 ? " Create your first AI assistant to get started." : ""}
            </p>
          </div>
        </div>

        {/* ── Create Your AI ── */}
        <div className={styles.section}>
          <div className={styles.sectionHeader} style={{ marginBottom: 20 }}>
            <h3 className={styles.sectionTitle}>Create Your AI</h3>
            <p style={{ color: "var(--text-muted)", fontSize: "0.875rem", marginTop: 4 }}>
              Start free with a Smart Assistant — upgrade to a Custom AI Model once you&apos;ve built up your content library.
            </p>
          </div>
          <div className={styles.tiersGrid}>

            {/* Smart Assistant — RAG */}
            <div className={`${styles.tierCard} ${styles.tierRecommended}`}>
              <div className={styles.tierBadge}>Recommended</div>
              <div className={styles.tierIcon}>◆</div>
              <h3 className={styles.tierTitle}>Smart Assistant</h3>
              <p className={styles.tierDesc}>
                Upload your content and get an accurate, citation-backed AI assistant in seconds. No training needed.
              </p>
              <ul className={styles.tierFeatures}>
                <li>✓ Ready in 10-30 seconds</li>
                <li>✓ Answers grounded in your text with citations</li>
                <li>✓ Free to set up (no GPU cost)</li>
              </ul>
              <Link href="/experts/new" className={`btn btn-primary ${styles.tierBtn}`}>
                Create Assistant →
              </Link>
            </div>

            {/* Custom Model — Fine-tuning (Coming Soon) */}
            <div className={styles.tierCard} style={{ opacity: 0.7, position: "relative" }}>
              <div className={styles.tierBadgePremium} style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }}>Coming Soon</div>
              <div className={styles.tierIcon}>◈</div>
              <h3 className={styles.tierTitle}>Custom AI Model</h3>
              <p className={styles.tierDesc}>
                Train a model that captures your unique voice and expertise. Best for established experts with lots of content.
              </p>
              <ul className={styles.tierFeatures}>
                <li>✓ Learns your unique tone and style</li>
                <li>✓ Sounds authentically like you in every response</li>
                <li>✓ Best for creators with an established content library</li>
              </ul>
              <button
                className={`btn btn-secondary ${styles.tierBtn}`}
                disabled
                style={{ opacity: 0.5, cursor: "not-allowed" }}
              >
                Coming Soon
              </button>
              <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: 12, textAlign: "center" }}>
                We&apos;re working on this · Stay tuned
              </p>
            </div>
          </div>
        </div>

        {/* ── Compact Stats Strip ── */}
        <div className={styles.statsStrip}>
          {STATS.map((s) => (
            <div key={s.label} className={styles.statChip}>
              <span className={styles.statChipValue} style={{ color: s.color }}>{s.value}</span>
              <div className={styles.statChipMeta}>
                <span className={styles.statChipLabel}>{s.label}</span>
                <span className={styles.statChipSub}>{s.sub}</span>
              </div>
            </div>
          ))}
        </div>

        {/* ── Recent Jobs ── */}
        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <h3 className={styles.sectionTitle}>Recent Jobs</h3>
            <Link href="/jobs" className="btn btn-ghost btn-sm">View all →</Link>
          </div>

          {jobs.length === 0 ? (
            <div className={styles.emptyJobs}>
              <p style={{ fontWeight: 600, marginBottom: 4, color: "var(--text-primary)" }}>No jobs yet</p>
              <p style={{ fontSize: "0.875rem" }}>Create your first AI assistant or fine-tuning job to get started.</p>
              <Link href="/experts/new" className="btn btn-primary btn-sm" style={{ marginTop: 16 }}>
                Create Assistant
              </Link>
            </div>
          ) : (
            <div className={styles.jobsList}>
              {jobs.map((job: Job) => {
                const s = STATUS_BADGE[job.status] ?? STATUS_BADGE.pending;
                return (
                  <Link key={job.id} href={`/jobs/${job.id}`} className={styles.jobRow}>
                    <div className={styles.jobLeft}>
                      <div className={styles.jobName}>{job.name}</div>
                      <div className={styles.jobMeta}>
                        <span className="font-mono" style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>{job.base_model.split("/").pop()}</span>
                        <span style={{ color: "var(--border)" }}>·</span>
                        <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                          {new Date(job.created_at).toLocaleDateString()}
                        </span>
                      </div>
                    </div>
                    <div className={styles.jobRight}>
                      <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
                        {job.credits_used > 0 ? `${job.credits_used} credits` : "—"}
                      </span>
                      <span className={`badge ${s.cls}`}>
                        <span className={`status-dot ${job.status}`} />
                        {s.label}
                      </span>
                      <span style={{ color: "var(--text-muted)", fontSize: "0.875rem" }}>→</span>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Popular Base Models ── */}
        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <h3 className={styles.sectionTitle}>Popular Base Models</h3>
            <Link href="/models" className="btn btn-ghost btn-sm">Browse all →</Link>
          </div>
          <div className={styles.modelsGrid}>
            {[
              { name: "Llama 3.1 8B", task: "Chat / Instruction", size: "8B",   credits: "20–40" },
              { name: "Mistral 7B",   task: "General Purpose",    size: "7B",   credits: "15–35" },
              { name: "Phi-3 Mini",   task: "Reasoning",          size: "3.8B", credits: "8–18" },
              { name: "Gemma 2 9B",   task: "Chat / Instruction", size: "9B",   credits: "25–50" },
            ].map((m) => (
              <div key={m.name} className={`card card-hover ${styles.modelCard}`}>
                <div className={styles.modelCardHeader}>
                  <div className={styles.modelIcon}>▣</div>
                  <span className="badge badge-default">{m.size}</span>
                </div>
                <div className={styles.modelName}>{m.name}</div>
                <div className={styles.modelTask}>{m.task}</div>
                <div className={styles.modelCredits}>~{m.credits} credits</div>
              </div>
            ))}
          </div>
        </div>

      </div>
    </>
  );
}
