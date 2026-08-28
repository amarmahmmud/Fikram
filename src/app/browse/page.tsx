"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import styles from "./page.module.css";
import type { CommunityItem } from "../api/community/route";
import { apiClient } from "@/lib/apiClient";
import { Globe, MessageCircle, Heart, Search } from "lucide-react";

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

  useEffect(() => {
    apiClient.get<any>("/api/community")
      .then((data) => {
        if (data.ok && data.models) {
          setModels(data.models);
        }
      })
      .catch((err) => console.error("Error fetching models:", err))
      .finally(() => setLoading(false));
  }, []);

  const handleLike = async (id: string, type: string) => {
    if (likedIds.has(id)) return; // Already liked this session

    // Optimistically update UI
    setLikedIds((prev) => new Set(prev).add(id));
    setLocalStats((prev) => ({
      ...prev,
      [id]: {
        ...prev[id],
        likes: (prev[id]?.likes ?? models.find(m => m.id === id)?.likesCount ?? 0) + 1,
      }
    }));

    try {
      const res = await apiClient.post<any>("/api/community/like", { targetId: id, targetType: type });
      if (res.ok && res.likes_count !== undefined) {
        setLocalStats((prev) => ({
          ...prev,
          [id]: { ...prev[id], likes: res.likes_count }
        }));
      }
    } catch (err) {
      console.error("Failed to like:", err);
      // Revert on error could go here
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
      <div className={styles.container}>
        <div className={styles.header}>
        <div>
          <h1 className={styles.title}>
            <Globe size={28} style={{ marginRight: 8, verticalAlign: 'text-bottom' }} /> Browse Models
          </h1>
          <p className={styles.subtitle}>
            Discover and try specialized AI assistants and fine-tuned models created by the community.
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
          style={{ marginLeft: "auto" }}
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as SortOption)}
          aria-label="Sort models"
        >
          <option value="popular">Most Used</option>
          <option value="newest">Newest First</option>
        </select>
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
                  {item.type === "smart_assistant" ? "Smart Assistant" : "Custom AI"}
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
                  <div className={styles.statItem} title="Total Chats">
                    <MessageCircle size={14} style={{ display: 'inline', verticalAlign: 'text-bottom', marginRight: 4 }} /> 
                    {localStats[item.id]?.chats ?? item.chatsCount >= 1000 ? ((localStats[item.id]?.chats ?? item.chatsCount) / 1000).toFixed(1) + "k" : (localStats[item.id]?.chats ?? item.chatsCount)}
                  </div>
                  <div 
                    className={styles.statItem} 
                    title="Likes"
                    style={{ cursor: 'pointer', transition: 'color 0.2s' }}
                    onClick={() => handleLike(item.id, item.type)}
                  >
                    <Heart 
                      size={14} 
                      fill={likedIds.has(item.id) ? "#C77DFF" : "none"}
                      color={likedIds.has(item.id) ? "#C77DFF" : "currentColor"}
                      style={{ display: 'inline', verticalAlign: 'text-bottom', marginRight: 4 }} 
                    /> 
                    {localStats[item.id]?.likes ?? item.likesCount}
                  </div>
                </div>
                <Link href={item.chatUrl} className="btn btn-primary btn-sm" style={{ padding: "6px 16px", borderRadius: "8px" }}>
                  {item.type === "smart_assistant" ? "Chat ▷" : "Try ▷"}
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
