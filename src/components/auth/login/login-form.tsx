"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { SessionUser } from "@/stores/auth-store";

// Convenience only: the username, never the password and never a token. Session
// lifetime is owned entirely by the server (HttpOnly cookie, absolute + idle TTL).
const REMEMBERED_USERNAME = "dp_remembered_username";

const FIELD = "h-[48px] rounded-xl border-border bg-background/60 hover:bg-background focus:bg-background px-4 text-sm text-foreground placeholder:text-muted-foreground/70 focus:border-[#F9733E] focus-visible:ring-2 focus-visible:ring-[#F9733E]/20 shadow-none transition-all";

function readRemembered(): string {
  try {
    return localStorage.getItem(REMEMBERED_USERNAME) ?? "";
  } catch {
    return ""; // private mode / blocked storage
  }
}

function writeRemembered(value: string | null) {
  try {
    if (value) localStorage.setItem(REMEMBERED_USERNAME, value);
    else localStorage.removeItem(REMEMBERED_USERNAME);
  } catch {
    // storage unavailable — remembering is optional, never block sign-in
  }
}

export function LoginForm({ onAuthenticated, onRequestAccess }: { onAuthenticated: (user: SessionUser) => void; onRequestAccess: () => void }) {
  const [username, setUsername] = useState(() => (typeof window !== "undefined" ? readRemembered() ?? "" : ""));
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(() => (typeof window !== "undefined" ? !!readRemembered() : false));
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ username?: string; password?: string }>({});
  const [showRecovery, setShowRecovery] = useState(false);
  const usernameRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting) return; // guard against double submit

    // Client validation is a usability aid only; the server revalidates everything.
    const next: { username?: string; password?: string } = {};
    if (!username.trim()) next.username = "Enter your username.";
    if (!password) next.password = "Enter your password.";
    setFieldErrors(next);
    if (next.username || next.password) {
      setError(null);
      (next.username ? usernameRef : passwordRef).current?.focus();
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ username: username.trim(), password }),
      });
      const data = await res.json().catch(() => null);

      if (!res.ok) {
        // Deliberately generic: never reveal whether the account exists, is
        // locked or is disabled. Rate-limit and maintenance responses are safe
        // to surface because they say nothing about the account.
        if (res.status === 401) setError("Unable to sign in with the provided credentials.");
        else if (res.status === 429) setError(data?.error?.message ?? "Too many attempts. Try again shortly.");
        else if (res.status >= 500) setError("ERP access is temporarily unavailable. Try again shortly.");
        else setError(data?.error?.message ?? "Unable to sign in with the provided credentials.");
        setPassword("");
        passwordRef.current?.focus();
        return;
      }

      writeRemembered(remember ? username.trim() : null);
      setPassword(""); // drop the secret from component state immediately
      onAuthenticated(data.user as SessionUser);
    } catch {
      setError("Unable to reach the server. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate className="w-full max-w-[460px] bg-card p-6 sm:p-8 rounded-2xl border border-border/80 shadow-2xs">
      <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">Welcome Back</h2>
      <p className="mt-1.5 text-xs sm:text-sm text-muted-foreground">Sign in to access your ERP workspace.</p>

      {/* Server-side failures. aria-live so screen readers hear it without focus moving. */}
      {error && (
        <p
          role="alert"
          className="mt-5 rounded-xl border border-red-200 bg-red-50/80 px-4 py-3 text-xs sm:text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300"
        >
          {error}
        </p>
      )}

      <div className="mt-6 space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="username" className="text-xs font-semibold uppercase tracking-wider text-foreground/80">
            Username
          </Label>
          <Input
            id="username"
            ref={usernameRef}
            name="username"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="next"
            maxLength={100}
            placeholder="Enter your username"
            className={FIELD}
            value={username}
            onChange={(e) => {
              setUsername(e.target.value);
              if (fieldErrors.username) setFieldErrors((f) => ({ ...f, username: undefined }));
            }}
            aria-invalid={!!fieldErrors.username}
            aria-describedby={fieldErrors.username ? "username-error" : undefined}
          />
          {fieldErrors.username && (
            <p id="username-error" role="alert" className="text-xs text-red-600 dark:text-red-400">
              {fieldErrors.username}
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="password" className="text-xs font-semibold uppercase tracking-wider text-foreground/80">
            Password
          </Label>
          <div className="relative">
            <Input
              id="password"
              ref={passwordRef}
              name="password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              enterKeyHint="go"
              maxLength={200}
              placeholder="Enter your password"
              className={`${FIELD} pr-12`}
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (fieldErrors.password) setFieldErrors((f) => ({ ...f, password: undefined }));
              }}
              aria-invalid={!!fieldErrors.password}
              aria-describedby={fieldErrors.password ? "password-error" : undefined}
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? "Hide password" : "Show password"}
              aria-pressed={showPassword}
              aria-controls="password"
              className="absolute inset-y-0 right-0 flex w-12 items-center justify-center rounded-r-xl text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F9733E] motion-reduce:transition-none"
            >
              {showPassword ? <EyeOff aria-hidden className="h-4 w-4" /> : <Eye aria-hidden className="h-4 w-4" />}
            </button>
          </div>
          {fieldErrors.password && (
            <p id="password-error" role="alert" className="text-xs text-red-600 dark:text-red-400">
              {fieldErrors.password}
            </p>
          )}
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-2 text-xs">
        <label htmlFor="remember" className="flex cursor-pointer items-center gap-2 text-muted-foreground select-none hover:text-foreground">
          <input
            id="remember"
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
            className="h-4 w-4 cursor-pointer rounded border-border text-[#F9733E] accent-[#F9733E] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F9733E]"
          />
          Remember my username
        </label>
        <button
          type="button"
          onClick={() => setShowRecovery((v) => !v)}
          aria-expanded={showRecovery}
          aria-controls="password-recovery"
          className="rounded font-semibold text-[#F9733E] hover:text-[#EA580C] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F9733E]"
        >
          Forgot password?
        </button>
      </div>

      {/* This deployment has no self-service reset: passwords are reset by an
          administrator. Saying so plainly beats a link that goes nowhere, and it
          reveals nothing about whether any given account exists. */}
      {showRecovery && (
        <p
          id="password-recovery"
          className="mt-3 rounded-xl border border-border bg-muted/40 px-3.5 py-2.5 text-xs text-muted-foreground leading-relaxed"
        >
          Password resets are handled by your ERP administrator. Contact them to have a temporary password issued for your account.
        </p>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="mt-6 flex h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-[#F9733E] text-sm font-bold text-white transition-all hover:bg-[#EA580C] active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F9733E] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-70 motion-reduce:transition-none shadow-xs"
      >
        {submitting && <Loader2 aria-hidden className="h-4 w-4 animate-spin motion-reduce:animate-none" />}
        {submitting ? "Signing in…" : "Sign In"}
      </button>

      {/* Registration is a request, not a signup: it creates no account and grants
          no access until an administrator approves it and assigns a role. */}
      <p className="mt-5 border-t border-border pt-4 text-center text-xs text-muted-foreground">
        Need an account?{" "}
        <button
          type="button"
          onClick={onRequestAccess}
          className="rounded font-semibold text-[#F9733E] hover:text-[#EA580C] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F9733E]"
        >
          Request access
        </button>
      </p>
    </form>
  );
}
