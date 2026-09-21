"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { SessionUser } from "@/stores/auth-store";

// Convenience only: the username, never the password and never a token. Session
// lifetime is owned entirely by the server (HttpOnly cookie, absolute + idle TTL).
const REMEMBERED_USERNAME = "dp_remembered_username";

const FIELD = "h-[52px] rounded-lg border-slate-300 bg-white px-4 text-[15px] shadow-none md:text-[15px] dark:border-slate-700 dark:bg-slate-900";

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
    <form onSubmit={submit} noValidate className="w-full max-w-[520px]">
      <h2 className="text-3xl font-bold tracking-tight text-slate-900 lg:text-4xl dark:text-slate-50">Welcome Back</h2>
      <p className="mt-2 text-[15px] text-slate-500 dark:text-slate-400">Sign in to access your ERP workspace.</p>

      {/* Server-side failures. aria-live so screen readers hear it without focus moving. */}
      {error && (
        <p
          role="alert"
          className="mt-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300"
        >
          {error}
        </p>
      )}

      <div className="mt-6 space-y-5">
        <div className="space-y-2">
          <Label htmlFor="username" className="text-sm text-slate-700 dark:text-slate-300">
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

        <div className="space-y-2">
          <Label htmlFor="password" className="text-sm text-slate-700 dark:text-slate-300">
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
              className="absolute inset-y-0 right-0 flex w-12 items-center justify-center rounded-r-lg text-slate-400 transition-colors hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 motion-reduce:transition-none dark:hover:text-slate-200"
            >
              {showPassword ? <EyeOff aria-hidden className="h-5 w-5" /> : <Eye aria-hidden className="h-5 w-5" />}
            </button>
          </div>
          {fieldErrors.password && (
            <p id="password-error" role="alert" className="text-xs text-red-600 dark:text-red-400">
              {fieldErrors.password}
            </p>
          )}
        </div>
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <label htmlFor="remember" className="flex cursor-pointer items-center gap-2.5 text-sm text-slate-700 select-none dark:text-slate-300">
          <input
            id="remember"
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
            className="h-4 w-4 cursor-pointer rounded border-slate-300 text-blue-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 dark:border-slate-600"
          />
          Remember my username
        </label>
        <button
          type="button"
          onClick={() => setShowRecovery((v) => !v)}
          aria-expanded={showRecovery}
          aria-controls="password-recovery"
          className="rounded text-sm font-medium text-blue-600 hover:text-blue-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 dark:text-blue-400"
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
          className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-300"
        >
          Password resets are handled by your ERP administrator. Contact them to have a temporary password issued for your account.
        </p>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="mt-7 flex h-[54px] w-full items-center justify-center gap-2 rounded-lg bg-blue-600 text-[15px] font-semibold text-white transition-colors hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-70 motion-reduce:transition-none dark:focus-visible:ring-offset-slate-950"
      >
        {submitting && <Loader2 aria-hidden className="h-4 w-4 animate-spin motion-reduce:animate-none" />}
        {submitting ? "Signing in…" : "Sign In"}
      </button>

      {/* Registration is a request, not a signup: it creates no account and grants
          no access until an administrator approves it and assigns a role. */}
      <p className="mt-6 border-t border-slate-200 pt-5 text-center text-sm text-slate-500 dark:border-slate-800 dark:text-slate-400">
        Need an account?{" "}
        <button
          type="button"
          onClick={onRequestAccess}
          className="rounded font-medium text-blue-600 hover:text-blue-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 dark:text-blue-400"
        >
          Request access
        </button>
      </p>
    </form>
  );
}
