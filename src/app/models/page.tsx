"use client";

import Link from "next/link";
import { useState } from "react";
import styles from "./page.module.css";

const MODELS = [
  { id: "meta-llama/Llama-3.1-8B-Instruct", name: "Llama 3.1 8B Instruct", org: "Meta", task: "Chat / Instruction", size: "8B", credits: "20–40", popular: true, tags: ["chat", "instruction", "text"] },
  { id: "mistralai/Mistral-7B-Instruct-v0.3", name: "Mistral 7B Instruct v0.3", org: "Mistral AI", task: "General Purpose", size: "7B", credits: "15–35", popular: true, tags: ["general", "instruction", "text"] },
  { id: "microsoft/Phi-3-mini-4k-instruct", name: "Phi-3 Mini 4K Instruct", org: "Microsoft", task: "Reasoning", size: "3.8B", credits: "8–18", popular: false, tags: ["reasoning", "lightweight", "text"] },
  { id: "google/gemma-2-9b-it", name: "Gemma 2 9B Instruct", org: "Google", task: "Chat / Instruction", size: "9B", credits: "25–50", popular: true, tags: ["chat", "instruction", "text"] },
  { id: "Qwen/Qwen2.5-7B-Instruct", name: "Qwen 2.5 7B Instruct", org: "Alibaba", task: "Multilingual", size: "7B", credits: "15–35", popular: false, tags: ["multilingual", "instruction", "text"] },
  { id: "tiiuae/falcon-7b-instruct", name: "Falcon 7B Instruct", org: "TII UAE", task: "Instruction Following", size: "7B", credits: "15–30", popular: false, tags: ["instruction", "text"] },
  { id: "deepseek-ai/DeepSeek-R1-Distill-Llama-8B", name: "DeepSeek R1 Llama 8B", org: "DeepSeek", task: "Reasoning / Chain-of-Thought", size: "8B", credits: "20–40", popular: true, tags: ["reasoning", "cot", "text"] },
  { id: "microsoft/phi-2", name: "Phi-2", org: "Microsoft", task: "General Purpose", size: "2.7B", credits: "6–14", popular: false, tags: ["lightweight", "general", "text"] },
];

const TASKS = ["All", "Chat / Instruction", "Reasoning", "General Purpose", "Multilingual", "Lightweight"];

export default function ModelsPage() {
  const [search, setSearch] = useState("");
  const [activeTask, setActiveTask] = useState("All");

  const filtered = MODELS.filter((m) => {
    const matchSearch = m.name.toLowerCase().includes(search.toLowerCase()) ||
      m.org.toLowerCase().includes(search.toLowerCase());
    const matchTask = activeTask === "All" || m.task.includes(activeTask);
    return matchSearch && matchTask;
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
            placeholder="Search models by name or organization..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className={styles.taskFilters}>
            {TASKS.map((t) => (
              <button
                key={t}
                className={`btn btn-sm ${activeTask === t ? "btn-primary" : "btn-secondary"}`}
                onClick={() => setActiveTask(t)}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.resultsMeta}>
          <span style={{ color: "var(--text-muted)", fontSize: "0.875rem" }}>
            {filtered.length} models available
          </span>
        </div>

        <div className={styles.modelsGrid}>
          {filtered.map((m) => (
            <div key={m.id} className={`card card-hover ${styles.modelCard}`}>
              {/* Header */}
              <div className={styles.modelCardTop}>
                <div className={styles.modelOrg}>{m.org}</div>
                {m.popular && <span className="badge badge-blue">Popular</span>}
              </div>

              <h4 className={styles.modelName}>{m.name}</h4>
              <div className={styles.modelTask}>{m.task}</div>

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
                  <span className={styles.creditsValue}>~{m.credits} credits</span>
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
