"use client";

import { formatCompactCurrency } from "@/lib/format";
import { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function EmptyState({ title, message, icon }: { title: string; message?: string; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
      {icon && <div className="text-muted-foreground/40 mb-3 p-3 rounded-full bg-[#F1F5F9] dark:bg-slate-800">{icon}</div>}
      <p className="text-sm font-semibold text-foreground tracking-tight">{title}</p>
      {message && <p className="text-xs text-muted-foreground mt-1 max-w-md leading-relaxed">{message}</p>}
    </div>
  );
}

export function InfoBanner({ children, variant = "info" }: { children: ReactNode; variant?: "info" | "warning" | "critical" | "success" | "simulation" | "advisory" }) {
  const classes = {
    info: "bg-sky-50 border-sky-200 text-sky-900 dark:bg-sky-950/40 dark:border-sky-900 dark:text-sky-200",
    warning: "bg-amber-50 border-amber-200 text-amber-900 dark:bg-amber-950/40 dark:border-amber-900 dark:text-amber-200",
    critical: "bg-red-50 border-red-200 text-red-900 dark:bg-red-950/40 dark:border-red-900 dark:text-red-200",
    success: "bg-emerald-50 border-emerald-200 text-emerald-900 dark:bg-emerald-950/40 dark:border-emerald-900 dark:text-emerald-200",
    simulation: "bg-[#FFF7E6] border-[#FDE68A] text-[#B45309] dark:bg-amber-950/40 dark:border-amber-800 dark:text-amber-300",
    advisory: "bg-purple-50 border-purple-200 text-purple-900 dark:bg-purple-950/40 dark:border-purple-900 dark:text-purple-200",
  };
  return (
    <div className={cn("rounded-lg border px-3.5 py-2.5 text-xs leading-relaxed font-normal shadow-2xs", classes[variant])}>
      {children}
    </div>
  );
}

export function Metric({ label, value, intent }: { label: string; value: string | number; intent?: "default" | "critical" | "warning" | "success" | "info" | "advisory" }) {
  const colors = {
    default: "text-foreground",
    critical: "text-red-600 dark:text-red-400",
    warning: "text-amber-600 dark:text-amber-400",
    success: "text-emerald-600 dark:text-emerald-400",
    info: "text-sky-600 dark:text-sky-400",
    advisory: "text-purple-600 dark:text-purple-400",
  };
  return (
    <div className="flex flex-col">
      <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className={cn("text-base font-bold tabular-nums tracking-tight", intent ? colors[intent] : colors.default)}>{value}</span>
    </div>
  );
}

export function NumberCell({ value, intent, zeroAsDash = false, decimals }: { value: number | null | undefined; intent?: "default" | "critical" | "warning" | "success" | "info" | "advisory"; zeroAsDash?: boolean; decimals?: number }) {
  if (value === null || value === undefined) return <span className="text-muted-foreground/50">—</span>;
  if (zeroAsDash && value === 0) return <span className="text-muted-foreground/40">—</span>;
  const colors = {
    default: "",
    critical: "text-red-600 dark:text-red-400 font-semibold",
    warning: "text-amber-600 dark:text-amber-400 font-semibold",
    success: "text-emerald-600 dark:text-emerald-400 font-semibold",
    info: "text-sky-600 dark:text-sky-400 font-medium",
    advisory: "text-purple-600 dark:text-purple-400 font-medium",
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
