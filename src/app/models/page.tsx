"use client";

import Link from "next/link";
import { useState, useEffect } from "react";
import styles from "./page.module.css";
import { MODELS, MODEL_CATEGORIES } from "@/lib/models";
import type { ModelCategory } from "@/lib/models";

interface HFModel {
  id: string;
  name: string;
  org: string;
  downloads: number;
  likes: number;
  size: string;
  tags: string[];
}

export default function ModelsPage() {
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState<ModelCategory | "all">("all");
  const [hfModels, setHfModels] = useState<HFModel[]>([]);
  const [hfLoading, setHfLoading] = useState(true);
  const [hfError, setHfError] = useState("");

  // Fetch community models from HuggingFace
  useEffect(() => {
    fetch("/api/huggingface-models")
      .then((r) => r.json())
      .then((data) => {
        if (data.ok) setHfModels(data.models);
        else setHfError("Could not load community models");
      })
      .catch(() => setHfError("Could not load community models"))
      .finally(() => setHfLoading(false));
  }, []);

  // Filter verified models
  const filteredVerified = MODELS.filter((m) => {
    const matchSearch = m.name.toLowerCase().includes(search.toLowerCase()) ||
      m.org.toLowerCase().includes(search.toLowerCase()) ||
      m.bestFor.some((b) => b.toLowerCase().includes(search.toLowerCase()));
    const matchCategory = activeCategory === "all" || m.category === activeCategory;
    return matchSearch && matchCategory;
  });

  // Filter community models
  const filteredCommunity = hfModels.filter((m) => {
    const matchSearch = m.name.toLowerCase().includes(search.toLowerCase()) ||
      m.org.toLowerCase().includes(search.toLowerCase()) ||
      m.id.toLowerCase().includes(search.toLowerCase());
    return matchSearch;
  });

  const formatDownloads = (n: number) => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return String(n);
  };

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

        {/* ── Verified Models Section ── */}
        <div style={{ margin: "24px 0 12px" }}>
          <h3 style={{ fontSize: "1.1rem", display: "flex", alignItems: "center", gap: 8 }}>
            <span>⭐</span> Verified Models
            <span className="badge badge-success" style={{ fontSize: "0.65rem" }}>Guaranteed to work</span>
          </h3>
          <p style={{ color: "var(--text-muted)", fontSize: "0.8rem", margin: "4px 0 0" }}>
            Curated and tested for fine-tuning on our platform. Best for most users.
          </p>
        </div>

        <div className={styles.modelsGrid}>
          {filteredVerified.map((m) => (
            <div key={m.id} className={`card card-hover ${styles.modelCard}`}>
              <div className={styles.modelCardTop}>
                <div className={styles.modelOrg}>{m.org}</div>
                <div style={{ display: "flex", gap: 4 }}>
                  {m.popular && <span className="badge badge-blue">Popular</span>}
                  {m.recommended && <span className="badge badge-success">⭐ Best Pick</span>}
                </div>
              </div>

              <h4 className={styles.modelName}>{m.name}</h4>
              <div className={styles.modelTask} style={{ textTransform: "capitalize" }}>{m.category}</div>

              {/* Quality Bar */}
              <div style={{ margin: "8px 0", display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{
                  flex: 1, height: 4, borderRadius: 2,
                  background: "var(--bg-secondary)", overflow: "hidden",
                }}>
                  <div style={{
                    height: "100%", borderRadius: 2,
                    width: `${m.quality * 10}%`,
                    background: m.quality >= 8 ? "var(--success)" : m.quality >= 6 ? "var(--warning, #f59e0b)" : "var(--text-muted)",
                  }} />
                </div>
                <span style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>{m.quality}/10</span>
              </div>

              <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", margin: "6px 0" }}>
                <strong>Best for:</strong> {m.bestFor.slice(0, 2).join(", ")}
              </div>

              <div className={styles.modelTags}>
                {m.tags.map((tag) => (
                  <span key={tag} className="badge badge-default">{tag}</span>
                ))}
              </div>

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

          {filteredVerified.length === 0 && (
            <div className={styles.emptyState}>
              <p style={{ color: "var(--text-muted)" }}>No verified models match your search.</p>
            </div>
          )}
        </div>

        {/* ── Community Models Section ── */}
        <div style={{ margin: "48px 0 12px", borderTop: "1px solid var(--border)", paddingTop: 24 }}>
          <h3 style={{ fontSize: "1.1rem", display: "flex", alignItems: "center", gap: 8 }}>
            <span>🌐</span> Community Models
            <span className="badge badge-default" style={{ fontSize: "0.65rem" }}>from HuggingFace</span>
          </h3>
          <p style={{ color: "var(--text-muted)", fontSize: "0.8rem", margin: "4px 0 0" }}>
            Live from HuggingFace. Filtered for fine-tuning compatibility (≤13B params, safetensors format). Results may vary.
          </p>
        </div>

        {hfLoading && (
          <div style={{ textAlign: "center", padding: 40, color: "var(--text-muted)" }}>
            <div style={{ fontSize: "1.5rem", marginBottom: 8 }}>⏳</div>
            Loading community models from HuggingFace...
          </div>
        )}

        {hfError && !hfLoading && (
          <div style={{ textAlign: "center", padding: 40, color: "var(--text-muted)" }}>
            <div style={{ fontSize: "1.5rem", marginBottom: 8 }}>⚠️</div>
            {hfError}
          </div>
        )}

        {!hfLoading && !hfError && (
          <>
            <div className={styles.resultsMeta}>
              <span style={{ color: "var(--text-muted)", fontSize: "0.875rem" }}>
                {filteredCommunity.length} community model{filteredCommunity.length !== 1 ? "s" : ""} found
              </span>
            </div>

            <div className={styles.modelsGrid}>
              {filteredCommunity.map((m) => (
                <div key={m.id} className={`card card-hover ${styles.modelCard}`}>
                  <div className={styles.modelCardTop}>
                    <div className={styles.modelOrg}>{m.org}</div>
                    <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                      <span className="badge badge-default" style={{ fontSize: "0.6rem" }}>Community</span>
                    </div>
                  </div>

                  <h4 className={styles.modelName}>{m.name}</h4>

                  <div style={{ display: "flex", gap: 12, fontSize: "0.75rem", color: "var(--text-muted)", margin: "6px 0" }}>
                    <span>📥 {formatDownloads(m.downloads)}</span>
                    <span>❤️ {m.likes}</span>
                    {m.size !== "Unknown" && <span>📐 {m.size}</span>}
                  </div>

                  <div className={styles.modelTags}>
                    {m.tags.slice(0, 4).map((tag) => (
                      <span key={tag} className="badge badge-default">{tag}</span>
                    ))}
                  </div>

                  <div className={styles.modelCardBottom}>
                    <div className={styles.modelCredits}>
                      <span className={styles.creditsLabel}>Size</span>
                      <span className={styles.creditsValue}>{m.size}</span>
                    </div>
                  </div>

                  <Link
                    href={`/new-job?model=${encodeURIComponent(m.id)}`}
                    className="btn btn-secondary btn-sm w-full"
                    style={{ marginTop: 16 }}
                  >
                    Fine-Tune This Model →
                  </Link>
                </div>
              ))}

              {filteredCommunity.length === 0 && !hfLoading && (
                <div className={styles.emptyState}>
                  <div style={{ fontSize: "2rem", marginBottom: 12 }}>🔍</div>
                  <p>No community models match your search.</p>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </>
  );
}
