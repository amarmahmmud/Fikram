"use client";

import { useState } from "react";
import styles from "./page.module.css";

export default function SettingsPage() {
  const [name, setName] = useState("Jane Smith");
  const [email] = useState("jane@example.com");
  const [notify, setNotify] = useState({ jobComplete: true, jobFailed: true, credits: false });
  const [saved, setSaved] = useState(false);

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  }

  return (
    <>
      <div className="topbar">
        <span className="topbar-title">Settings</span>
      </div>

      <div className="page-content" style={{ maxWidth: 680 }}>

        {saved && (
          <div className={styles.savedBanner}>
            ✓ Settings saved successfully
          </div>
        )}

        {/* Profile */}
        <form onSubmit={handleSave} className={styles.section}>
          <div className={styles.sectionHead}>
            <h3 className={styles.sectionTitle}>Profile</h3>
            <p className={styles.sectionDesc}>Update your display name and account info.</p>
          </div>

          <div className={styles.avatarRow}>
            <div className={styles.avatar}>JS</div>
            <div>
              <button type="button" className="btn btn-secondary btn-sm">Change Avatar</button>
              <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: 4 }}>JPG, PNG up to 2MB</p>
            </div>
          </div>

          <div className={styles.formGrid}>
            <div className="input-group">
              <label htmlFor="settings-name" className="input-label">Full Name</label>
              <input
                id="settings-name"
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="input-group">
              <label htmlFor="settings-email" className="input-label">Email Address</label>
              <input
                id="settings-email"
                className="input"
                value={email}
                disabled
                style={{ opacity: 0.5, cursor: "not-allowed" }}
              />
              <span className="input-hint">Email cannot be changed after signup</span>
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button id="save-profile-btn" type="submit" className="btn btn-primary btn-sm">Save Profile</button>
          </div>
        </form>

        <hr className="divider" />

        {/* Notifications */}
        <div className={styles.section}>
          <div className={styles.sectionHead}>
            <h3 className={styles.sectionTitle}>Notifications</h3>
            <p className={styles.sectionDesc}>Choose what events send you an email notification.</p>
          </div>

          {[
            { key: "jobComplete" as keyof typeof notify, label: "Job Completed", desc: "Email when a fine-tuning job finishes successfully" },
            { key: "jobFailed"   as keyof typeof notify, label: "Job Failed",    desc: "Email when a job fails with an error" },
            { key: "credits"     as keyof typeof notify, label: "Low Credits",   desc: "Email when your credit balance drops below 10" },
          ].map((n) => (
            <div key={n.key} className={styles.toggleRow}>
              <div>
                <div className={styles.toggleLabel}>{n.label}</div>
                <div className={styles.toggleDesc}>{n.desc}</div>
              </div>
              <button
                id={`notify-${n.key}-btn`}
                role="switch"
                aria-checked={notify[n.key]}
                className={`${styles.toggle} ${notify[n.key] ? styles.toggleOn : ""}`}
                onClick={() => setNotify((prev) => ({ ...prev, [n.key]: !prev[n.key] }))}
              >
                <span className={styles.toggleThumb} />
              </button>
            </div>
          ))}
        </div>

        <hr className="divider" />

        {/* API / Integrations */}
        <div className={styles.section}>
          <div className={styles.sectionHead}>
            <h3 className={styles.sectionTitle}>API Access</h3>
            <p className={styles.sectionDesc}>Use your Model Factory credentials in external apps and scripts.</p>
          </div>

          <div className={styles.apiKeyCard}>
            <div className={styles.apiKeyLabel}>Your API Key</div>
            <div className={styles.apiKeyRow}>
              <code className={styles.apiKey}>mf_sk_••••••••••••••••••••••••••••••••</code>
              <button className="btn btn-secondary btn-sm" disabled>Copy</button>
              <button className="btn btn-ghost btn-sm" disabled>Regenerate</button>
            </div>
            <p style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
              API access is available on paid plans. Coming soon.
            </p>
          </div>
        </div>

        <hr className="divider" />

        {/* Danger Zone */}
        <div className={`${styles.section} ${styles.dangerSection}`}>
          <div className={styles.sectionHead}>
            <h3 className={styles.sectionTitle} style={{ color: "var(--error)" }}>Danger Zone</h3>
            <p className={styles.sectionDesc}>These actions are permanent and cannot be undone.</p>
          </div>

          <div className={styles.dangerRow}>
            <div>
              <div className={styles.toggleLabel}>Delete all model weights</div>
              <div className={styles.toggleDesc}>Permanently delete all stored adapter files and results.</div>
            </div>
            <button id="delete-weights-btn" className="btn btn-danger btn-sm">Delete All Weights</button>
          </div>

          <div className={styles.dangerRow} style={{ marginTop: 12 }}>
            <div>
              <div className={styles.toggleLabel}>Delete Account</div>
              <div className={styles.toggleDesc}>Permanently delete your account and all associated data.</div>
            </div>
            <button id="delete-account-btn" className="btn btn-danger btn-sm">Delete Account</button>
          </div>
        </div>

      </div>
    </>
  );
}
