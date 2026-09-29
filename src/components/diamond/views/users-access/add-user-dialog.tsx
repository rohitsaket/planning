"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiPost } from "@/lib/api-client";
import { useAuthStore } from "@/stores/auth-store";
import { RolePicker, ScopePicker, scopeChoiceValid } from "./access-pickers";
import { USERS_URL, type RoleRow, type ScopeOptions } from "./shared";

/** A server-issued temporary password, shown once for the administrator to hand over. */
export function OneTimePassword({ username, password }: { username: string; password: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs">
      <p>
        Temporary password for <strong>{username}</strong>. It is shown only now and is not stored. The user must choose a new password at first sign-in.
      </p>
      <div className="flex items-center gap-2">
        <code className="flex-1 truncate rounded bg-muted px-2 py-1.5 font-mono text-[12px]" aria-label="Temporary password">{password}</code>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 gap-1"
          onClick={() => {
            void navigator.clipboard?.writeText(password).then(() => setCopied(true), () => setCopied(false));
          }}
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
    </div>
  );
}

// Mirrors the server minimum for a quicker hint; the server rejects anything shorter.
const MIN_PASSWORD = 12;

const EMPTY = { displayName: "", username: "", email: "", roles: [] as string[], activation: "temporary" as "temporary" | "password", password: "", scope: { countries: [] as string[], labs: [] as string[] } };

export function AddUserDialog({
  open,
  onOpenChange,
  roles,
  scopeOptions,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  roles: RoleRow[];
  /** Present only when the caller may assign scope. */
  scopeOptions: ScopeOptions | null;
  onCreated: () => Promise<void>;
}) {
  const ownScope = useAuthStore((s) => s.user?.accessScope);
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<{ username: string; password: string } | null>(null);

  const close = (next: boolean) => {
    if (!next) {
      setForm(EMPTY);
      setError(null);
      setIssued(null);
    }
    onOpenChange(next);
  };

  const scopeOk = !scopeOptions || scopeChoiceValid(ownScope, form.scope);
  const valid = form.displayName.trim().length > 0 && /^[a-z0-9._-]{3,50}$/.test(form.username.trim().toLowerCase()) && form.roles.length > 0 && scopeOk && (form.activation === "temporary" || form.password.length >= MIN_PASSWORD);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      const username = form.username.trim().toLowerCase();
      const res = await apiPost<{ temporaryPassword: string | null }>(USERS_URL, {
        op: "create",
        displayName: form.displayName.trim(),
        username,
        email: form.email.trim() || undefined,
        roles: form.roles,
        ...(form.activation === "password" ? { password: form.password } : {}),
        ...(scopeOptions ? { scope: form.scope } : {}),
      });
      await onCreated();
      if (res.temporaryPassword) setIssued({ username, password: res.temporaryPassword });
      else close(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The account could not be created.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Add user</DialogTitle>
          <DialogDescription>Access comes from the roles you choose. Permissions are edited on roles, not on individual accounts.</DialogDescription>
        </DialogHeader>
        {issued ? (
          <>
            <OneTimePassword username={issued.username} password={issued.password} />
            <DialogFooter>
              <Button type="button" onClick={() => close(false)}>Done</Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="space-y-1 text-xs font-medium">
                Full name
                <Input value={form.displayName} maxLength={100} onChange={(e) => setForm({ ...form, displayName: e.target.value })} required />
              </label>
              <label className="space-y-1 text-xs font-medium">
                Username
                <Input value={form.username} maxLength={50} onChange={(e) => setForm({ ...form, username: e.target.value })} placeholder="letters, numbers, . _ -" required />
              </label>
              <label className="space-y-1 text-xs font-medium sm:col-span-2">
                Email (optional)
                <Input type="email" value={form.email} maxLength={200} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </label>
            </div>
            <div className="space-y-1.5">
              <p className="text-xs font-medium">Roles</p>
              <RolePicker idPrefix="add-user" roles={roles} value={form.roles} onChange={(codes) => setForm({ ...form, roles: codes })} />
            </div>
            {scopeOptions && (
              <div className="space-y-1.5">
                <p className="text-xs font-medium">Country and lab scope</p>
                <ScopePicker idPrefix="add-user" options={scopeOptions} value={form.scope} onChange={(scope) => setForm({ ...form, scope })} />
                <p className="text-[11px] text-muted-foreground">Workbook Import follows lab scope only; it has no country.</p>
              </div>
            )}
            <fieldset className="space-y-1.5">
              <legend className="text-xs font-medium">Activation</legend>
              <label className="flex items-center gap-2 text-xs">
                <input type="radio" name="activation" checked={form.activation === "temporary"} onChange={() => setForm({ ...form, activation: "temporary" })} />
                Issue a temporary password (shown once)
              </label>
              <label className="flex items-center gap-2 text-xs">
                <input type="radio" name="activation" checked={form.activation === "password"} onChange={() => setForm({ ...form, activation: "password" })} />
                Set an initial password
              </label>
              {form.activation === "password" && (
                <Input type="password" autoComplete="new-password" value={form.password} maxLength={200} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="At least 12 characters" aria-label="Initial password" />
              )}
              <p className="text-[11px] text-muted-foreground">The account is shown as Invited until the user signs in and chooses their own password.</p>
            </fieldset>
            {error && <p role="alert" className="text-xs text-red-600 dark:text-red-400">{error}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => close(false)}>Cancel</Button>
              <Button type="submit" disabled={!valid || busy}>{busy ? "Adding…" : "Add user"}</Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
