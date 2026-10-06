"use client";

import { useRef, useState, type FormEvent } from "react";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PASSWORD_MAX_LENGTH, PASSWORD_REQUIREMENTS, passwordChangeProblems, type PasswordChangeInput } from "@/lib/auth/password-policy";

type Field = keyof PasswordChangeInput;

export function PasswordChangeForm({
  username,
  temporary,
  onChanged,
  actions,
}: {
  username: string;
  temporary: boolean;
  onChanged: () => void | Promise<void>;
  actions?: React.ReactNode;
}) {
  const [values, setValues] = useState<Record<Field, string>>({ current: "", next: "", confirm: "" });
  const [visible, setVisible] = useState<Record<Field, boolean>>({ current: false, next: false, confirm: false });
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<Field, string>>>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const refs = { current: useRef<HTMLInputElement>(null), next: useRef<HTMLInputElement>(null), confirm: useRef<HTMLInputElement>(null) };

  const currentLabel = temporary ? "Temporary password" : "Current password";

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    const next = passwordChangeProblems(values, currentLabel.toLowerCase());
    setFieldErrors(next);
    setError(null);
    const first = (["current", "next", "confirm"] as const).find((f) => next[f]);
    if (first) {
      refs[first].current?.focus();
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ currentPassword: values.current, newPassword: values.next }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        if (res.status === 400 && data?.error?.code === "BAD_REQUEST") setError(data.error.message);
        else if (res.status === 400) setError("The new password does not meet the requirements.");
        else if (res.status === 429) setError("Too many attempts. Try again shortly.");
        else if (res.status === 401) setError("Your session has ended. Sign in again.");
        else setError("The password could not be changed. Try again shortly.");
        setValues({ current: "", next: "", confirm: "" });
        refs.current.current?.focus();
        return;
      }
      setValues({ current: "", next: "", confirm: "" });
      await onChanged();
    } catch {
      setError("Unable to reach the server. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const field = (name: Field, label: string, autoComplete: string) => {
    const id = `pw-${name}`;
    const errorId = `${id}-error`;
    return (
      <div className="space-y-1.5">
        <Label htmlFor={id} className="text-xs font-semibold text-foreground/80">{label}</Label>
        <div className="relative">
          <Input
            id={id}
            ref={refs[name]}
            type={visible[name] ? "text" : "password"}
            autoComplete={autoComplete}
            maxLength={PASSWORD_MAX_LENGTH}
            className="pr-10"
            value={values[name]}
            onChange={(e) => {
              const value = e.target.value;
              setValues((v) => ({ ...v, [name]: value }));
              if (fieldErrors[name]) setFieldErrors((f) => ({ ...f, [name]: undefined }));
            }}
            aria-invalid={!!fieldErrors[name]}
            aria-describedby={fieldErrors[name] ? errorId : undefined}
          />
          <button
            type="button"
            onClick={() => setVisible((v) => ({ ...v, [name]: !v[name] }))}
            aria-label={`${visible[name] ? "Hide" : "Show"} ${label.toLowerCase()}`}
            aria-pressed={visible[name]}
            aria-controls={id}
            className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-md text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {visible[name] ? <EyeOff aria-hidden className="h-4 w-4" /> : <Eye aria-hidden className="h-4 w-4" />}
          </button>
        </div>
        {fieldErrors[name] && <p id={errorId} role="alert" className="text-xs text-red-600 dark:text-red-400">{fieldErrors[name]}</p>}
      </div>
    );
  };

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <input type="text" name="username" autoComplete="username" value={username} readOnly hidden />
      {error && (
        <p role="alert" className="rounded-md border border-red-200 bg-red-50/80 px-3 py-2 text-xs text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </p>
      )}
      {field("current", currentLabel, "current-password")}
      {field("next", "New password", "new-password")}
      {field("confirm", "Confirm new password", "new-password")}
      <ul className="list-disc pl-5 text-xs text-muted-foreground" aria-label="Password requirements">
        {PASSWORD_REQUIREMENTS.map((r) => <li key={r}>{r}</li>)}
      </ul>
      <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
        {actions}
        <Button type="submit" size="sm" disabled={submitting}>
          {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
          Change password
        </Button>
      </div>
    </form>
  );
}
