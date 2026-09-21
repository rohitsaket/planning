"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { useAuthStore, type SessionUser } from "@/stores/auth-store";
import { erpBrand, erpModules, type ErpBrand } from "@/lib/branding";
import { DEFAULT_MOTIVATION, type DailyMotivationPayload, MOTIVATION_TITLE } from "@/lib/motivation";
import { BrandingPanel } from "@/components/auth/login/branding-panel";
import { DailyMotivation, type DailyMotivationProps } from "@/components/auth/login/daily-motivation";
import { LoginForm } from "@/components/auth/login/login-form";
import { AccessRequestForm } from "@/components/auth/login/access-request-form";

interface LoginContext {
  branding: ErpBrand;
  modules: readonly string[];
  version: string;
}

// Rendered immediately so the panel has content on first paint; both API
// responses replace it without changing any element's size.
const INITIAL: LoginContext = { branding: erpBrand, modules: erpModules, version: "" };

// Shows the sign-in screen until the server confirms a session. This is a UX gate
// only: the API rejects every unauthenticated or unauthorized request on its own.
export function AuthGate({ children }: { children: ReactNode }) {
  const { status, setUser } = useAuthStore();
  const queryClient = useQueryClient();
  const [ctx, setCtx] = useState<LoginContext>(INITIAL);
  const [motivation, setMotivation] = useState<DailyMotivationProps>(DEFAULT_MOTIVATION);
  const [mode, setMode] = useState<"signin" | "request">("signin");

  useEffect(() => {
    fetch("/api/auth/me", { credentials: "same-origin" })
      .then(async (r) => setUser(r.ok ? ((await r.json()).user as SessionUser) : null))
      .catch(() => setUser(null));
  }, [setUser]);

  useEffect(() => {
    if (status === "signed-out") queryClient.clear(); // drop cached data from the previous session
  }, [status, queryClient]);

  // Branding and the day's quote. Both are public, cacheable and non-blocking:
  // they are fetched in parallel after the screen has already painted, and a
  // failure of either just leaves the built-in fallback on screen. Sign-in never
  // waits on them.
  useEffect(() => {
    if (status !== "signed-out") return;
    let cancelled = false;
    const json = (url: string) =>
      fetch(url, { credentials: "same-origin" })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);

    json("/api/public/login-context").then((d: LoginContext | null) => {
      if (d && !cancelled) setCtx((prev) => ({ ...prev, ...d }));
    });

    json("/api/public/daily-motivation").then((d: DailyMotivationPayload | null) => {
      if (!d?.quote || cancelled) return;
      setMotivation({
        title: MOTIVATION_TITLE,
        quote: d.quote,
        author: d.author && d.author !== "Unknown" ? d.author : undefined,
        attribution: d.attribution ?? null,
      });
    });

    return () => {
      cancelled = true;
    };
  }, [status]);

  if (status === "signed-in") return <>{children}</>;
  if (status === "loading") {
    return (
      <div className="flex h-full w-full items-center justify-center bg-[#F3F7FC] text-sm text-slate-500 dark:bg-slate-950 dark:text-slate-400">
        Loading…
      </div>
    );
  }

  return (
    <main className="h-full w-full overflow-y-auto bg-white lg:grid lg:grid-cols-[52%_48%] dark:bg-slate-950">
      {/* Branding: a full column on desktop, hidden on small screens where the
          compact motivation strip below the form carries it instead. */}
      <div className="hidden lg:block h-full">
        <BrandingPanel brand={ctx.branding} modules={ctx.modules} motivation={motivation} version={ctx.version} />
      </div>

      <div className="flex min-h-full flex-col justify-center px-5 py-10 sm:px-10 lg:px-14 overflow-y-auto">
        {/* Mobile/tablet brand lockup — the desktop panel is hidden there. */}
        <header className="mb-8 lg:hidden">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-50">
            {ctx.branding.name.split(" ").slice(0, -1).join(" ")}{" "}
            <span className="text-blue-600 dark:text-blue-400">{ctx.branding.name.split(" ").slice(-1)}</span>
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{ctx.branding.tagline}</p>
        </header>

        <div className="flex justify-center lg:justify-start">
          {mode === "signin" ? (
            <LoginForm onAuthenticated={setUser} onRequestAccess={() => setMode("request")} />
          ) : (
            <AccessRequestForm onBack={() => setMode("signin")} />
          )}
        </div>

        {/* Motivation follows the form on small screens so the primary action
            stays above the fold. */}
        <div className="mx-auto mt-10 w-full max-w-[520px] lg:hidden">
          <DailyMotivation {...motivation} />
          <p className="mt-6 text-center text-xs text-slate-400 dark:text-slate-500">
            © {new Date().getFullYear()} {ctx.branding.name}
            {ctx.version && <span className="tabular-nums"> · v{ctx.version}</span>}
          </p>
        </div>
      </div>
    </main>
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
