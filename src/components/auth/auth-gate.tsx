"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ChevronDown, KeyRound, LogOut } from "lucide-react";
import { toast } from "sonner";
import { useAuthStore, type SessionUser } from "@/stores/auth-store";
import { erpBrand, erpModules, type ErpBrand } from "@/lib/branding";
import { DEFAULT_MOTIVATION, type DailyMotivationPayload, MOTIVATION_TITLE } from "@/lib/motivation";
import { BrandingPanel } from "@/components/auth/login/branding-panel";
import { DailyMotivation, type DailyMotivationProps } from "@/components/auth/login/daily-motivation";
import { LoginForm } from "@/components/auth/login/login-form";
import { AccessRequestForm } from "@/components/auth/login/access-request-form";
import { DiamondMark } from "@/components/brand/diamond-mark";
import { ThemeToggle } from "@/components/layout/app-shell";
import { PasswordChangeForm } from "@/components/auth/password-change-form";

interface LoginContext {
  branding: ErpBrand;
  modules: readonly string[];
  version: string;
}

const INITIAL: LoginContext = { branding: erpBrand, modules: erpModules, version: "" };

type SetUser = (user: SessionUser | null) => void;

async function signOut(setUser: SetUser) {
  await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" }).catch(() => undefined);
  setUser(null);
}

async function reloadSession(setUser: SetUser) {
  const r = await fetch("/api/auth/me", { credentials: "same-origin" }).catch(() => null);
  setUser(r?.ok ? ((await r.json()).user as SessionUser) : null);
}

