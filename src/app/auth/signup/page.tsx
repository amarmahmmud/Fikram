"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { FikraLogo } from "@/components/FikraLogo";
import styles from "../auth.module.css";
import { CheckCircle, Gift, AlertTriangle } from "lucide-react";

export default function SignUpPage() {
  const router = useRouter();
  const supabase = createClient();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const { error: err } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: name } },
    });
    if (err) {
      setError(err.message);
      setLoading(false);
    } else {
      setSuccess(true);
      setTimeout(() => router.push("/dashboard"), 2000);
    }
  }

  async function handleGoogle() {
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback?next=/dashboard` },
    });
  }

  if (success) {
    return (
      <div className={styles.authPage}>
        <div className={styles.authGlow} />
        <div className={styles.authCard} style={{ textAlign: "center" }}>
          <CheckCircle size={48} color="var(--success)" style={{ marginBottom: 16, display: 'inline-block' }} />
          <h2 style={{ marginBottom: 8 }}>Account Created!</h2>
          <p style={{ color: "var(--text-secondary)", fontSize: "0.9375rem" }}>
            You&apos;ve received <strong style={{ color: "var(--success)" }}>50 free credits</strong>.
            Redirecting to your dashboard...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.authPage}>
      <div className={styles.authGlow} />
      <div className={styles.authGrid} />

      <div className={styles.authCard}>
        <Link href="/">
          <FikraLogo size={36} showText className={styles.authLogo} />
        </Link>

        <div className={styles.authHead}>
          <h1 className={styles.authTitle}>Create your account</h1>
          <p className={styles.authSub}>
            Get started with <strong>50 free credits</strong> — no card required
          </p>
        </div>

        <div className={styles.promoBadge}>
          <span className={styles.promoBadgeIcon}><Gift size={20} /></span>
          <div>
            <div className={styles.promoBadgeTitle}>50 Free Credits on Signup</div>
            <div className={styles.promoBadgeSub}>Enough to fine-tune 2–3 real AI models</div>
          </div>
        </div>

        <button id="google-signup-btn" className={styles.oauthBtn} type="button" onClick={handleGoogle}>
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
            <label htmlFor="signup-name" className="input-label">Full name</label>
            <input id="signup-name" type="text" className="input" placeholder="Jane Smith"
              value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" />
          </div>
          <div className="input-group">
            <label htmlFor="signup-email" className="input-label">Email address</label>
            <input id="signup-email" type="email" className="input" placeholder="you@example.com"
              value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
          </div>
          <div className="input-group">
            <label htmlFor="signup-password" className="input-label">Password</label>
            <input id="signup-password" type="password" className="input" placeholder="At least 8 characters"
              value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} autoComplete="new-password" />
          </div>

          <button id="signup-submit-btn" type="submit" className="btn btn-primary w-full" disabled={loading} style={{ marginTop: 8 }}>
            {loading
              ? <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span className="animate-spin" style={{ width: 14, height: 14, border: "2px solid rgba(255,255,255,0.3)", borderTopColor: "white", borderRadius: "50%", display: "inline-block" }} />
                  Creating account...
                </span>
              : "Create Free Account →"}
          </button>
        </form>

        <p className={styles.authTerms}>
          By signing up you agree to our <a href="#" className={styles.authSwitchLink}>Terms</a> and <a href="#" className={styles.authSwitchLink}>Privacy Policy</a>.
        </p>
        <p className={styles.authSwitch}>
          Already have an account?{" "}
          <Link href="/auth/signin" className={styles.authSwitchLink}>Sign in</Link>
        </p>
      </div>
    </div>
  );
}
