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

interface CommunityModel {
  id: string;
  type: "fine_tuned" | "smart_assistant";
  title: string;
  description: string;
  category: string;
  author: {
    name: string;
    avatarUrl?: string;
  };
  baseModel?: string;
  likesCount: number;
  chatsCount: number;
  publishedAt: string;
  chatUrl: string;
  tags: string[];
  isVerified?: boolean;
}

const COMMUNITY_CATEGORIES = [
  "All",
  "Coding",
  "Finance",
  "Healthcare",
  "Writing",
  "Legal",
  "Education",
  "General",
];

export default function ModelsPage() {
  const [mainTab, setMainTab] = useState<"community" | "verified" | "huggingface">("community");
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState<ModelCategory | "all">("all");
  const [communityCategory, setCommunityCategory] = useState("All");

  // Community Models state
  const [communityModels, setCommunityModels] = useState<CommunityModel[]>([]);
  const [communityLoading, setCommunityLoading] = useState(true);

  // HuggingFace state
  const [hfModels, setHfModels] = useState<HFModel[]>([]);
  const [hfLoading, setHfLoading] = useState(true);

  // Fetch community models
  useEffect(() => {
    fetch("/api/community")
      .then((r) => r.json())
      .then((data) => {
        if (data.ok && data.models) {
          setCommunityModels(data.models);
        }
      })
      .catch((err) => console.error("Error loading community models:", err))
      .finally(() => setCommunityLoading(false));
  }, []);

  // Fetch community models from HuggingFace
  useEffect(() => {
    fetch("/api/huggingface-models")
      .then((r) => r.json())
      .then((data) => {
        if (data.ok) setHfModels(data.models);
      })
      .catch((err) => console.error("Error loading HF models:", err))
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
  const filteredCommunity = communityModels.filter((m) => {
    const matchSearch = m.title.toLowerCase().includes(search.toLowerCase()) ||
      m.description.toLowerCase().includes(search.toLowerCase()) ||
      m.tags.some((t) => t.toLowerCase().includes(search.toLowerCase()));
    const matchCategory = communityCategory === "All" || m.category.toLowerCase() === communityCategory.toLowerCase();
    return matchSearch && matchCategory;
  });

  // Filter HuggingFace models
  const filteredCommunityHF = hfModels.filter((m) => {
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
        <span className="topbar-title">Explore & Model Browser</span>
      </div>

      <div className="page-content">
        {/* ── Main Navigation Tabs ── */}
        <div className={styles.tabs}>
          <button
            className={`${styles.tab} ${mainTab === "community" ? styles.active : ""}`}
            onClick={() => setMainTab("community")}
          >
            <span>⭐</span> Community AIs & Models
            <span className="badge badge-indigo" style={{ fontSize: "0.65rem", padding: "1px 6px" }}>
              {communityModels.length}
            </span>
          </button>

          <button
            className={`${styles.tab} ${mainTab === "verified" ? styles.active : ""}`}
            onClick={() => setMainTab("verified")}
          >
            <span>📦</span> Base Foundation Models
          </button>

          <button
            className={`${styles.tab} ${mainTab === "huggingface" ? styles.active : ""}`}
            onClick={() => setMainTab("huggingface")}
          >
            <span>🤗</span> HuggingFace Hub (500+)
          </button>
        </div>

        {/* ── Search & Filter Bar ── */}
        <div className={styles.filterRow}>
          <input
            id="model-search"
            className={`input ${styles.searchInput}`}
            placeholder={
              mainTab === "community" 
                ? "Search public expert assistants by name, topic, or keyword..."
                : "Search foundation models by name, org, or architecture..."
            }
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />

          {/* Categories for Community Tab */}
          {mainTab === "community" && (
            <div className={styles.taskFilters}>
              {COMMUNITY_CATEGORIES.map((cat) => (
                <button
                  key={cat}
                  className={`btn btn-sm ${communityCategory === cat ? "btn-primary" : "btn-secondary"}`}
                  onClick={() => setCommunityCategory(cat)}
                >
                  {cat}
                </button>
              ))}
            </div>
          )}

          {/* Categories for Verified Tab */}
          {mainTab === "verified" && (
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
          )}
        </div>

        {/* ── TAB 1: COMMUNITY PUBLISHED MODELS & ASSISTANTS ── */}
        {mainTab === "community" && (
          <div>
            <div style={{ margin: "16px 0 20px" }}>
              <h3 style={{ fontSize: "1.1rem", display: "flex", alignItems: "center", gap: 8 }}>
                <span>🌐</span> Public Expert Showcase
                <span className="badge badge-success" style={{ fontSize: "0.65rem" }}>Live & Ready to Chat</span>
              </h3>
              <p style={{ color: "var(--text-muted)", fontSize: "0.8125rem", margin: "4px 0 0" }}>
                AI assistants and custom fine-tuned models created and published by experts on Fikram.
              </p>
            </div>

            {communityLoading ? (
              <div className={styles.emptyState}>Loading community assistants...</div>
            ) : filteredCommunity.length === 0 ? (
              <div className={styles.emptyState}>
                <p>No community models match your search.</p>
                <Link href="/experts/new" className="btn btn-primary btn-sm" style={{ marginTop: 12 }}>
                  Create & Publish the First One
                </Link>
              </div>
            ) : (
              <div className={styles.modelsGrid}>
                {filteredCommunity.map((item) => (
                  <div key={item.id} className={styles.communityCard}>
                    <div>
                      <div className={styles.communityCardTop}>
                        <div className={styles.authorRow}>
                          <div className={styles.authorAvatar}>
                            {item.author.name.charAt(0).toUpperCase()}
                          </div>
                          <span className={styles.authorName}>{item.author.name}</span>
                        </div>
                        <span className={`badge ${item.type === "smart_assistant" ? "badge-indigo" : "badge-blue"}`}>
                          {item.type === "smart_assistant" ? "Smart Assistant" : "Fine-Tuned"}
                        </span>
                      </div>

                      <h4 className={styles.communityTitle}>{item.title}</h4>
                      <p className={styles.communityDesc}>{item.description}</p>

                      <div className={styles.communityTags}>
                        {item.tags.map((tag) => (
                          <span key={tag} className="badge badge-default" style={{ fontSize: "0.6875rem" }}>
                            #{tag}
                          </span>
                        ))}
                      </div>
                    </div>

                    <div className={styles.communityCardBottom}>
                      <div className={styles.communityMeta}>
                        <span className={styles.communityBase}>{item.baseModel}</span>
                        <span className={styles.communityStats}>
                          💬 {item.chatsCount.toLocaleString()} chats · ❤️ {item.likesCount}
                        </span>
                      </div>
                      <Link href={item.chatUrl} className="btn btn-primary btn-sm" style={{ gap: 4 }}>
                        Try AI ▷
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── TAB 2: VERIFIED BASE FOUNDATION MODELS ── */}
        {mainTab === "verified" && (
          <div>
            <div style={{ margin: "16px 0 20px" }}>
              <h3 style={{ fontSize: "1.1rem", display: "flex", alignItems: "center", gap: 8 }}>
                <span>◆</span> Verified Base LLMs
                <span className="badge badge-success" style={{ fontSize: "0.65rem" }}>Ready for GPU Fine-Tuning</span>
              </h3>
              <p style={{ color: "var(--text-muted)", fontSize: "0.8125rem", margin: "4px 0 0" }}>
                Curated open-source models tested for LoRA and QLoRA fine-tuning on Modal GPU clusters.
              </p>
            </div>

            <div className={styles.modelsGrid}>
              {filteredVerified.map((m) => (
                <div key={m.id} className={`card card-hover ${styles.modelCard}`}>
                  <div className={styles.modelCardTop}>
                    <div className={styles.modelOrg}>{m.org}</div>
                    <div style={{ display: "flex", gap: 4 }}>
                      {m.popular && <span className="badge badge-blue">Popular</span>}
                      {m.recommended && <span className="badge badge-success">Best Pick</span>}
                    </div>
                  </div>

                  <h4 className={styles.modelName}>{m.name}</h4>
                  <div className={styles.modelTask} style={{ textTransform: "capitalize" }}>{m.category}</div>

                  {/* Best for tags */}
                  <div className={styles.modelTags}>
                    {m.bestFor.slice(0, 3).map((bf) => (
                      <span key={bf} className="badge badge-default" style={{ fontSize: "0.6875rem" }}>
                        {bf}
                      </span>
                    ))}
                  </div>

                  <div className={styles.modelCardBottom}>
                    <div className={styles.modelCredits}>
                      <span className={styles.creditsLabel}>Est. Credits</span>
                      <span className={styles.creditsValue}>{m.credits.min}–{m.credits.max}</span>
                    </div>
                    <Link
                      href={`/new-job?model=${encodeURIComponent(m.name)}`}
                      className="btn btn-primary btn-sm"
                    >
                      Fine-Tune ▷
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── TAB 3: HUGGINGFACE HUB ── */}
        {mainTab === "huggingface" && (
          <div>
            <div style={{ margin: "16px 0 20px" }}>
              <h3 style={{ fontSize: "1.1rem", display: "flex", alignItems: "center", gap: 8 }}>
                <span>🤗</span> HuggingFace Model Hub
                <span className="badge badge-default" style={{ fontSize: "0.65rem" }}>Live Registry</span>
              </h3>
              <p style={{ color: "var(--text-muted)", fontSize: "0.8125rem", margin: "4px 0 0" }}>
                Search and select any open-source model directly from HuggingFace to use as your base.
              </p>
            </div>

            {hfLoading ? (
              <div className={styles.emptyState}>Searching HuggingFace hub...</div>
            ) : filteredCommunityHF.length === 0 ? (
              <div className={styles.emptyState}>No HuggingFace models found matching &quot;{search}&quot;.</div>
            ) : (
              <div className={styles.modelsGrid}>
                {filteredCommunityHF.slice(0, 24).map((m) => (
                  <div key={m.id} className={`card card-hover ${styles.modelCard}`}>
                    <div className={styles.modelCardTop}>
                      <div className={styles.modelOrg}>{m.org}</div>
                      <span className={styles.modelSize}>{m.size}</span>
                    </div>

                    <h4 className={styles.modelName}>{m.name}</h4>
                    <div className={styles.modelTask} style={{ fontFamily: "var(--font-mono)", fontSize: "0.75rem", color: "var(--text-muted)" }}>
                      {m.id}
                    </div>

                    <div className={styles.modelTags}>
                      <span className="badge badge-default" style={{ fontSize: "0.6875rem" }}>
                        ⬇ {formatDownloads(m.downloads)}
                      </span>
                      <span className="badge badge-default" style={{ fontSize: "0.6875rem" }}>
                        ❤️ {m.likes}
                      </span>
                    </div>

                    <div className={styles.modelCardBottom}>
                      <a
                        href={`https://huggingface.co/${m.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn btn-ghost btn-sm"
                        style={{ fontSize: "0.75rem" }}
                      >
                        View on HF ↗
                      </a>
                      <Link
                        href={`/new-job?model=${encodeURIComponent(m.id)}`}
                        className="btn btn-primary btn-sm"
                      >
                        Use Base ▷
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
