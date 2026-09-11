"use client";

import Link from "next/link";
import { useState, useEffect } from "react";
import styles from "./page.module.css";
import { MODELS, ASR_MODEL_CATEGORIES as MODEL_CATEGORIES } from "@/lib/models";
import type { ASRModelCategory as ModelCategory } from "@/lib/models";
import { apiClient } from "@/lib/apiClient";
import { createClient } from "@/lib/supabase/client";
import { Star, Package, Smile, Globe, MessageCircle, Heart, Download, Edit2, Zap } from "lucide-react";

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
  ownerId?: string;
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

  // User state
  const [currentUser, setCurrentUser] = useState<any>(null);

  // Edit Modal state
  const [editItem, setEditItem] = useState<CommunityModel | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    createClient().auth.getUser().then(({ data }) => {
      setCurrentUser(data.user);
    });
  }, []);

  const handleSaveEdit = async () => {
    if (!editItem) return;
    setIsSaving(true);
    try {
      const res = await fetch("/api/community", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: editItem.id,
          type: editItem.type,
          title: editTitle,
          description: editDesc,
        }),
      });
      if (res.ok) {
        setCommunityModels((prev) =>
          prev.map((m) =>
            m.id === editItem.id ? { ...m, title: editTitle, description: editDesc } : m
          )
        );
        setEditItem(null);
      } else {
        console.error("Failed to update model");
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsSaving(false);
    }
  };

  // Fetch community models
  useEffect(() => {
    apiClient.get<any>("/api/community")
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
    apiClient.get<any>("/api/huggingface-models")
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
            <Star size={16} style={{ marginRight: 4 }} /> Community AIs & Models
            <span className="badge badge-indigo" style={{ fontSize: "0.65rem", padding: "1px 6px" }}>
              {communityModels.length}
            </span>
          </button>

          <button
            className={`${styles.tab} ${mainTab === "verified" ? styles.active : ""}`}
            onClick={() => setMainTab("verified")}
          >
            <Package size={16} style={{ marginRight: 4 }} /> Base Foundation Models
          </button>

          <button
            className={`${styles.tab} ${mainTab === "huggingface" ? styles.active : ""}`}
            onClick={() => setMainTab("huggingface")}
          >
            <Smile size={16} style={{ marginRight: 4 }} /> HuggingFace Hub (500+)
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
              {MODEL_CATEGORIES.map((cat: { value: string; label: string }) => (
                <button
                  key={cat.value}
                  className={`btn btn-sm ${activeCategory === cat.value ? "btn-primary" : "btn-secondary"}`}
                  onClick={() => setActiveCategory(cat.value as any)}
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
                <Globe size={18} /> Public Expert Showcase
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

                      {/* Owner Actions */}
                      {currentUser && currentUser.id === item.ownerId && (
                        <div style={{ display: "flex", gap: 8, marginTop: 12, marginBottom: 4 }}>
                          <button
                            className="btn btn-secondary btn-sm"
                            style={{ flex: 1, gap: 4 }}
                            onClick={() => {
                              setEditItem(item);
                              setEditTitle(item.title);
                              setEditDesc(item.description);
                            }}
                          >
                            <Edit2 size={14} /> Edit Details
                          </button>
                          <Link 
                            href={item.type === "smart_assistant" ? "/experts/new" : `/new-job?model=${encodeURIComponent(item.baseModel || "")}`}
                            className="btn btn-primary btn-sm"
                            style={{ flex: 1, gap: 4 }}
                          >
                            <Zap size={14} /> {item.type === "smart_assistant" ? "Improve" : "Retrain"}
                          </Link>
                        </div>
                      )}

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
                        <span className={styles.communityStats} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                          <MessageCircle size={14} /> {item.chatsCount.toLocaleString()} chats · <Heart size={14} /> {item.likesCount}
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
                <Package size={18} /> Verified Base LLMs
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
                <Smile size={18} /> HuggingFace Model Hub
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

                    <div className={styles.modelTags} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <span className="badge badge-default" style={{ fontSize: "0.6875rem", display: "flex", alignItems: "center", gap: 4 }}>
                        <Download size={12} /> {formatDownloads(m.downloads)}
                      </span>
                      <span className="badge badge-default" style={{ fontSize: "0.6875rem", display: "flex", alignItems: "center", gap: 4 }}>
                        <Heart size={12} /> {m.likes}
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

      {/* ── Edit Modal ── */}
      {editItem && (
        <div className="modal-overlay" style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.8)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999, backdropFilter: "blur(6px)" }}>
          <div className="modal-content" style={{ backgroundColor: "var(--bg)", padding: 24, borderRadius: 12, width: "100%", maxWidth: 400, border: "1px solid var(--border)", boxShadow: "0 20px 40px rgba(0,0,0,0.6)" }}>
            <h3 style={{ marginBottom: 16 }}>Edit Model Details</h3>
            <div className="form-group">
              <label className="label" style={{ display: "block", marginBottom: 6, fontSize: "0.875rem" }}>Public Name</label>
              <input
                className="input"
                style={{ width: "100%" }}
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                placeholder="Model Name"
              />
            </div>
            <div className="form-group" style={{ marginTop: 16 }}>
              <label className="label" style={{ display: "block", marginBottom: 6, fontSize: "0.875rem" }}>Description</label>
              <textarea
                className="input"
                style={{ width: "100%", resize: "vertical" }}
                value={editDesc}
                onChange={(e) => setEditDesc(e.target.value)}
                rows={3}
                placeholder="What is this model best for?"
              />
            </div>
            <div style={{ display: "flex", gap: 12, justifyContent: "flex-end", marginTop: 24 }}>
              <button
                className="btn btn-ghost"
                onClick={() => setEditItem(null)}
                disabled={isSaving}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={handleSaveEdit}
                disabled={isSaving || !editTitle.trim()}
              >
                {isSaving ? "Saving..." : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
