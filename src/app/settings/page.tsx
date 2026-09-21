"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import styles from "./page.module.css";
import { CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

export default function SettingsPage() {
  const supabase = createClient();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [notify, setNotify] = useState({ jobComplete: true, jobFailed: true, credits: false });
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  // Password state
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordSuccess, setPasswordSuccess] = useState(false);
  const [passwordError, setPasswordError] = useState("");

  useEffect(() => { document.title = "Settings — Fikram"; }, []);

  useEffect(() => {
    async function loadProfile() {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          setEmail(user.email || "");
          const { data: profile } = await supabase
            .from("profiles")
            .select("full_name")
            .eq("id", user.id)
            .single();

          if (profile?.full_name) {
            setName(profile.full_name);
          } else {
            setName(user.email?.split("@")[0] || "");
          }
        }
      } catch (err) {
        console.error("Error loading profile:", err);
      } finally {
        setLoading(false);
      }
    }
    loadProfile();
  }, [supabase]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await supabase
          .from("profiles")
          .update({ full_name: name })
          .eq("id", user.id);

        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
      }
    } catch (err) {
      console.error("Error saving profile:", err);
      toast.error("Failed to save settings. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdatePassword(e: React.FormEvent) {
    e.preventDefault();
    setPasswordError("");
    setPasswordSuccess(false);

    if (newPassword.length < 8) {
      setPasswordError("Password must be at least 8 characters long.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError("Passwords do not match.");
      return;
    }

    setPasswordSaving(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) {
        setPasswordError(error.message);
      } else {
        setPasswordSuccess(true);
        setNewPassword("");
        setConfirmPassword("");
        toast.success("Password updated successfully");
        setTimeout(() => setPasswordSuccess(false), 4000);
      }
    } catch (err: any) {
      setPasswordError(err?.message || "Failed to update password.");
    } finally {
      setPasswordSaving(false);
    }
  }

  const initials = name
    ? name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2)
    : "AI";

  return (
    <>
      <div className="topbar">
        <span className="topbar-title">Settings</span>
      </div>

      <div className="page-content" style={{ maxWidth: 680 }}>
        {saved && (
          <div className={styles.savedBanner} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <CheckCircle2 size={16} />
            <span>Profile saved successfully</span>
          </div>
        )}

        {/* Profile */}
        <form onSubmit={handleSave} className={styles.section}>
          <div className={styles.sectionHead}>
            <h3 className={styles.sectionTitle}>Profile</h3>
            <p className={styles.sectionDesc}>Update your display name and account info.</p>
          </div>

          <div className={styles.avatarRow}>
            <div className={styles.avatar}>{initials}</div>
            <div>
              <div style={{ fontWeight: 600, fontSize: "0.875rem" }}>{name || "User"}</div>
              <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: 4 }}>
                {email || "Account member"}
              </p>
            </div>
          </div>

          <div className={styles.formGrid}>
            <div className="input-group">
              <label htmlFor="settings-name" className="input-label">Full Name</label>
              <input
                id="settings-name"
                className="input"
                value={name}
                disabled={loading}
                onChange={(e) => setName(e.target.value)}
                placeholder="Enter your name"
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
              <span className="input-hint">Email is linked to your authentication account</span>
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button id="save-profile-btn" type="submit" disabled={saving || loading} className="btn btn-primary btn-sm">
              {saving ? "Saving..." : "Save Profile"}
            </button>
          </div>
        </form>

        <hr className="divider" />

        {/* Security & Password */}
        <form onSubmit={handleUpdatePassword} className={styles.section}>
          <div className={styles.sectionHead}>
            <h3 className={styles.sectionTitle}>Security & Password</h3>
            <p className={styles.sectionDesc}>Update your account password.</p>
          </div>

          {passwordSuccess && (
            <div className={styles.savedBanner} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
              <CheckCircle2 size={16} />
              <span>Password updated successfully!</span>
            </div>
          )}

          {passwordError && (
            <div style={{
              background: "rgba(239, 68, 68, 0.1)",
              border: "1px solid rgba(239, 68, 68, 0.25)",
              borderRadius: "var(--radius-md)",
              padding: "10px 14px",
              color: "#FCA5A5",
              fontSize: "0.8125rem",
              marginBottom: 16,
            }}>
              {passwordError}
            </div>
          )}

          <div className={styles.formGrid}>
            <div className="input-group">
              <label htmlFor="settings-new-password" className="input-label">New Password</label>
              <input
                id="settings-new-password"
                type="password"
                className="input"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="At least 8 characters"
                minLength={8}
                autoComplete="new-password"
              />
            </div>
            <div className="input-group">
              <label htmlFor="settings-confirm-password" className="input-label">Confirm Password</label>
              <input
                id="settings-confirm-password"
                type="password"
                className="input"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Re-enter new password"
                minLength={8}
                autoComplete="new-password"
              />
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
            <button
              id="update-password-btn"
              type="submit"
              disabled={passwordSaving || !newPassword || !confirmPassword}
              className="btn btn-secondary btn-sm"
            >
              {passwordSaving ? "Updating..." : "Update Password"}
            </button>
          </div>
        </form>

        <hr className="divider" />

        {/* Notifications */}
        <div className={styles.section}>
          <div className={styles.sectionHead}>
            <h3 className={styles.sectionTitle}>
              Notifications
              <span style={{ marginLeft: 8, fontSize: "0.625rem", fontWeight: 600, padding: "2px 8px", borderRadius: 100, background: "linear-gradient(135deg, rgba(245,158,11,0.12), rgba(249,115,22,0.08))", border: "1px solid rgba(245,158,11,0.2)", color: "#F59E0B", textTransform: "uppercase", letterSpacing: "0.5px", verticalAlign: "middle" }}>Coming Soon</span>
            </h3>
            <p className={styles.sectionDesc}>Email notifications are coming soon. Toggle your preferences now and we&apos;ll enable them when ready.</p>
          </div>

          {[
            { key: "jobComplete" as keyof typeof notify, label: "Job Completed", desc: "Notification when a training job finishes successfully" },
            { key: "jobFailed"   as keyof typeof notify, label: "Job Failed",    desc: "Notification when a job encounters a training error" },
            { key: "credits"     as keyof typeof notify, label: "Low Credits",   desc: "Notification when your credit balance drops below 20" },
          ].map((n) => (
            <div key={n.key} className={styles.toggleRow}>
              <div>
                <div className={styles.toggleLabel}>{n.label}</div>
                <div className={styles.toggleDesc}>{n.desc}</div>
              </div>
              <button
                id={`notify-${n.key}-btn`}
                type="button"
                role="switch"
                aria-checked={notify[n.key]}
                className={`${styles.toggle} ${notify[n.key] ? styles.toggleOn : ""}`}
                onClick={() => setNotify((prev) => ({ ...prev, [n.key]: !prev[n.key] }))}
              >
                <span className={styles.toggleKnob} />
              </button>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
