"use client";

import { useRef, useState, type FormEvent } from "react";
import { ArrowLeft, CheckCircle2, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const FIELD = "h-[52px] rounded-lg border-slate-300 bg-white px-4 text-[15px] shadow-none md:text-[15px] dark:border-slate-700 dark:bg-slate-900";

interface Errors {
  username?: string;
  displayName?: string;
  justification?: string;
}

export function AccessRequestForm({ onBack }: { onBack: () => void }) {
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [department, setDepartment] = useState("");
  const [justification, setJustification] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Errors>({});
  const usernameRef = useRef<HTMLInputElement>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting) return;

    // Mirrors the server schema so the common mistakes are caught before a round
    // trip; the server revalidates everything regardless.
    const next: Errors = {};
    if (!/^[a-z0-9._-]{3,50}$/.test(username.trim().toLowerCase())) next.username = "3–50 characters: letters, numbers, dot, underscore or hyphen.";
    if (!displayName.trim()) next.displayName = "Enter your full name.";
    if (justification.trim().length < 20) next.justification = "Describe why access is needed (at least 20 characters).";
    setFieldErrors(next);
    if (Object.keys(next).length) return;

    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/public/access-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          username: username.trim().toLowerCase(),
          displayName: displayName.trim(),
          email: email.trim() || undefined,
          department: department.trim() || undefined,
          justification: justification.trim(),
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        if (res.status === 429) setError(data?.error?.message ?? "Too many requests. Try again later.");
        else if (res.status >= 500) setError("ERP access is temporarily unavailable. Try again shortly.");
        else setError(data?.error?.message ?? "Could not submit the request.");
        return;
      }
      setSubmitted(true);
    } catch {
      setError("Unable to reach the server. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div className="w-full max-w-[520px]">
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-5 dark:border-emerald-900/60 dark:bg-emerald-950/40">
          <div className="flex gap-3">
            <CheckCircle2 aria-hidden className="mt-0.5 h-5 w-5 flex-shrink-0 text-emerald-600 dark:text-emerald-400" />
            <div>
              <h2 className="text-base font-semibold text-emerald-900 dark:text-emerald-200">Request submitted</h2>
              <p className="mt-1 text-sm text-emerald-800 dark:text-emerald-300">
                If the details provided are eligible, an administrator will review the request and contact you. No account exists until the request is approved.
              </p>
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={onBack}
          className="mt-6 flex items-center gap-2 rounded text-sm font-medium text-blue-600 hover:text-blue-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 dark:text-blue-400"
        >
          <ArrowLeft aria-hidden className="h-4 w-4" /> Back to sign in
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate className="w-full max-w-[520px]">
      <h2 className="text-3xl font-bold tracking-tight text-slate-900 lg:text-4xl dark:text-slate-50">Request Access</h2>
      <p className="mt-2 text-[15px] text-slate-500 dark:text-slate-400">
        Submitting this does not create an account. An administrator reviews every request and assigns your role.
      </p>

      {error && (
        <p role="alert" className="mt-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </p>
      )}

      <div className="mt-6 space-y-5">
        <div className="space-y-2">
          <Label htmlFor="req-username" className="text-sm text-slate-700 dark:text-slate-300">Requested username</Label>
          <Input
            id="req-username"
            ref={usernameRef}
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            maxLength={50}
            placeholder="e.g. r.saket"
            className={FIELD}
            value={username}
            onChange={(e) => {
              setUsername(e.target.value);
              if (fieldErrors.username) setFieldErrors((f) => ({ ...f, username: undefined }));
            }}
            aria-invalid={!!fieldErrors.username}
            aria-describedby={fieldErrors.username ? "req-username-error" : undefined}
          />
          {fieldErrors.username && <p id="req-username-error" role="alert" className="text-xs text-red-600 dark:text-red-400">{fieldErrors.username}</p>}
        </div>

        <div className="space-y-2">
          <Label htmlFor="req-name" className="text-sm text-slate-700 dark:text-slate-300">Full name</Label>
          <Input
            id="req-name"
            autoComplete="name"
            maxLength={100}
            placeholder="Enter your full name"
            className={FIELD}
            value={displayName}
            onChange={(e) => {
              setDisplayName(e.target.value);
              if (fieldErrors.displayName) setFieldErrors((f) => ({ ...f, displayName: undefined }));
            }}
            aria-invalid={!!fieldErrors.displayName}
            aria-describedby={fieldErrors.displayName ? "req-name-error" : undefined}
          />
          {fieldErrors.displayName && <p id="req-name-error" role="alert" className="text-xs text-red-600 dark:text-red-400">{fieldErrors.displayName}</p>}
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="req-email" className="text-sm text-slate-700 dark:text-slate-300">
              Work email <span className="font-normal text-slate-400">(optional)</span>
            </Label>
            <Input id="req-email" type="email" autoComplete="email" maxLength={200} placeholder="name@company.com" className={FIELD} value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="req-dept" className="text-sm text-slate-700 dark:text-slate-300">
              Department <span className="font-normal text-slate-400">(optional)</span>
            </Label>
            <Input id="req-dept" maxLength={100} placeholder="e.g. Planning" className={FIELD} value={department} onChange={(e) => setDepartment(e.target.value)} />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="req-why" className="text-sm text-slate-700 dark:text-slate-300">Why do you need access?</Label>
          <Textarea
            id="req-why"
            rows={4}
            maxLength={1000}
            placeholder="Your role, the work this supports, and who can vouch for you."
            className="rounded-lg border-slate-300 bg-white px-4 py-3 text-[15px] shadow-none dark:border-slate-700 dark:bg-slate-900"
            value={justification}
            onChange={(e) => {
              setJustification(e.target.value);
              if (fieldErrors.justification) setFieldErrors((f) => ({ ...f, justification: undefined }));
            }}
            aria-invalid={!!fieldErrors.justification}
            aria-describedby={fieldErrors.justification ? "req-why-error" : "req-why-hint"}
          />
          {fieldErrors.justification ? (
            <p id="req-why-error" role="alert" className="text-xs text-red-600 dark:text-red-400">{fieldErrors.justification}</p>
          ) : (
            <p id="req-why-hint" className="text-xs text-slate-400 dark:text-slate-500">{justification.trim().length}/1000 · minimum 20 characters</p>
          )}
        </div>
      </div>

      <button
        type="submit"
        disabled={submitting}
        className="mt-7 flex h-[54px] w-full items-center justify-center gap-2 rounded-lg bg-blue-600 text-[15px] font-semibold text-white transition-colors hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-70 motion-reduce:transition-none dark:focus-visible:ring-offset-slate-950"
      >
        {submitting && <Loader2 aria-hidden className="h-4 w-4 animate-spin motion-reduce:animate-none" />}
        {submitting ? "Submitting…" : "Submit Request"}
      </button>

      <button
        type="button"
        onClick={onBack}
        className="mt-5 flex items-center gap-2 rounded text-sm font-medium text-blue-600 hover:text-blue-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 dark:text-blue-400"
      >
        <ArrowLeft aria-hidden className="h-4 w-4" /> Back to sign in
      </button>
    </form>
  );
}
