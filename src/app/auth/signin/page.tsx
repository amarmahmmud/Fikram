"use client";

import Link from "next/link";
import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { FikraLogo } from "@/components/FikraLogo";
import styles from "../auth.module.css";
import { AlertTriangle } from "lucide-react";

function SignInForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get("redirectTo") ?? "/dashboard";
  const supabase = createClient();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [forgotMode, setForgotMode] = useState(false);
  const [resetEmail, setResetEmail] = useState("");
  const [resetLoading, setResetLoading] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const [resetError, setResetError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const { error: err } = await supabase.auth.signInWithPassword({ email, password });
    if (err) {
      setError(err.message);
      setLoading(false);
    } else {
      router.push(redirectTo);
      router.refresh();
    }
  }

  async function handleResetPassword(e: React.FormEvent) {
    e.preventDefault();
    setResetLoading(true);
    setResetError("");
    setResetSent(false);
    const targetEmail = (resetEmail || email).trim();
    if (!targetEmail) {
      setResetError("Please enter your email address.");
      setResetLoading(false);
      return;
    }
    const { error: err } = await supabase.auth.resetPasswordForEmail(targetEmail, {
      redirectTo: `${window.location.origin}/settings`,
    });
    if (err) {
      setResetError(err.message);
      setResetLoading(false);
    } else {
      setResetSent(true);
      setResetLoading(false);
    }
  }

  async function handleGoogle() {
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback?next=${redirectTo}` },
    });
  }

  return (
    <div className={styles.authPage}>
      <div className={styles.authGlow} />
      <div className={styles.authGrid} />

      <div className={styles.authCard}>
        <Link href="/">
          <FikraLogo size={36} showText className={styles.authLogo} />
        </Link>

        {forgotMode ? (
          <>
            <div className={styles.authHead}>
              <h1 className={styles.authTitle}>Reset password</h1>
              <p className={styles.authSub}>Enter your email to receive a password reset link</p>
            </div>

            {resetError && (
              <div className={styles.errorBox} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <AlertTriangle size={16} /> {resetError}
              </div>
            )}

            {resetSent ? (
              <div style={{ textAlign: "center", padding: "16px 0" }}>
                <div style={{ color: "var(--success)", fontSize: "0.9375rem", fontWeight: 600, marginBottom: 8 }}>
                  Reset link sent!
                </div>
                <p style={{ color: "var(--text-secondary)", fontSize: "0.875rem", lineHeight: 1.6, marginBottom: 20 }}>
                  We sent a recovery link to <strong>{resetEmail || email}</strong>. Check your inbox and spam folder.
                </p>
                <button
                  type="button"
                  className="btn btn-secondary w-full"
                  onClick={() => {
                    setForgotMode(false);
                    setResetSent(false);
                    setResetError("");
                  }}
                >
                  Back to Sign In
                </button>
              </div>
            ) : (
              <form onSubmit={handleResetPassword} className={styles.form}>
                <div className="input-group">
                  <label htmlFor="reset-email" className="input-label">Account email</label>
                  <input
                    id="reset-email"
                    type="email"
                    className="input"
                    placeholder="you@example.com"
                    value={resetEmail}
                    onChange={(e) => setResetEmail(e.target.value)}
                    required
                    autoComplete="email"
                  />
                </div>

                <button
                  type="submit"
                  className="btn btn-primary w-full"
                  disabled={resetLoading}
                  style={{ marginTop: 8 }}
                >
                  {resetLoading ? "Sending link..." : "Send Reset Link"}
                </button>

                <button
                  type="button"
                  className="btn btn-ghost w-full"
                  onClick={() => {
                    setForgotMode(false);
                    setResetError("");
                  }}
                  style={{ fontSize: "0.875rem", color: "var(--text-muted)" }}
                >
                  ← Back to Sign In
                </button>
              </form>
            )}
          </>
        ) : (
          <>
            <div className={styles.authHead}>
              <h1 className={styles.authTitle}>Welcome back</h1>
              <p className={styles.authSub}>Sign in to your Fikram account</p>
            </div>

            <button id="google-signin-btn" className={styles.oauthBtn} type="button" onClick={handleGoogle}>
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
                <path d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332C2.438 15.983 5.482 18 9 18z" fill="#34A853"/>
                <path d="M3.964 10.707c-.18-.54-.282-1.117-.282-1.707s.102-1.167.282-1.707V4.961H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.039l3.007-2.332z" fill="#FBBC05"/>
                <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.482 0 2.438 2.017.957 4.961L3.964 6.293C4.672 4.166 6.656 3.58 9 3.58z" fill="#EA4335"/>
              </svg>
              Continue with Google
            </button>

            <div className={styles.dividerRow}>
              <div className={styles.dividerLine} />
              <span className={styles.dividerText}>or</span>
              <div className={styles.dividerLine} />
            </div>

            {error && <div className={styles.errorBox} style={{ display: 'flex', alignItems: 'center', gap: 6 }}><AlertTriangle size={16} /> {error}</div>}

            <form onSubmit={handleSubmit} className={styles.form}>
              <div className="input-group">
                <label htmlFor="signin-email" className="input-label">Email address</label>
                <input id="signin-email" type="email" className="input" placeholder="you@example.com"
                  value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
              </div>

              <div className="input-group">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <label htmlFor="signin-password" className="input-label">Password</label>
                  <button
                    type="button"
                    onClick={() => {
                      setForgotMode(true);
                      setResetEmail(email);
                      setError("");
                    }}
                    className={styles.forgotLink}
                    style={{ background: "none", border: "none", cursor: "pointer", padding: 0 }}
                  >
                    Forgot password?
                  </button>
                </div>
                <input id="signin-password" type="password" className="input" placeholder="••••••••"
                  value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
              </div>

              <button id="signin-submit-btn" type="submit" className="btn btn-primary w-full" disabled={loading} style={{ marginTop: 8 }}>
                {loading
                  ? <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span className="animate-spin" style={{ width: 14, height: 14, border: "2px solid rgba(255,255,255,0.3)", borderTopColor: "white", borderRadius: "50%", display: "inline-block" }} />
                      Signing in...
                    </span>
                  : "Sign In"}
              </button>
            </form>

            <p className={styles.authSwitch}>
              Don&apos;t have an account?{" "}
              <Link href="/auth/signup" className={styles.authSwitchLink}>Sign up free</Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
}

export default function SignInPage() {
  return (
    <Suspense fallback={
      <div className={styles.authPage}>
        <div className={styles.authCard} style={{ textAlign: "center", padding: "60px 20px" }}>
          <div className="spinner" style={{ margin: "0 auto 16px" }} />
          <p style={{ color: "var(--text-muted)", fontSize: "0.875rem" }}>Loading sign in...</p>
        </div>
      </div>
    }>
      <SignInForm />
    </Suspense>
  );
}

