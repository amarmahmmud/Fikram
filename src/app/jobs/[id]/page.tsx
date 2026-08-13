"use client";

import Link from "next/link";
import { useState, useEffect, use } from "react";
import styles from "./page.module.css";

/* ── Mock data ── */
const JOB = {
  id: "j1",
  name: "Customer Support Bot",
  status: "completed",
  baseModel: "meta-llama/Llama-3.1-8B-Instruct",
  baseModelLabel: "Llama 3.1 8B",
  method: "LoRA",
  datasetFile: "support_qa_dataset.jsonl",
  datasetRows: 1240,
  epochs: 3,
  learningRate: 0.0002,
  batchSize: 4,
  creditsUsed: 28,
  startedAt: "2026-08-12 07:30:00",
  completedAt: "2026-08-12 07:44:32",
  durationMin: 14,
};

const LOGS = [
  { type: "info", text: "Initializing training environment..." },
  { type: "success", text: "Dataset loaded: 1,240 rows validated ✓" },
  { type: "info", text: "Base model: meta-llama/Llama-3.1-8B-Instruct" },
  { type: "info", text: "Method: LoRA | Rank: 16 | Alpha: 32" },
  { type: "dim", text: "Loading model weights..." },
  { type: "dim", text: "Initializing LoRA adapters..." },
  { type: "info", text: "Training started — Epoch 1/3" },
  { type: "dim", text: "  Step  10/310 | Loss: 1.842 | LR: 1.8e-4" },
  { type: "dim", text: "  Step  50/310 | Loss: 1.421 | LR: 2.0e-4" },
  { type: "dim", text: "  Step 100/310 | Loss: 1.187 | LR: 1.9e-4" },
  { type: "info", text: "Epoch 1 complete | avg loss: 1.42 | val loss: 1.38" },
  { type: "info", text: "Training started — Epoch 2/3" },
  { type: "dim", text: "  Step 160/310 | Loss: 0.921 | LR: 1.7e-4" },
  { type: "dim", text: "  Step 210/310 | Loss: 0.854 | LR: 1.5e-4" },
  { type: "info", text: "Epoch 2 complete | avg loss: 0.87 | val loss: 0.82" },
  { type: "info", text: "Training started — Epoch 3/3" },
  { type: "dim", text: "  Step 260/310 | Loss: 0.643 | LR: 1.0e-4" },
  { type: "dim", text: "  Step 310/310 | Loss: 0.608 | LR: 5.0e-5" },
  { type: "info", text: "Epoch 3 complete | avg loss: 0.61 | val loss: 0.59" },
  { type: "success", text: "Training complete! Final loss: 0.608 ✓" },
  { type: "success", text: "Saving LoRA adapter weights..." },
  { type: "success", text: "Model uploaded to storage ✓" },
  { type: "success", text: "Job completed successfully in 14m 32s ✓" },
];

const LOSS_POINTS = [1.842, 1.421, 1.187, 1.02, 0.921, 0.854, 0.72, 0.643, 0.608];

