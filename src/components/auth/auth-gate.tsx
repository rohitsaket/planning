"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuthStore, type SessionUser } from "@/stores/auth-store";

// Shows the sign-in form until the server confirms a session. This is a UX gate only:
// the API rejects every unauthenticated or unauthorized request on its own.
export function AuthGate({ children }: { children: ReactNode }) {
  const { status, setUser } = useAuthStore();
  const queryClient = useQueryClient();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/auth/me", { credentials: "same-origin" })
      .then(async (r) => setUser(r.ok ? ((await r.json()).user as SessionUser) : null))
      .catch(() => setUser(null));
  }, [setUser]);

  useEffect(() => {
    if (status === "signed-out") queryClient.clear(); // drop cached data from the previous session
  }, [status, queryClient]);

  if (status === "signed-in") return <>{children}</>;
  if (status === "loading") return <div className="min-h-screen flex items-center justify-center text-sm text-muted-foreground">Loading…</div>;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error?.message ?? "Sign-in failed.");
        return;
      }
      setPassword("");
      setUser(data.user as SessionUser);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-lg border border-border bg-card p-6 shadow-sm">
        <div>
          <h1 className="text-lg font-semibold">Sign in</h1>
          <p className="text-xs text-muted-foreground">Diamond Manufacturing ERP</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="username">Username</Label>
          <Input id="username" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required maxLength={100} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="password">Password</Label>
          <Input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required maxLength={200} />
        </div>
        {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
        <Button type="submit" className="w-full" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</Button>
      </form>
    </div>
  );
}

export function UserMenu() {
  const { user, setUser } = useAuthStore();
  if (!user) return null;
  const signOut = async () => {
    await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" }).catch(() => undefined);
    setUser(null);
  };
  return (
    <div className="flex items-center gap-1.5">
      <span className="hidden md:inline text-[11px] text-muted-foreground" title={user.role}>{user.displayName}</span>
      <Button variant="ghost" size="sm" className="h-7 px-2 text-[11px]" onClick={signOut}>Sign out</Button>
    </div>
  );
}
