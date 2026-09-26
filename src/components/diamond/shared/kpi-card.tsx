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
  default: "border-border/80 bg-card hover:border-[#F5CEB5] dark:hover:border-border hover:shadow-[0_8px_24px_-6px_rgba(249,115,62,0.08)]",
  critical: "border-border/80 bg-card hover:border-rose-300 dark:hover:border-rose-900/60 hover:shadow-[0_8px_24px_-6px_rgba(244,63,94,0.12)]",
  warning: "border-border/80 bg-card hover:border-amber-300 dark:hover:border-amber-900/60 hover:shadow-[0_8px_24px_-6px_rgba(245,158,11,0.12)]",
  success: "border-border/80 bg-card hover:border-emerald-300 dark:hover:border-emerald-900/60 hover:shadow-[0_8px_24px_-6px_rgba(16,185,129,0.12)]",
  info: "border-border/80 bg-card hover:border-purple-300 dark:hover:border-purple-900/60 hover:shadow-[0_8px_24px_-6px_rgba(139,92,246,0.12)]",
  advisory: "border-border/80 bg-card hover:border-purple-300 dark:hover:border-purple-900/60 hover:shadow-[0_8px_24px_-6px_rgba(139,92,246,0.12)]",
};

const intentAccent: Record<string, string> = {
  default: "bg-muted text-muted-foreground",
  critical: "bg-[#FDE8E4] text-[#E11D48] dark:bg-rose-950/40 dark:text-rose-400",
  warning: "bg-[#FEF3C7] text-[#D97706] dark:bg-amber-950/40 dark:text-amber-400",
  success: "bg-[#D1FAE5] text-[#059669] dark:bg-emerald-950/40 dark:text-emerald-400",
  info: "bg-[#EDE9FE] text-[#7C3AED] dark:bg-purple-950/40 dark:text-purple-400",
  advisory: "bg-[#EDE9FE] text-[#7C3AED] dark:bg-purple-950/40 dark:text-purple-400",
};

const intentIconContainer: Record<string, string> = {
  default: "bg-muted/80 text-muted-foreground group-hover:scale-105 transition-transform duration-200",
  critical: "bg-[#FDE8E4] text-[#E11D48] dark:bg-rose-950/50 dark:text-rose-300 group-hover:scale-105 transition-transform duration-200",
  warning: "bg-[#FEF3C7] text-[#D97706] dark:bg-amber-950/50 dark:text-amber-300 group-hover:scale-105 transition-transform duration-200",
  success: "bg-[#D1FAE5] text-[#059669] dark:bg-emerald-950/50 dark:text-emerald-300 group-hover:scale-105 transition-transform duration-200",
  info: "bg-[#EDE9FE] text-[#7C3AED] dark:bg-purple-950/50 dark:text-purple-300 group-hover:scale-105 transition-transform duration-200",
  advisory: "bg-[#EDE9FE] text-[#7C3AED] dark:bg-purple-950/50 dark:text-purple-300 group-hover:scale-105 transition-transform duration-200",
};

const intentValueColor: Record<string, string> = {
  default: "text-foreground",
  critical: "text-foreground",
  warning: "text-foreground",
  success: "text-foreground",
  info: "text-foreground",
  advisory: "text-foreground",
};

const intentSparkColor: Record<string, string> = {
  default: "#94a3b8",
  critical: "#F43F5E",
  warning: "#F59E0B",
  success: "#10B981",
  info: "#8B5CF6",
  advisory: "#8B5CF6",
};

function Sparkline({ data, color, title }: { data: number[]; color: string; title?: string }) {
  if (data.length < 2) return null;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const w = 84;
  const h = 26;
  const step = w / (data.length - 1);
  const points = data.map((v, i) => `${i * step},${h - ((v - min) / range) * (h - 4) - 2}`).join(" ");
  const lastVal = data[data.length - 1];
  const firstVal = data[0];
  const rising = lastVal >= firstVal;
  const lastY = h - ((lastVal - min) / range) * (h - 4) - 2;
  const gradientId = `spark-${color.replace("#", "")}-${Math.random().toString(36).slice(2, 7)}`;

  return (
    <svg width={w} height={h} className="opacity-85 overflow-visible" role={title ? "img" : undefined} aria-label={title}>
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.25} />
          <stop offset="100%" stopColor={color} stopOpacity={0.0} />
        </linearGradient>
      </defs>
      <polygon
        points={`0,${h} ${points} ${w},${h}`}
        fill={`url(#${gradientId})`}
      />
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle
        cx={(data.length - 1) * step}
        cy={lastY}
        r={3}
        fill={color}
        className="animate-pulse"
      />
      {title ? <title>{title}</title> : !rising && <title>Declining trend</title>}
    </svg>
  );
}

export function KpiCard({ label, value, unit, trend, trendLabel, intent = "default", hint, icon: Icon, sparkline, sparklineTitle, onClick, subtitle }: KpiCardProps) {
  return (
    <div
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      className={cn(
        "text-left w-full p-4 rounded-2xl border transition-all duration-200 group relative overflow-hidden bg-card shadow-xs",
        intentClasses[intent],
        onClick && "hover:-translate-y-0.5 cursor-pointer active:scale-[0.99]"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-muted-foreground leading-tight tracking-wide truncate">{label}</p>
          {subtitle && <p className="text-[10px] text-muted-foreground/80 mt-0.5 truncate">{subtitle}</p>}
        </div>
        {Icon && (
          <div className={cn("p-2 rounded-xl shrink-0 shadow-2xs", intentIconContainer[intent])}>
            <Icon className="h-4 w-4" />
          </div>
        )}
      </div>

      <div className="mt-3 flex items-end justify-between gap-2">
        <div className="flex items-baseline gap-1.5">
          <span className={cn("text-2xl sm:text-3xl font-extrabold tabular-nums tracking-tight leading-none text-foreground")}>{value}</span>
          {unit && <span className="text-[11px] text-muted-foreground font-semibold">{unit}</span>}
        </div>
        {sparkline && sparkline.length >= 2 && (
          <Sparkline data={sparkline} color={intentSparkColor[intent]} title={sparklineTitle} />
        )}
      </div>

      {(trendLabel || hint || typeof trend === "number") && (
        <div className="mt-2.5 pt-2 border-t border-border/40 flex items-center justify-between gap-2 flex-wrap text-[10.5px]">
          {typeof trend === "number" && (
            <span
              className={cn(
                "inline-flex items-center gap-1 font-bold shrink-0 px-1.5 py-0.5 rounded-full text-[10px]",
                trend > 0 ? "text-emerald-700 bg-emerald-50 dark:text-emerald-300 dark:bg-emerald-950/40" :
                trend < 0 ? "text-rose-700 bg-rose-50 dark:text-rose-300 dark:bg-rose-950/40" :
                "text-muted-foreground bg-muted/60"
              )}
            >
              {trend > 0 ? "↑" : trend < 0 ? "↓" : "—"}
              {Math.abs(trend).toFixed(1)}% {trendLabel ? `vs ${trendLabel}` : ""}
            </span>
          )}
          {!trend && trendLabel && <p className="text-muted-foreground font-medium truncate">{trendLabel}</p>}
          {hint && <p className="text-[10px] text-muted-foreground/75 truncate">{hint}</p>}
        </div>
      )}
    </div>
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
