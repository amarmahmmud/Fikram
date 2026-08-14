"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import styles from "./page.module.css";
import type { Database } from "@/lib/supabase/types";

type Transaction = Database["public"]["Tables"]["credit_transactions"]["Row"];

export default function CreditsPage() {
  const supabase = createClient();
  const [balance, setBalance] = useState<number>(0);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadData() {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        // Fetch profile credits balance
        const { data: profile } = await supabase
          .from("profiles")
          .select("credits_balance")
          .eq("id", user.id)
          .single();

        if (profile) {
          setBalance(profile.credits_balance);
        }

        // Fetch user's credit transactions
        const { data: txs } = await supabase
          .from("credit_transactions")
          .select("*")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false });

        if (txs) {
          setTransactions(txs);
        }
      } catch (err) {
        console.error("Error loading credits:", err);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, [supabase]);

  const total = 100; // Free signup tier quota
  const used = Math.max(0, total - balance);
  const pct = Math.min(100, Math.max(0, Math.round((balance / total) * 100)));

  return (
    <>
      <div className="topbar">
        <span className="topbar-title">Credits & Billing</span>
        <button className="btn btn-primary btn-sm" disabled>
          Buy More Credits <span className="badge badge-default" style={{ fontSize: "0.625rem", marginLeft: 4 }}>Soon</span>
        </button>
      </div>

      <div className="page-content">
        {/* Balance card */}
        <div className={styles.balanceCard}>
          <div className={styles.balanceGlow} />
          <div className={styles.balanceContent}>
            <div>
              <div className={styles.balanceLabel}>Current Balance</div>
              <div className={styles.balanceValue}>{loading ? "..." : balance}</div>
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
              <span className={styles.creditStatLabel}>Initial Free Credits</span>
            </div>
            <div className={styles.creditStat}>
              <span className={styles.creditStatValue} style={{ color: "var(--warning)" }}>{used}</span>
              <span className={styles.creditStatLabel}>Consumed</span>
            </div>
            <div className={styles.creditStat}>
              <span className={styles.creditStatValue} style={{ color: "var(--success)" }}>{balance}</span>
              <span className={styles.creditStatLabel}>Available</span>
            </div>
            <div className={styles.creditStat}>
              <span className={styles.creditStatValue}>~{Math.floor(balance / 28)}</span>
              <span className={styles.creditStatLabel}>Est. Jobs Left</span>
            </div>
          </div>
        </div>

        {/* Credit estimator */}
        <div className={styles.estimatorCard}>
          <h3 className={styles.sectionTitle}>Fine-Tuning Cost Reference</h3>
          <div className={styles.estimatorGrid}>
            {[
              { model: "Llama 3.1 8B Instruct", method: "LoRA", cost: "~28 credits", time: "5–15 min (Modal L4 GPU)" },
              { model: "Mistral 7B Instruct", method: "LoRA", cost: "~25 credits", time: "5–15 min (Modal L4 GPU)" },
              { model: "Phi-3 Mini 3.8B", method: "LoRA", cost: "~15 credits", time: "4–8 min (Modal L4 GPU)" },
              { model: "Gemma 2 9B Instruct", method: "LoRA", cost: "~35 credits", time: "8–20 min (Modal L4 GPU)" },
            ].map((e) => (
              <div key={e.model} className={styles.estimatorRow}>
                <div className={styles.estimatorModel}>{e.model}</div>
                <span className="badge badge-indigo">{e.method}</span>
                <div className={styles.estimatorCost}>{e.cost}</div>
                <div className={styles.estimatorTime}>{e.time}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Transaction History */}
        <div className="card">
          <h3 className={styles.sectionTitle} style={{ marginBottom: 16 }}>Transaction History</h3>
          {transactions.length === 0 ? (
            <div style={{ textAlign: "center", padding: "32px 0", color: "var(--text-muted)", fontSize: "0.875rem" }}>
              No transactions recorded yet.
            </div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Description</th>
                    <th>Type</th>
                    <th>Amount</th>
                    <th>Balance After</th>
                    <th>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.map((tx) => (
                    <tr key={tx.id}>
                      <td style={{ fontWeight: 600, color: "var(--text-primary)" }}>{tx.label}</td>
                      <td>
                        <span className={`badge ${tx.amount > 0 ? "badge-success" : "badge-default"}`}>
                          {tx.type.replace("_", " ").toUpperCase()}
                        </span>
                      </td>
                      <td className="font-mono" style={{ color: tx.amount > 0 ? "var(--success)" : "var(--warning)", fontWeight: 700 }}>
                        {tx.amount > 0 ? `+${tx.amount}` : tx.amount}
                      </td>
                      <td className="font-mono">{tx.balance_after}</td>
                      <td style={{ fontSize: "0.8125rem", color: "var(--text-muted)" }}>
                        {new Date(tx.created_at).toLocaleDateString()} {new Date(tx.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