export default function JobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => setProgress(100), 300);
    return () => clearTimeout(t);
  }, []);

  const maxLoss = Math.max(...LOSS_POINTS);
  const chartH = 100;

  return (
    <>
      <div className="topbar">
        <Link href="/jobs" className="btn btn-ghost btn-sm">← Jobs</Link>
        <span className="topbar-title" style={{ flex: 1, textAlign: "center" }}>
          {JOB.name}
        </span>
        <span className="badge badge-success">
          <span className="status-dot done" />
          Completed
        </span>
      </div>

      <div className="page-content">
        {/* Header row */}
        <div className={styles.headerRow}>
          <div>
            <h2 className={styles.jobTitle}>{JOB.name}</h2>
            <p className={styles.jobMeta}>
              Job <span className="font-mono">#{resolvedParams.id}</span>
              &nbsp;·&nbsp;Started {JOB.startedAt}
              &nbsp;·&nbsp;Completed {JOB.completedAt}
            </p>
          </div>
          <div className={styles.headerActions}>
            <Link href={`/playground/${resolvedParams.id}`} className="btn btn-secondary btn-sm">
              ▷ Test in Playground
            </Link>
            <button className="btn btn-primary btn-sm">↓ Download Weights</button>
          </div>
        </div>

        <div className={styles.grid}>
          {/* Left col */}
          <div className={styles.leftCol}>
            {/* Progress */}
            <div className="card">
              <div className={styles.cardHead}>
                <span className={styles.cardTitle}>Training Progress</span>
                <span className="font-mono" style={{ fontSize: "0.8125rem", color: "var(--success)" }}>100%</span>
              </div>
              <div className="progress-bar" style={{ marginTop: 12 }}>
                <div className="progress-fill" style={{ width: `${progress}%` }} />
              </div>
              <div className={styles.progressMeta}>
                <span>310 / 310 steps</span>
                <span>{JOB.durationMin} min 32s</span>
              </div>
            </div>

            {/* Loss chart */}
            <div className="card">
              <div className={styles.cardHead}>
                <span className={styles.cardTitle}>Loss Curve</span>
                <span className="badge badge-success">Converged</span>
              </div>
              <div className={styles.chart}>
                <svg viewBox={`0 0 ${LOSS_POINTS.length * 40} ${chartH + 20}`} className={styles.chartSvg}>
                  {/* Grid lines */}
                  {[0.25, 0.5, 0.75].map((pct) => (
                    <line
                      key={pct}
                      x1="0" y1={chartH * pct}
                      x2={LOSS_POINTS.length * 40} y2={chartH * pct}
                      stroke="rgba(255,255,255,0.04)" strokeWidth="1"
                    />
                  ))}
                  {/* Gradient fill */}
                  <defs>
                    <linearGradient id="lossGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#6366f1" stopOpacity="0.3" />
                      <stop offset="100%" stopColor="#6366f1" stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  <polygon
                    points={[
                      ...LOSS_POINTS.map((v, i) => `${i * 40 + 20},${chartH - (v / maxLoss) * chartH}`),
                      `${(LOSS_POINTS.length - 1) * 40 + 20},${chartH}`,
                      `20,${chartH}`,
                    ].join(" ")}
                    fill="url(#lossGrad)"
                  />
                  <polyline
                    points={LOSS_POINTS.map((v, i) => `${i * 40 + 20},${chartH - (v / maxLoss) * chartH}`).join(" ")}
                    fill="none"
                    stroke="#6366f1"
                    strokeWidth="2"
                    strokeLinejoin="round"
                  />
                  {LOSS_POINTS.map((v, i) => (
                    <circle
                      key={i}
                      cx={i * 40 + 20}
                      cy={chartH - (v / maxLoss) * chartH}
                      r="3"
                      fill="#6366f1"
                    />
                  ))}
                </svg>
                <div className={styles.chartLabels}>
                  <span>Epoch 1</span>
                  <span>Epoch 2</span>
                  <span>Epoch 3</span>
                </div>
              </div>
            </div>

            {/* Live logs */}
            <div className="terminal">
              <div className="terminal-header">
                <div className="terminal-dot red" />
                <div className="terminal-dot yellow" />
                <div className="terminal-dot green" />
                <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginLeft: 8, fontFamily: "var(--font-mono)" }}>
                  training.log
                </span>
                <span className="badge badge-success" style={{ marginLeft: "auto", fontSize: "0.625rem" }}>● Completed</span>
              </div>
              <div className="terminal-body">
                {LOGS.map((l, i) => (
                  <span key={i} className={`terminal-line ${l.type}`}>{l.text}</span>
                ))}
              </div>
            </div>
          </div>

          {/* Right col */}
          <div className={styles.rightCol}>
            {/* Config */}
            <div className="card">
              <span className={styles.cardTitle} style={{ display: "block", marginBottom: 16 }}>Configuration</span>
              {[
                ["Base Model", JOB.baseModelLabel],
                ["Method", JOB.method],
                ["Epochs", JOB.epochs],
                ["Learning Rate", JOB.learningRate],
                ["Batch Size", JOB.batchSize],
                ["Dataset", JOB.datasetFile],
                ["Dataset Rows", JOB.datasetRows.toLocaleString()],
                ["Credits Used", `${JOB.creditsUsed} credits`],
              ].map(([label, value]) => (
                <div key={String(label)} className={styles.configRow}>
                  <span className={styles.configLabel}>{label}</span>
                  <span className={styles.configValue}>{String(value)}</span>
                </div>
              ))}
            </div>

            {/* Actions */}
            <div className="card">
              <span className={styles.cardTitle} style={{ display: "block", marginBottom: 16 }}>Actions</span>
              <div className={styles.actionsList}>
                <button id="download-weights-btn" className="btn btn-secondary w-full">
                  ↓ Download Adapter Weights (.safetensors)
                </button>
                <Link href={`/playground/${resolvedParams.id}`} className="btn btn-secondary w-full" style={{ textAlign: "center" }}>
                  ▷ Open in Playground
                </Link>
                <button id="deploy-model-btn" className="btn btn-primary w-full">
                  🚢 Deploy as API Endpoint
                  <span className="badge badge-default" style={{ fontSize: "0.625rem", marginLeft: 4 }}>Soon</span>
                </button>
                <button id="retry-job-btn" className="btn btn-ghost w-full" style={{ color: "var(--text-muted)" }}>
                  ↺ Fine-Tune Again (new version)
                </button>
              </div>
            </div>

            {/* Metrics */}
            <div className="card">
              <span className={styles.cardTitle} style={{ display: "block", marginBottom: 16 }}>Final Metrics</span>
              {[
                { label: "Final Train Loss", value: "0.608", color: "var(--success)" },
                { label: "Final Val Loss", value: "0.590", color: "var(--success)" },
                { label: "Total Steps", value: "310", color: "var(--text-primary)" },
                { label: "Duration", value: "14m 32s", color: "var(--text-primary)" },
              ].map((m) => (
                <div key={m.label} className={styles.configRow}>
                  <span className={styles.configLabel}>{m.label}</span>
                  <span className={styles.configValue} style={{ color: m.color, fontWeight: 700 }}>{m.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
