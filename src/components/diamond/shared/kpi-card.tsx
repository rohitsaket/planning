"use client";

import { cn } from "@/lib/utils";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";

interface KpiCardProps {
  label: string;
  value: string | number;
  unit?: string;
  trend?: number;
  trendLabel?: string;
  intent?: "default" | "critical" | "warning" | "success" | "info";
  hint?: string;
  onClick?: () => void;
}

const intentClasses: Record<string, string> = {
  default: "border-border bg-card",
  critical: "border-rose-300/60 bg-rose-50/60 dark:bg-rose-950/30 dark:border-rose-900/60",
  warning: "border-amber-300/60 bg-amber-50/60 dark:bg-amber-950/30 dark:border-amber-900/60",
  success: "border-emerald-300/60 bg-emerald-50/60 dark:bg-emerald-950/30 dark:border-emerald-900/60",
  info: "border-sky-300/60 bg-sky-50/60 dark:bg-sky-950/30 dark:border-sky-900/60",
};

const intentValueColor: Record<string, string> = {
  default: "text-foreground",
  critical: "text-rose-700 dark:text-rose-300",
  warning: "text-amber-700 dark:text-amber-300",
  success: "text-emerald-700 dark:text-emerald-300",
  info: "text-sky-700 dark:text-sky-300",
};

export function KpiCard({ label, value, unit, trend, trendLabel, intent = "default", hint, onClick }: KpiCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={cn(
        "text-left w-full p-4 rounded-md border transition-all",
        intentClasses[intent],
        onClick && "hover:shadow-sm cursor-pointer"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground leading-tight">{label}</p>
        {typeof trend === "number" && (
          <span
            className={cn(
              "inline-flex items-center gap-0.5 text-[11px] font-semibold px-1.5 py-0.5 rounded",
              trend > 0 ? "text-emerald-700 bg-emerald-100 dark:text-emerald-300 dark:bg-emerald-950/40" :
              trend < 0 ? "text-rose-700 bg-rose-100 dark:text-rose-300 dark:bg-rose-950/40" :
              "text-muted-foreground bg-muted"
            )}
          >
            {trend > 0 ? <ArrowUpRight className="h-3 w-3" /> : trend < 0 ? <ArrowDownRight className="h-3 w-3" /> : <Minus className="h-3 w-3" />}
            {Math.abs(trend).toFixed(1)}%
          </span>
        )}
      </div>
      <div className="mt-2 flex items-baseline gap-1">
        <span className={cn("text-2xl font-semibold tabular-nums tracking-tight", intentValueColor[intent])}>{value}</span>
        {unit && <span className="text-xs text-muted-foreground">{unit}</span>}
      </div>
      {trendLabel && <p className="mt-1 text-[11px] text-muted-foreground">{trendLabel}</p>}
      {hint && <p className="mt-1 text-[10px] text-muted-foreground/80 leading-tight">{hint}</p>}
    </button>
  );
}
