"use client";

import Link from "next/link";
import { useState, useEffect } from "react";
import styles from "./page.module.css";
import { apiClient } from "@/lib/apiClient";
import { createClient } from "@/lib/supabase/client";
import ComingSoonButton from "@/components/ComingSoonButton";
import { Star, Smile, Globe, MessageCircle, Heart, Download, Edit2, Zap, ArrowRight, Sparkles, BadgeCheck } from "lucide-react";

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
  const [mainTab, setMainTab] = useState<"community" | "huggingface">("community");
  const [search, setSearch] = useState("");

  useEffect(() => { document.title = "Model Registry — Fikram"; }, []);
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
        <span className="topbar-title">Model Registry</span>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <Link href="/experts/new" className="btn btn-primary btn-sm" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <Sparkles size={14} />
            <span>Create RAG AI Expert</span>
            <ArrowRight size={13} />
          </Link>
        </div>
      </div>

      <div className="page-content">
        {/* ── Main Navigation Tabs ── */}
        <div className={styles.tabs}>
          <button
            className={`${styles.tab} ${mainTab === "community" ? styles.active : ""}`}
            onClick={() => setMainTab("community")}
          >
            <Star size={16} style={{ marginRight: 4 }} /> Community
            <span className="badge badge-indigo" style={{ fontSize: "0.65rem", padding: "1px 6px" }}>
              {communityModels.length}
            </span>
          </button>


          <button
            className={`${styles.tab} ${mainTab === "huggingface" ? styles.active : ""}`}
            onClick={() => setMainTab("huggingface")}
          >
            <Smile size={16} style={{ marginRight: 4 }} /> HuggingFace
          </button>
        </div>

        {/* ── Community Creation Callout ── */}
        {mainTab === "community" && (
          <div className={styles.communityCallout}>
            <div className={styles.calloutText}>
              <div className={styles.calloutTitle}>
                <Sparkles size={16} color="var(--accent-primary)" />
                <span>Build your own grounded RAG AI Expert</span>
              </div>
              <span className={styles.calloutDesc}>
                Upload your content and create an interactive, citation-backed AI in seconds.
              </span>
            </div>
            <Link href="/experts/new" className={`btn btn-primary btn-sm ${styles.calloutBtn}`}>
              <span>Create Your Own RAG AI</span>
              <ArrowRight size={13} />
            </Link>
          </div>
        )}

        {/* ── Search & Filter Bar ── */}
        <div className={styles.filterRow}>
          <input
            id="model-search"
            className={`input ${styles.searchInput}`}
            placeholder={
              mainTab === "community" 
                ? "Search public RAG AI Experts by name, topic, or keyword..."
                : "Search HuggingFace models by name, org, or ID..."
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
        </div>

        {/* ── TAB 1: COMMUNITY PUBLISHED MODELS & RAG AI EXPERTS ── */}
        {mainTab === "community" && (
          <div>
            <div style={{ margin: "16px 0 20px" }}>
              <h3 style={{ fontSize: "1.1rem", display: "flex", alignItems: "center", gap: 8 }}>
                <Globe size={18} /> Public Expert Showcase
                <span className="badge badge-success" style={{ fontSize: "0.65rem" }}>Live & Ready to Chat</span>
              </h3>
              <p style={{ color: "var(--text-muted)", fontSize: "0.8125rem", margin: "4px 0 0" }}>
                RAG AI Experts and custom models created and published by experts on Fikram.
              </p>
            </div>

            {communityLoading ? (
              <div className={styles.emptyState}>Loading community RAG AI Experts...</div>
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
                          {item.isVerified && (
                            <span 
                              className={styles.verifiedCommunityBadge}
                              title="Verified by Fikram Community — Official Platform Model"
                            >
                              <BadgeCheck size={12} className={styles.verifiedBadgeIcon} />
                              <span>Verified</span>
                            </span>
                          )}
                        </div>
                        <span className={`badge ${item.type === "smart_assistant" ? "badge-indigo" : "badge-blue"}`}>
                          {item.type === "smart_assistant" ? "RAG AI Expert" : "Custom Model"}
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
                          {item.type === "smart_assistant" ? (
                            <Link 
                              href="/experts/new"
                              className="btn btn-primary btn-sm"
                              style={{ flex: 1, gap: 4 }}
                            >
                              <Zap size={14} /> Improve
                            </Link>
                          ) : (
                            <ComingSoonButton
                              feature="retrain"
                              className="btn btn-primary btn-sm"
                              style={{ flex: 1, gap: 4 }}
                            >
                              <Zap size={14} /> Retrain
                            </ComingSoonButton>
                          )}
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
                      <Link href={item.chatUrl} className="btn btn-primary btn-sm" style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                        <span>Try AI</span>
                        <ArrowRight size={13} />
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            )}
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
                Search and explore open-source models from HuggingFace. Base model training support is coming soon.
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
                      <ComingSoonButton
                        feature="use-base"
                        className="btn btn-primary btn-sm"
                      >
                        Use Base ▷
                      </ComingSoonButton>
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
          <div className="modal-content" style={{ backgroundColor: "var(--surface-1)", padding: 24, borderRadius: 12, width: "100%", maxWidth: 400, border: "1px solid var(--border)", boxShadow: "0 20px 40px rgba(0,0,0,0.6)" }}>
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
