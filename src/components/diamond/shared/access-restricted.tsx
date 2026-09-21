"use client";

import { ShieldAlert, Lock, ArrowLeft, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNavStore } from "@/stores/nav-store";
import { useAuthStore } from "@/stores/auth-store";
import { viewPermission, PERMISSION_LABELS } from "@/lib/auth/view-permissions";

interface AccessRestrictedProps {
  viewId?: string;
  title?: string;
  description?: string;
  requiredPermission?: string;
}

export function AccessRestricted({
  viewId,
  title = "Access Restricted",
  description,
  requiredPermission,
}: AccessRestrictedProps) {
  const setView = useNavStore((s) => s.setView);
  const user = useAuthStore((s) => s.user);
  const isAdmin = user?.role === "SUPER_ADMIN" || user?.role === "ADMIN";

  const perm = requiredPermission || (viewId ? viewPermission(viewId) : undefined);
  const permLabel = perm ? PERMISSION_LABELS[perm] || perm : undefined;

  return (
    <div className="flex h-full min-h-[400px] w-full flex-col items-center justify-center p-6 text-center">
      <div className="relative mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-600 dark:bg-amber-500/20 dark:text-amber-400 border border-amber-500/20 shadow-sm">
        <Lock className="h-8 w-8" />
        <span className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-background border border-border shadow-xs text-muted-foreground">
          <KeyRound className="h-3 w-3" />
        </span>
      </div>

      <h2 className="text-lg font-semibold tracking-tight text-foreground">{title}</h2>
      
      <p className="mt-2 max-w-md text-xs text-muted-foreground leading-relaxed">
        {description ||
          "You do not currently have authorization to view this section. Access is governed by role-based permissions to protect commercial and operational integrity."}
      </p>

      {permLabel && (
        <div className="mt-4 inline-flex items-center gap-1.5 rounded-md border border-border/80 bg-muted/40 px-3 py-1.5 text-[11px] text-muted-foreground">
          <ShieldAlert className="h-3.5 w-3.5 text-amber-500" />
          <span>Requires: <strong className="text-foreground font-medium">{permLabel}</strong></span>
          {isAdmin && perm && <span className="font-mono text-[9px] text-muted-foreground/60">({perm})</span>}
        </div>
      )}

      <div className="mt-6 flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          className="h-8 text-xs gap-1.5"
          onClick={() => setView("dashboard")}
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Dashboard
        </Button>
      </div>
    </div>
  );
}
