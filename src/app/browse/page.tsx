"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import styles from "./page.module.css";
import type { CommunityItem } from "../api/community/route";
import { apiClient } from "@/lib/apiClient";
import { Globe, MessageCircle, Heart } from "lucide-react";

const CATEGORIES = ["All", "Coding", "Finance", "Healthcare", "Writing", "Legal", "Education", "General"];
type SortOption = "newest" | "popular";

export default function BrowseModelsPage() {
  const [models, setModels] = useState<CommunityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeCategory, setActiveCategory] = useState("All");
  const [sortBy, setSortBy] = useState<SortOption>("popular");

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

  const filteredModels = models
    .filter((m) => activeCategory === "All" || m.category.toLowerCase() === activeCategory.toLowerCase())
    .sort((a, b) => {
      if (sortBy === "popular") {
        return b.chatsCount - a.chatsCount;
      } else {
        return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
      }
    });

  if (!loading && models.length === 0) {
    return (
      <div className={styles.container}>
        <div className={styles.emptyState}>
          <h2 style={{ color: "#fff", marginBottom: 8 }}>Marketplace Coming Soon</h2>
          <p>We are currently curating the best AI models. Check back later!</p>
        </div>
      </div>
    );
  }

  return (
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
                    <MessageCircle size={14} style={{ display: 'inline', verticalAlign: 'text-bottom', marginRight: 4 }} /> {item.chatsCount >= 1000 ? (item.chatsCount / 1000).toFixed(1) + "k" : item.chatsCount}
                  </div>
                  <div className={styles.statItem} title="Likes">
                    <Heart size={14} style={{ display: 'inline', verticalAlign: 'text-bottom', marginRight: 4 }} /> {item.likesCount}
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
  );
}
