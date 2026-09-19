"use client";

import { formatCompactCurrency } from "@/lib/format";
import { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function EmptyState({ title, message, icon }: { title: string; message?: string; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      {icon && <div className="text-muted-foreground/50 mb-3">{icon}</div>}
      <p className="text-sm font-medium text-foreground">{title}</p>
      {message && <p className="text-xs text-muted-foreground mt-1 max-w-md">{message}</p>}
    </div>
  );
}

export function InfoBanner({ children, variant = "info" }: { children: ReactNode; variant?: "info" | "warning" | "critical" | "success" }) {
  const classes = {
    info: "bg-sky-50 border-sky-200 text-sky-900 dark:bg-sky-950/40 dark:border-sky-900 dark:text-sky-200",
    warning: "bg-amber-50 border-amber-200 text-amber-900 dark:bg-amber-950/40 dark:border-amber-900 dark:text-amber-200",
    critical: "bg-rose-50 border-rose-200 text-rose-900 dark:bg-rose-950/40 dark:border-rose-900 dark:text-rose-200",
    success: "bg-emerald-50 border-emerald-200 text-emerald-900 dark:bg-emerald-950/40 dark:border-emerald-900 dark:text-emerald-200",
  };
  return (
    <div className={cn("rounded-md border px-3 py-2 text-[11px] leading-relaxed", classes[variant])}>
      {children}
    </div>
  );
}

export function Metric({ label, value, intent }: { label: string; value: string | number; intent?: "default" | "critical" | "warning" | "success" | "info" }) {
  const colors = {
    default: "text-foreground",
    critical: "text-rose-600 dark:text-rose-400",
    warning: "text-amber-600 dark:text-amber-400",
    success: "text-emerald-600 dark:text-emerald-400",
    info: "text-sky-600 dark:text-sky-400",
  };
  return (
    <div className="flex flex-col">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className={cn("text-sm font-semibold tabular-nums", intent ? colors[intent] : colors.default)}>{value}</span>
    </div>
  );
}

export function NumberCell({ value, intent, zeroAsDash = false, decimals }: { value: number | null | undefined; intent?: "default" | "critical" | "warning" | "success" | "info"; zeroAsDash?: boolean; decimals?: number }) {
  if (value === null || value === undefined) return <span className="text-muted-foreground/50">—</span>;
  if (zeroAsDash && value === 0) return <span className="text-muted-foreground/40">—</span>;
  const colors = {
    default: "",
    critical: "text-rose-600 dark:text-rose-400 font-medium",
    warning: "text-amber-600 dark:text-amber-400 font-medium",
    success: "text-emerald-600 dark:text-emerald-400 font-medium",
    info: "text-sky-600 dark:text-sky-400",
  };
  let display: string;
  if (decimals !== undefined) display = value.toFixed(decimals);
  else if (Number.isInteger(value)) display = value.toString();
  else display = value.toFixed(2);
  return <span className={cn("tabular-nums", intent ? colors[intent] : colors.default)}>{display}</span>;
}

export function Money({ value }: { value: number | null | undefined }) {
  if (value === null || value === undefined) return <span className="text-muted-foreground">—</span>;
  return <span className="tabular-nums">{formatCompactCurrency(value)}</span>;
}
