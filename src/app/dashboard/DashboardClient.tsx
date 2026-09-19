"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import styles from "./page.module.css";
import type { Database } from "@/lib/supabase/types";
import { Sparkles, Cpu, Check, ArrowRight, Compass, Globe } from "lucide-react";

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
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(initialJobs.length === 50);
  const [loadingMore, setLoadingMore] = useState(false);

  const credits = profile?.credits_balance ?? 0;
  const name = profile?.full_name ?? profile?.email?.split("@")[0] ?? "there";
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  useEffect(() => {
    setJobs(initialJobs);
    setHasMore(initialJobs.length === 50);
    setPage(1);
  }, [initialJobs]);

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

  async function fetchNextPage() {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const from = page * 50;
      const to = from + 49;
      const { data, error } = await supabase
        .from("jobs")
        .select("*")
        .order("created_at", { ascending: false })
        .range(from, to);

      if (error) throw error;
      
      if (data && data.length > 0) {
        setJobs(prev => {
          // Prevent duplicates by checking ids
          const existingIds = new Set(prev.map(j => j.id));
          const newJobs = data.filter(j => !existingIds.has(j.id));
          return [...prev, ...newJobs];
        });
        setPage(p => p + 1);
        if (data.length < 50) setHasMore(false);
      } else {
        setHasMore(false);
      }
    } catch (err) {
      console.error("Failed to fetch more jobs:", err);
    } finally {
      setLoadingMore(false);
    }
  }

  const totalJobs     = jobs.length;
  const completedJobs = jobs.filter((j: Job) => j.status === "completed").length;
  const creditsUsed   = jobs.reduce((a: number, j: Job) => a + j.credits_used, 0);

  const STATS = [
    { label: "Total Jobs",   value: String(totalJobs),     sub: "all time",      color: "var(--text-primary)" },
    { label: "Completed",    value: String(completedJobs), sub: "jobs finished", color: "var(--success)" },
    { label: "Credits Used", value: String(creditsUsed),   sub: "of 50 free",   color: "var(--text-secondary)" },
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
              {jobs.length === 0 ? " Create your first RAG AI Expert to get started." : ""}
            </p>
          </div>
        </div>

        {/* ── Create Your AI ── */}
        <div className={styles.section}>
          <div className={styles.sectionHeader} style={{ marginBottom: 14 }}>
            <div>
              <h3 className={styles.sectionTitle}>Create Your AI</h3>
              <p className={styles.sectionSubtitle} style={{ marginTop: 2 }}>
                Start free with a RAG AI Expert — or see what others in the community have built.
              </p>
            </div>
            <Link href="/browse" className="btn btn-ghost btn-sm" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <Globe size={14} />
              <span>Explore Marketplace</span>
              <ArrowRight size={13} />
            </Link>
          </div>
          <div className={styles.tiersGrid}>

            {/* RAG AI Expert */}
            <div className={`${styles.tierCard} ${styles.tierRecommended}`}>
              <div className={styles.tierBadge}>Recommended</div>
              <div className={styles.tierIcon}><Sparkles size={22} /></div>
              <h3 className={styles.tierTitle}>RAG AI Expert</h3>
              <p className={styles.tierDesc}>
                Upload your content and get an accurate, citation-backed RAG AI Expert in seconds. No training needed.
              </p>
              <ul className={styles.tierFeatures}>
                <li><Check size={14} className={styles.featureCheck} /> <span>Ready in 10-30 seconds</span></li>
                <li><Check size={14} className={styles.featureCheck} /> <span>Answers grounded in your text with citations</span></li>
                <li><Check size={14} className={styles.featureCheck} /> <span>Free to set up (no GPU cost)</span></li>
              </ul>
              <div className={styles.tierActions}>
                <Link href="/experts/new" className={`btn btn-primary ${styles.tierBtn}`}>
                  <Sparkles size={15} />
                  <span>Create RAG AI Expert</span>
                  <ArrowRight size={14} />
                </Link>
                <Link href="/browse" className={`btn btn-secondary ${styles.tierBtnSecondary}`}>
                  <Compass size={15} />
                  <span>Explore Existing Experts</span>
                </Link>
              </div>
            </div>

            {/* Custom Model — Training (Coming Soon) */}
            <div className={styles.tierCard} style={{ opacity: 0.7, position: "relative" }}>
              <div className={styles.tierBadgePremium} style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }}>Coming Soon</div>
              <div className={styles.tierIcon}><Cpu size={22} /></div>
              <h3 className={styles.tierTitle}>Custom AI Model</h3>
              <p className={styles.tierDesc}>
                Train a model that captures your unique voice and expertise. Best for established experts with lots of content.
              </p>
              <ul className={styles.tierFeatures}>
                <li><Check size={14} className={styles.featureCheck} /> <span>Learns your unique tone and style</span></li>
                <li><Check size={14} className={styles.featureCheck} /> <span>Sounds authentically like you in every response</span></li>
                <li><Check size={14} className={styles.featureCheck} /> <span>Best for creators with an established content library</span></li>
              </ul>
              <div className={styles.tierActions}>
                <button
                  className={`btn btn-secondary ${styles.tierBtn}`}
                  disabled
                  style={{ opacity: 0.5, cursor: "not-allowed" }}
                >
                  Coming Soon
                </button>
                <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", margin: "4px 0 0", textAlign: "center" }}>
                  We&apos;re working on this · Stay tuned
                </p>
              </div>
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
            <Link href="/jobs" className="btn btn-ghost btn-sm" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <span>View all</span>
              <ArrowRight size={13} />
            </Link>
          </div>

          {jobs.length === 0 ? (
            <div className={styles.emptyJobs}>
              <p style={{ fontWeight: 600, marginBottom: 4, color: "var(--text-primary)" }}>No creations yet</p>
              <p style={{ fontSize: "0.875rem" }}>Create your first RAG AI Expert or explore what others have built.</p>
              <div className={styles.emptyJobsActions}>
                <Link href="/experts/new" className="btn btn-primary btn-sm">
                  <Sparkles size={14} />
                  <span>Create RAG AI Expert</span>
                </Link>
                <Link href="/browse" className="btn btn-secondary btn-sm">
                  <Compass size={14} />
                  <span>Explore Existing Experts</span>
                </Link>
              </div>
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
                      <ArrowRight size={14} style={{ color: "var(--text-muted)" }} />
                    </div>
                  </Link>
                );
              })}
            </div>
          )}

          {/* Pagination Control */}
          {hasMore && (
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
        </div>

        {/* ── What You Can Build ── */}
        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <h3 className={styles.sectionTitle}>What You Can Build</h3>
            <Link href="/experts/new" className="btn btn-ghost btn-sm" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <span>Create now</span>
              <ArrowRight size={13} />
            </Link>
          </div>
          <div className={styles.modelsGrid}>
            {[
              { name: "Course Advisor",    task: "Education",       size: "RAG", credits: "6" },
              { name: "Legal Advisor",     task: "Legal & Compliance", size: "RAG", credits: "6" },
              { name: "Health Coach",      task: "Healthcare",      size: "RAG", credits: "6" },
              { name: "Finance Analyst",   task: "Finance",         size: "RAG", credits: "6" },
            ].map((m) => (
              <div key={m.name} className={`card card-hover ${styles.modelCard}`}>
                <div className={styles.modelCardHeader}>
                  <div className={styles.modelIcon}><Sparkles size={18} /></div>
                  <span className="badge badge-indigo" style={{ fontSize: "0.625rem" }}>{m.size}</span>
                </div>
                <div className={styles.modelName}>{m.name}</div>
                <div className={styles.modelTask}>{m.task}</div>
                <div className={styles.modelCredits}>~{m.credits} credits to set up</div>
              </div>
            ))}
          </div>
        </div>

      </div>
    </>
  );
}