export function AuthGate({ children }: { children: ReactNode }) {
  const { status, user, setUser } = useAuthStore();
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
    if (status === "signed-out") queryClient.clear();
  }, [status, queryClient]);

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

  if (status === "signed-in") return user?.mustChangePassword ? <ForcedPasswordChange /> : <>{children}</>;
  if (status === "loading") {
    return (
      <div className="flex h-full w-full items-center justify-center bg-background text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }

  return (
    <main className="relative h-full w-full overflow-y-auto bg-background lg:grid lg:grid-cols-[50%_50%] xl:grid-cols-[52%_48%]">
      <div className="absolute top-4 right-4 z-20">
        <ThemeToggle />
      </div>

      <div className="hidden lg:block h-full">
        <BrandingPanel brand={ctx.branding} modules={ctx.modules} motivation={motivation} version={ctx.version} />
      </div>

      <div className="flex min-h-full flex-col justify-center px-5 py-10 sm:px-10 lg:px-14 overflow-y-auto">
        <header className="mb-6 lg:hidden max-w-[460px] mx-auto w-full">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-[#FFEDD5]/95 dark:bg-[#25201D] border border-[#FED7AA] dark:border-[#3D322C] shadow-2xs mb-3 w-fit">
            <div className="h-6 w-6 rounded-lg bg-[#18181B] text-white flex items-center justify-center flex-shrink-0 shadow-xs">
              <DiamondMark className="h-3.5 w-3.5" />
            </div>
            <span className="text-[11px] font-black tracking-tight text-[#18181B] dark:text-[#FFEDD5]">
              Planning ERP Platform
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
            {ctx.branding.name.split(" ").slice(0, -1).join(" ")}{" "}
            <span className="text-[#F97316]">{ctx.branding.name.split(" ").slice(-1)}</span>
          </h1>
          <p className="mt-1 text-xs sm:text-sm text-muted-foreground">{ctx.branding.tagline}</p>
        </header>

        <div className="flex justify-center">
          {mode === "signin" ? (
            <LoginForm onAuthenticated={setUser} onRequestAccess={() => setMode("request")} />
          ) : (
            <AccessRequestForm onBack={() => setMode("signin")} />
          )}
        </div>

        <div className="mx-auto mt-8 w-full max-w-[460px] lg:hidden">
          <DailyMotivation {...motivation} />
          <p className="mt-6 text-center text-xs text-muted-foreground">
            © {new Date().getFullYear()} {ctx.branding.name}
            {ctx.version && <span className="tabular-nums"> · v{ctx.version}</span>}
          </p>
        </div>
      </div>
    </main>
  );
}

function ForcedPasswordChange() {
  const { user, setUser } = useAuthStore();
  return (
    <main className="relative flex h-full w-full items-center justify-center overflow-y-auto bg-background px-4 py-10">
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>
      <section aria-labelledby="set-password-title" className="w-full max-w-[420px] rounded-xl border border-border/80 bg-card p-5 sm:p-6 shadow-2xs">
        <div className="mb-4 flex items-center gap-2">
          <div className="h-7 w-7 rounded-lg bg-[#18181B] text-white flex items-center justify-center">
            <DiamondMark className="h-4 w-4" />
          </div>
          <span className="text-xs text-muted-foreground truncate">Signed in as {user?.username}</span>
        </div>
        <h1 id="set-password-title" className="text-xl font-semibold tracking-tight">Set your password</h1>
        <p className="mt-1 mb-4 text-sm text-muted-foreground">
          You signed in with a temporary password. Replace it with your own password to continue.
        </p>
        <PasswordChangeForm
          username={user?.username ?? ""}
          temporary
          onChanged={() => reloadSession(setUser)}
          actions={<Button type="button" variant="ghost" size="sm" onClick={() => signOut(setUser)}>Sign out</Button>}
        />
      </section>
    </main>
  );
}

export function UserMenu() {
  const { user, setUser } = useAuthStore();
  const [menuOpen, setMenuOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  if (!user) return null;
  const initials = (user.displayName || user.username || "U")
    .split(" ")
    .map((n) => n[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const roleLabel = user.role?.toLowerCase().replace(/_/g, " ");
  const avatar = (
    <div className="h-6 w-6 rounded-full bg-[#FFEDD5] dark:bg-amber-950/60 text-[#F97316] dark:text-amber-400 font-bold text-[10px] flex items-center justify-center shrink-0 border border-[#FED7AA] dark:border-amber-900/50">
      {initials}
    </div>
  );

  return (
    <>
    <Popover open={menuOpen} onOpenChange={setMenuOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Account menu"
          className="ml-1 sm:ml-2 flex items-center gap-2 px-2 py-1 rounded-full bg-muted/60 dark:bg-[#1E2330] border border-border hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {avatar}
          <div className="hidden lg:flex flex-col text-left leading-tight">
            <span className="text-[11px] font-semibold text-foreground max-w-[120px] truncate">{user.displayName}</span>
            <span className="text-[9px] text-muted-foreground capitalize truncate">{roleLabel}</span>
          </div>
          <ChevronDown className="h-3 w-3 text-muted-foreground" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56 p-1">
        <div className="flex items-center gap-2 px-2 py-2">
          {avatar}
          <div className="flex min-w-0 flex-col leading-tight">
            <span className="text-xs font-semibold text-foreground truncate">{user.displayName}</span>
            <span className="text-[11px] text-muted-foreground truncate">{user.username}</span>
            <span className="text-[10px] text-muted-foreground capitalize truncate">{roleLabel}</span>
          </div>
        </div>
        <div className="my-1 h-px bg-border" />
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start gap-2 h-8 px-2 text-xs"
          onClick={() => {
            setMenuOpen(false);
            setPasswordOpen(true);
          }}
        >
          <KeyRound className="h-3.5 w-3.5" aria-hidden />
          Change password
        </Button>
        <Button variant="ghost" size="sm" className="w-full justify-start gap-2 h-8 px-2 text-xs" onClick={() => signOut(setUser)}>
          <LogOut className="h-3.5 w-3.5" aria-hidden />
          Sign out
        </Button>
      </PopoverContent>
    </Popover>
    <Dialog open={passwordOpen} onOpenChange={setPasswordOpen}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>Change password</DialogTitle>
          <DialogDescription>Your other signed-in devices will be signed out.</DialogDescription>
        </DialogHeader>
        {passwordOpen && (
          <PasswordChangeForm
            username={user.username}
            temporary={false}
            onChanged={async () => {
              setPasswordOpen(false);
              await reloadSession(setUser);
              toast.success("Password changed. Other sessions were signed out.");
            }}
            actions={<Button type="button" variant="ghost" size="sm" onClick={() => setPasswordOpen(false)}>Cancel</Button>}
          />
        )}
      </DialogContent>
    </Dialog>
    </>
  );
}
