"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import styles from "./page.module.css";
import type { CommunityItem } from "../api/community/route";
import { apiClient } from "@/lib/apiClient";
import { MessageCircle, Heart, Search, ArrowRight, Sparkles, ArrowLeft } from "lucide-react";
import { toast } from "sonner";

const CATEGORIES = ["All", "Finance", "General", "Writing", "Healthcare", "Education"];
type SortOption = "newest" | "popular";

export default function BrowseModelsPage() {
  const [models, setModels] = useState<CommunityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeCategory, setActiveCategory] = useState("All");
  const [sortBy, setSortBy] = useState<SortOption>("popular");
  const [searchQuery, setSearchQuery] = useState("");
  const [likedIds, setLikedIds] = useState<Set<string>>(new Set());
  const [localStats, setLocalStats] = useState<Record<string, { likes: number; chats: number }>>({});
  const [likeInProgress, setLikeInProgress] = useState<Set<string>>(new Set());

  useEffect(() => { document.title = "Browse Models — Fikram"; }, []);

  useEffect(() => {
    apiClient.get<any>("/api/community")
      .then((data) => {
        if (data.ok && data.models) {
          setModels(data.models);
          // Initialize liked models from server state
          const initialLikedIds = new Set<string>();
          data.models.forEach((m: CommunityItem) => {
            if (m.hasLiked) initialLikedIds.add(m.id);
          });
          if (initialLikedIds.size > 0) {
            setLikedIds(initialLikedIds);
          }
        }
      })
      .catch((err) => console.error("Error fetching models:", err))
      .finally(() => setLoading(false));
  }, []);

  const handleLike = async (id: string, type: string) => {
    // Prevent duplicate concurrent requests
    if (likeInProgress.has(id)) return;

    const wasLiked = likedIds.has(id);
    const targetType = type === "smart_assistant" ? "expert" : "job";
    const nextLiked = !wasLiked;
    
    setLikeInProgress((prev) => new Set(prev).add(id));

    // Optimistically update UI
    setLikedIds((prev) => {
      const next = new Set(prev);
      if (nextLiked) next.add(id);
      else next.delete(id);
      return next;
    });

    setLocalStats((prev) => {
      const currentLikes = prev[id]?.likes ?? models.find((m) => m.id === id)?.likesCount ?? 0;
      return {
        ...prev,
        [id]: {
          ...prev[id],
          likes: nextLiked ? currentLikes + 1 : Math.max(0, currentLikes - 1),
        },
      };
    });

    try {
      // Use unified idempotent POST endpoint with action intent
      const res = await apiClient.post<any>("/api/community/like", {
        targetId: id,
        targetType,
        action: nextLiked ? "like" : "unlike",
      });

      if (res.ok) {
        // Authoritative server state sync
        if (typeof res.liked === "boolean") {
          setLikedIds((prev) => {
            const next = new Set(prev);
            if (res.liked) next.add(id);
            else next.delete(id);
            return next;
          });
        }
        if (res.likes_count !== undefined && res.likes_count !== null) {
          setLocalStats((prev) => ({
            ...prev,
            [id]: { ...prev[id], likes: res.likes_count },
          }));
        }
      }
    } catch (err: any) {
      console.warn(`[Like] Could not complete like update for ${id}:`, err?.message || err);
      // Revert optimistic update on error
      setLikedIds((prev) => {
        const next = new Set(prev);
        if (wasLiked) next.add(id);
        else next.delete(id);
        return next;
      });
      
      setLocalStats((prev) => {
        const currentLikes = prev[id]?.likes ?? models.find((m) => m.id === id)?.likesCount ?? 0;
        return {
          ...prev,
          [id]: {
            ...prev[id],
            likes: wasLiked ? currentLikes + 1 : Math.max(0, currentLikes - 1),
          },
        };
      });

      if (err?.status === 401) {
        toast.error("Please sign in to like models and RAG AI Experts.");
      }
    } finally {
      setLikeInProgress((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const filteredModels = models
    .filter((m) => {
      const matchesCategory = activeCategory === "All" || m.category.toLowerCase() === activeCategory.toLowerCase();
      const matchesSearch = m.title.toLowerCase().includes(searchQuery.toLowerCase()) || 
                            m.description.toLowerCase().includes(searchQuery.toLowerCase());
      return matchesCategory && matchesSearch;
    })
    .sort((a, b) => {
      if (sortBy === "popular") {
        return b.chatsCount - a.chatsCount;
      } else {
        return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
      }
    });

  if (!loading && models.length === 0) {
    return (
      <div className={styles.pageWrapper}>
        <div className={styles.ambientGlow} />
        <div className={styles.container}>
          <div className={styles.emptyState}>
            <h2 style={{ color: "var(--text-primary)", marginBottom: 8 }}>Marketplace Coming Soon</h2>
            <p>We are currently curating the best AI models. Check back later!</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.pageWrapper}>
      <div className={styles.ambientGlow} />

      {/* Top Navigation Bar */}
      <div className={styles.topNav}>
        <Link href="/dashboard" className={styles.backLink}>
          <ArrowLeft size={16} />
          <span>Dashboard</span>
        </Link>
        <Link href="/experts/new" className={`btn btn-primary btn-sm ${styles.topNavCta}`}>
          <Sparkles size={14} />
          <span className={styles.topNavCtaLong}>Create RAG AI Expert</span>
          <span className={styles.topNavCtaShort}>Create Expert</span>
          <ArrowRight size={13} />
        </Link>
      </div>

      <div className={styles.container}>
        <div className={styles.header}>
          <div>
            <h1 className={styles.title}>
              <span>Browse Models</span>
            </h1>
            <p className={styles.subtitle}>
              Discover community RAG AI Experts or create your own in seconds.
            </p>
          </div>

        </div>

      <div className={styles.filterBar}>
        <div className={styles.categoryFilters}>
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              className={`${styles.filterBtn} ${activeCategory === cat ? styles.active : ""}`}
              onClick={() => setActiveCategory(cat)}
            >
              {cat}
            </button>
          ))}
        </div>

        <div className={styles.filterControls}>
          <div className={styles.searchBar}>
            <Search size={16} color="var(--text-muted)" />
            <input 
              type="text" 
              placeholder="Search models..." 
              className={styles.searchInput}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          <select
            className={styles.sortSelect}
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortOption)}
            aria-label="Sort models"
          >
            <option value="popular">Most Used</option>
            <option value="newest">Newest First</option>
          </select>
        </div>
      </div>

      {loading ? (
        <div className={styles.loadingState}>
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className={styles.skeletonCard} />
          ))}
        </div>
      ) : filteredModels.length === 0 ? (
        <div className={styles.emptyState}>
          <p>No models found for the &quot;{activeCategory}&quot; category.</p>
        </div>
      ) : (
        <div className={styles.grid}>
          {filteredModels.map((item) => (
            <div key={item.id} className={styles.card}>
              <div className={styles.cardHeader}>
                <div className={styles.authorInfo}>
                  <div className={styles.avatar}>
                    {item.author.name.charAt(0).toUpperCase()}
                  </div>
                  <span className={styles.authorName}>{item.author.name}</span>
                </div>
                <span className={item.type === "smart_assistant" ? styles.badgeSmart : styles.badgeCustom}>
                  {item.type === "smart_assistant" ? "RAG AI Expert" : "Custom AI"}
                </span>
              </div>

              <h3 className={styles.modelTitle}>{item.title}</h3>
              <p className={styles.modelDesc}>{item.description}</p>

              <div className={styles.tags}>
                {item.tags.slice(0, 3).map((tag) => (
                  <span key={tag} className={styles.tag}>
                    {tag}
                  </span>
                ))}
              </div>

              <div className={styles.cardFooter}>
                <div className={styles.stats}>
                  {(() => {
                    const chatCount = localStats[item.id]?.chats ?? item.chatsCount ?? 0;
                    const likeCount = localStats[item.id]?.likes ?? item.likesCount ?? 0;
                    const formattedChats = chatCount >= 1000 ? (chatCount / 1000).toFixed(1) + "k" : String(chatCount);
                    const formattedLikes = likeCount >= 1000 ? (likeCount / 1000).toFixed(1) + "k" : String(likeCount);

                    return (
                      <>
                        <div className={styles.statItem} title="Total Chats">
                          <MessageCircle size={14} style={{ display: 'inline', verticalAlign: 'text-bottom', marginRight: 4 }} /> 
                          {formattedChats}
                        </div>
                        <div 
                          className={styles.statItem} 
                          title={likedIds.has(item.id) ? "Unlike" : "Like"}
                          role="button"
                          tabIndex={0}
                          style={{ 
                            cursor: likeInProgress.has(item.id) ? 'wait' : 'pointer', 
                            transition: 'all 0.2s',
                            opacity: likeInProgress.has(item.id) ? 0.6 : 1,
                          }}
                          onClick={() => handleLike(item.id, item.type === "smart_assistant" ? "expert" : "job")}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              handleLike(item.id, item.type === "smart_assistant" ? "expert" : "job");
                            }
                          }}
                        >
                          <Heart 
                            size={14} 
                            fill={likedIds.has(item.id) ? "#C77DFF" : "none"}
                            color={likedIds.has(item.id) ? "#C77DFF" : "currentColor"}
                            style={{ 
                              display: 'inline', 
                              verticalAlign: 'text-bottom', 
                              marginRight: 4,
                              transform: likedIds.has(item.id) ? 'scale(1.1)' : 'scale(1)',
                              transition: 'transform 0.15s ease, fill 0.15s ease',
                            }} 
                          /> 
                          {formattedLikes}
                        </div>
                      </>
                    );
                  })()}
                </div>
                <Link href={item.chatUrl} className={styles.cardActionBtn}>
                  <span>{item.type === "smart_assistant" ? "Chat" : "Try"}</span>
                  <ArrowRight size={13} className={styles.btnArrow} />
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
      </div>
    </div>
  );
}
