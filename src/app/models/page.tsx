"use client";

import Link from "next/link";
import { useState } from "react";
import styles from "./page.module.css";
import { MODELS, MODEL_CATEGORIES } from "@/lib/models";
import type { ModelCategory } from "@/lib/models";

export default function ModelsPage() {
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState<ModelCategory | "all">("all");

  const filtered = MODELS.filter((m) => {
    const matchSearch = m.name.toLowerCase().includes(search.toLowerCase()) ||
      m.org.toLowerCase().includes(search.toLowerCase()) ||
      m.bestFor.some((b) => b.toLowerCase().includes(search.toLowerCase()));
    const matchCategory = activeCategory === "all" || m.category === activeCategory;
    return matchSearch && matchCategory;
  });

  return (
    <>
      <div className="topbar">
        <span className="topbar-title">Model Browser</span>
        <Link href="/new-job" className="btn btn-primary btn-sm">✦ Fine-Tune a Model</Link>
      </div>

      <div className="page-content">
        <div className={styles.filterRow}>
          <input
            id="model-search"
            className={`input ${styles.searchInput}`}
            placeholder="Search models by name, org, or use case..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className={styles.taskFilters}>
            {MODEL_CATEGORIES.map((cat) => (
              <button
                key={cat.value}
                className={`btn btn-sm ${activeCategory === cat.value ? "btn-primary" : "btn-secondary"}`}
                onClick={() => setActiveCategory(cat.value)}
              >
                {cat.label}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.resultsMeta}>
          <span style={{ color: "var(--text-muted)", fontSize: "0.875rem" }}>
            {filtered.length} model{filtered.length !== 1 ? "s" : ""} available
          </span>
        </div>

        <div className={styles.modelsGrid}>
          {filtered.map((m) => (
            <div key={m.id} className={`card card-hover ${styles.modelCard}`}>
              {/* Header */}
              <div className={styles.modelCardTop}>
                <div className={styles.modelOrg}>{m.org}</div>
                <div style={{ display: "flex", gap: 4 }}>
                  {m.popular && <span className="badge badge-blue">Popular</span>}
                  {m.recommended && <span className="badge badge-success">⭐ Recommended</span>}
                </div>
              </div>

              <h4 className={styles.modelName}>{m.name}</h4>
              <div className={styles.modelTask} style={{ textTransform: "capitalize" }}>{m.category}</div>

              {/* Quality Bar */}
              <div style={{ margin: "8px 0", display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{
                  flex: 1, height: 4, borderRadius: 2,
                  background: "var(--bg-secondary)",
                  overflow: "hidden",
                }}>
                  <div style={{
                    height: "100%", borderRadius: 2,
                    width: `${m.quality * 10}%`,
                    background: m.quality >= 8 ? "var(--success)" : m.quality >= 6 ? "var(--warning, #f59e0b)" : "var(--text-muted)",
                  }} />
                </div>
                <span style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>{m.quality}/10</span>
              </div>

              {/* Strengths */}
              <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", margin: "6px 0" }}>
                <strong>Best for:</strong> {m.bestFor.slice(0, 2).join(", ")}
              </div>

              {/* Tags */}
              <div className={styles.modelTags}>
                {m.tags.map((tag) => (
                  <span key={tag} className="badge badge-default">{tag}</span>
                ))}
              </div>

              {/* Footer */}
              <div className={styles.modelCardBottom}>
                <div className={styles.modelCredits}>
                  <span className={styles.creditsLabel}>Est. cost</span>
                  <span className={styles.creditsValue}>~{m.credits.min}–{m.credits.max} credits</span>
                </div>
                <div className={styles.modelSize}>{m.size} params</div>
              </div>

              <Link
                href={`/new-job?model=${encodeURIComponent(m.id)}`}
                className="btn btn-primary btn-sm w-full"
                style={{ marginTop: 16 }}
              >
                Fine-Tune This Model →
              </Link>
            </div>
          ))}

          {filtered.length === 0 && (
            <div className={styles.emptyState}>
              <div style={{ fontSize: "2rem", marginBottom: 12 }}>🔍</div>
              <p>No models match your search. Try a different term.</p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
