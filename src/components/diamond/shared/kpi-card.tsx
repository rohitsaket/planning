"use client";

import { cn } from "@/lib/utils";
import { ArrowDownRight, ArrowUpRight, Minus, type LucideIcon } from "lucide-react";
import { ReactNode } from "react";

interface KpiCardProps {
  label: string;
  value: string | number;
  unit?: string;
  trend?: number;
  trendLabel?: string;
  intent?: "default" | "critical" | "warning" | "success" | "info";
  /**
   * One line under the value saying what it *means* to the business: its scope, where it
   * came from, or a status that qualifies it — "Stock held above target", "Confirmed
   * invoiced sales only", "Advisory until the transfer policy is approved".
   *
   * It renders to the page, so it is subject to the same rule as any other visible text:
   * it must not carry a formula, a query fragment, a database or source-code identifier,
   * a threshold, a coefficient or an internal rule identifier. Those belong in the
   * service that applies them. This prop was where most of them reached the browser.
   */
  hint?: string;
  icon?: LucideIcon;
  sparkline?: number[];
  // Describes what the sparkline plots. When given it replaces the rising/declining guess,
  // which is only meaningful for chronological data.
  sparklineTitle?: string;
  onClick?: () => void;
  subtitle?: string;
}

const intentClasses: Record<string, string> = {
  default: "border-border bg-card hover:border-foreground/30",
  critical: "border-rose-200/80 bg-gradient-to-br from-rose-50/80 to-card dark:from-rose-950/40 dark:border-rose-900/60 hover:border-rose-400",
  warning: "border-amber-200/80 bg-gradient-to-br from-amber-50/80 to-card dark:from-amber-950/40 dark:border-amber-900/60 hover:border-amber-400",
  success: "border-emerald-200/80 bg-gradient-to-br from-emerald-50/80 to-card dark:from-emerald-950/40 dark:border-emerald-900/60 hover:border-emerald-400",
  info: "border-sky-200/80 bg-gradient-to-br from-sky-50/80 to-card dark:from-sky-950/40 dark:border-sky-900/60 hover:border-sky-400",
};

const intentAccent: Record<string, string> = {
  default: "bg-foreground/10 text-foreground/60",
  critical: "bg-rose-500/15 text-rose-600 dark:text-rose-400",
  warning: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  success: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  info: "bg-sky-500/15 text-sky-600 dark:text-sky-400",
};

const intentValueColor: Record<string, string> = {
  default: "text-foreground",
  critical: "text-rose-700 dark:text-rose-300",
  warning: "text-amber-700 dark:text-amber-300",
  success: "text-emerald-700 dark:text-emerald-300",
  info: "text-sky-700 dark:text-sky-300",
};

const intentSparkColor: Record<string, string> = {
  default: "#94a3b8",
  critical: "#f43f5e",
  warning: "#f59e0b",
  success: "#10b981",
  info: "#0ea5e9",
};

function Sparkline({ data, color, title }: { data: number[]; color: string; title?: string }) {
  if (data.length < 2) return null;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const w = 80;
  const h = 24;
  const step = w / (data.length - 1);
  const points = data.map((v, i) => `${i * step},${h - ((v - min) / range) * h}`).join(" ");
  const lastVal = data[data.length - 1];
  const firstVal = data[0];
  const rising = lastVal >= firstVal;
  return (
    <svg width={w} height={h} className="opacity-80" role={title ? "img" : undefined} aria-label={title}>
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle
        cx={(data.length - 1) * step}
        cy={h - ((lastVal - min) / range) * h}
        r={2}
        fill={color}
      />
      <defs>
        <linearGradient id={`spark-${color.replace("#", "")}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.3} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <polygon
        points={`0,${h} ${points} ${w},${h}`}
        fill={`url(#spark-${color.replace("#", "")})`}
      />
      {title ? <title>{title}</title> : !rising && <title>Declining trend</title>}
    </svg>
  );
}

export function KpiCard({ label, value, unit, trend, trendLabel, intent = "default", hint, icon: Icon, sparkline, sparklineTitle, onClick, subtitle }: KpiCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={cn(
        "text-left w-full p-3 rounded-lg border transition-all duration-200 group relative overflow-hidden",
        intentClasses[intent],
        onClick && "hover:shadow-md hover:-translate-y-0.5 cursor-pointer active:translate-y-0"
      )}
    >
      {/* Accent stripe on the left for non-default intents */}
      {intent !== "default" && (
        <div className={cn("absolute left-0 top-0 bottom-0 w-1", intentAccent[intent])} />
      )}
      <div className="flex items-start justify-between gap-2 pl-1">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            {Icon && (
              <div className={cn("p-1 rounded-md", intentAccent[intent])}>
                <Icon className="h-3 w-3" />
              </div>
            )}
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground leading-tight truncate">{label}</p>
          </div>
          {subtitle && <p className="text-[9px] text-muted-foreground/80 mt-0.5 truncate">{subtitle}</p>}
        </div>
        {typeof trend === "number" && (
          <span
            className={cn(
              "inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded shrink-0",
              trend > 0 ? "text-emerald-700 bg-emerald-100 dark:text-emerald-300 dark:bg-emerald-950/40" :
              trend < 0 ? "text-rose-700 bg-rose-100 dark:text-rose-300 dark:bg-rose-950/40" :
              "text-muted-foreground bg-muted"
            )}
          >
            {trend > 0 ? <ArrowUpRight className="h-2.5 w-2.5" /> : trend < 0 ? <ArrowDownRight className="h-2.5 w-2.5" /> : <Minus className="h-2.5 w-2.5" />}
            {Math.abs(trend).toFixed(1)}%
          </span>
        )}
      </div>
      <div className="mt-2 flex items-end justify-between gap-2 pl-1">
        <div className="flex items-baseline gap-1">
          <span className={cn("text-2xl font-bold tabular-nums tracking-tight leading-none", intentValueColor[intent])}>{value}</span>
          {unit && <span className="text-[10px] text-muted-foreground font-medium">{unit}</span>}
        </div>
        {sparkline && sparkline.length >= 2 && (
          <Sparkline data={sparkline} color={intentSparkColor[intent]} title={sparklineTitle} />
        )}
      </div>
      {(trendLabel || hint) && (
        <div className="mt-1.5 pl-1 space-y-0.5">
          {trendLabel && <p className="text-[10px] text-muted-foreground font-medium leading-tight">{trendLabel}</p>}
          {hint && <p className="text-[9px] text-muted-foreground/70 leading-tight">{hint}</p>}
        </div>
      )}
    </button>
  );
}

// Compact KPI variant for inline use in section headers
export function KpiPill({ label, value, intent = "default", icon: Icon }: { label: string; value: string | number; intent?: "default" | "critical" | "warning" | "success" | "info"; icon?: LucideIcon }) {
  const colors = {
    default: "bg-muted/60 text-foreground border-border",
    critical: "bg-rose-100 text-rose-800 border-rose-300 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-900",
    warning: "bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900",
    success: "bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900",
    info: "bg-sky-100 text-sky-800 border-sky-300 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-900",
  };
  return (
    <span className={cn("inline-flex items-center gap-1 px-2 py-1 rounded-md border text-[10px] font-semibold tabular-nums", colors[intent])}>
      {Icon && <Icon className="h-3 w-3" />}
      <span className="text-muted-foreground font-normal uppercase tracking-wide text-[9px]">{label}</span>
      <span>{value}</span>
    </span>
  );
}
