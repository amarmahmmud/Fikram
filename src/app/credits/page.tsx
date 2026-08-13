"use client";

import Link from "next/link";
import styles from "./page.module.css";

const TRANSACTIONS = [
  { id: "t1", type: "signup_bonus", label: "Signup Bonus", amount: +100, balance: 100, date: "2026-08-10", ref: "—" },
  { id: "t2", type: "job_consumed", label: "Job: Customer Support Bot", amount: -28, balance: 72, date: "2026-08-12", ref: "j1" },
  { id: "t3", type: "job_consumed", label: "Job: Product Description Writer", amount: -12, balance: 60, date: "2026-08-12", ref: "j2" },
];

export default function CreditsPage() {
  const balance = 72;
  const used = 28;
  const total = 100;
  const pct = Math.round((balance / total) * 100);

  return (
    <>
      <div className="topbar">
        <span className="topbar-title">Credits</span>
        <button className="btn btn-primary btn-sm" disabled>Buy More Credits <span className="badge badge-default" style={{ fontSize: "0.625rem", marginLeft: 4 }}>Soon</span></button>
      </div>

      <div className="page-content">
        {/* Balance card */}
        <div className={styles.balanceCard}>
          <div className={styles.balanceGlow} />
          <div className={styles.balanceContent}>
            <div>
              <div className={styles.balanceLabel}>Current Balance</div>
              <div className={styles.balanceValue}>{balance}</div>
              <div className={styles.balanceUnit}>credits remaining</div>
            </div>
            <div className={styles.balanceChart}>
              <svg viewBox="0 0 120 120" className={styles.radialSvg}>
                <circle cx="60" cy="60" r="50" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="10" />
                <circle
                  cx="60" cy="60" r="50"
                  fill="none"
                  stroke="url(#creditGrad)"
                  strokeWidth="10"
                  strokeDasharray={`${2 * Math.PI * 50}`}
                  strokeDashoffset={`${2 * Math.PI * 50 * (1 - pct / 100)}`}
                  strokeLinecap="round"
                  transform="rotate(-90 60 60)"
                />
                <defs>
                  <linearGradient id="creditGrad" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="#3b82f6" />
                    <stop offset="100%" stopColor="#6366f1" />
                  </linearGradient>
                </defs>
                <text x="60" y="55" textAnchor="middle" fill="white" fontSize="18" fontWeight="800" fontFamily="Inter,sans-serif">{pct}%</text>
                <text x="60" y="72" textAnchor="middle" fill="#52525b" fontSize="9" fontFamily="Inter,sans-serif">remaining</text>
              </svg>
            </div>
          </div>

          <div className={styles.creditStats}>
            <div className={styles.creditStat}>
              <span className={styles.creditStatValue}>{total}</span>
              <span className={styles.creditStatLabel}>Total received</span>
            </div>
            <div className={styles.creditStat}>
              <span className={styles.creditStatValue} style={{ color: "var(--warning)" }}>{used}</span>
              <span className={styles.creditStatLabel}>Used</span>
            </div>
            <div className={styles.creditStat}>
              <span className={styles.creditStatValue} style={{ color: "var(--success)" }}>{balance}</span>
              <span className={styles.creditStatLabel}>Remaining</span>
            </div>
            <div className={styles.creditStat}>
              <span className={styles.creditStatValue}>~2–3</span>
              <span className={styles.creditStatLabel}>Jobs left</span>
            </div>
          </div>
        </div>

        {/* Credit estimator */}
        <div className={styles.estimatorCard}>
          <h3 className={styles.sectionTitle}>Credit Cost Estimator</h3>
          <div className={styles.estimatorGrid}>
            {[
              { model: "Phi-3 Mini 3.8B", method: "LoRA", cost: "8–18 credits", time: "5–10 min" },
              { model: "Mistral 7B", method: "LoRA", cost: "15–35 credits", time: "10–20 min" },
              { model: "Llama 3.1 8B", method: "LoRA", cost: "20–40 credits", time: "12–25 min" },
              { model: "Gemma 2 9B", method: "LoRA", cost: "25–50 credits", time: "18–35 min" },
            ].map((e) => (
              <div key={e.model} className={styles.estimatorRow}>
                <div className={styles.estimatorModel}>{e.model}</div>
                <span className="badge badge-indigo">{e.method}</span>
                <div className={styles.estimatorCost}>{e.cost}</div>
                <div className={styles.estimatorTime}>~{e.time}</div>
              </div>
            ))}
          </div>
          <p className={styles.estimatorNote}>
            * Costs vary based on dataset size, epochs, and batch size. The AI wizard shows exact estimates before launching.
          </p>
        </div>

        {/* Transactions */}
        <div className={styles.sectionHead}>
          <h3 className={styles.sectionTitle}>Transaction History</h3>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Description</th>
                <th>Date</th>
                <th>Amount</th>
                <th>Balance After</th>
                <th>Reference</th>
              </tr>
            </thead>
            <tbody>
              {TRANSACTIONS.map((t) => (
                <tr key={t.id}>
                  <td style={{ fontWeight: 600, color: "var(--text-primary)" }}>{t.label}</td>
                  <td>{t.date}</td>
                  <td>
                    <span style={{ color: t.amount > 0 ? "var(--success)" : "var(--warning)", fontFamily: "var(--font-mono)", fontWeight: 700 }}>
                      {t.amount > 0 ? "+" : ""}{t.amount}
                    </span>
                  </td>
                  <td className="font-mono">{t.balance}</td>
                  <td>
                    {t.ref !== "—" ? (
                      <Link href={`/jobs/${t.ref}`} className="btn btn-ghost btn-sm" style={{ fontSize: "0.75rem" }}>
                        View Job →
                      </Link>
                    ) : <span style={{ color: "var(--text-muted)" }}>—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Upgrade teaser */}
        <div className={styles.upgradeBanner}>
          <div>
            <div style={{ fontWeight: 700, fontSize: "1rem", marginBottom: 4 }}>Need more credits?</div>
            <div style={{ fontSize: "0.875rem", color: "var(--text-muted)" }}>
              Paid plans with monthly credit bundles are coming soon. Early users get priority access and discounts.
            </div>
          </div>
          <button className="btn btn-secondary btn-sm" disabled>Get Notified</button>
        </div>
      </div>
    </>
  );
}
