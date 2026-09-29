"use client";

import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

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
  // Describes what the sparkline plots, for assistive technology. Without it the sparkline
  // carries no text: a rising/declining label is only meaningful for chronological data.
  sparklineTitle?: string;
  onClick?: () => void;
  subtitle?: string;
}

const intentClasses: Record<string, string> = {
  default: "border-border/80 bg-card/85 backdrop-blur-xs hover:bg-card hover:border-[#F5CEB5] dark:hover:border-border hover:shadow-[0_8px_24px_-6px_rgba(249,115,62,0.08)]",
  critical: "border-border/80 bg-card/85 backdrop-blur-xs hover:bg-card hover:border-rose-300 dark:hover:border-rose-900/60 hover:shadow-[0_8px_24px_-6px_rgba(244,63,94,0.12)]",
  warning: "border-border/80 bg-card/85 backdrop-blur-xs hover:bg-card hover:border-amber-300 dark:hover:border-amber-900/60 hover:shadow-[0_8px_24px_-6px_rgba(245,158,11,0.12)]",
  success: "border-border/80 bg-card/85 backdrop-blur-xs hover:bg-card hover:border-emerald-300 dark:hover:border-emerald-900/60 hover:shadow-[0_8px_24px_-6px_rgba(16,185,129,0.12)]",
  info: "border-border/80 bg-card/85 backdrop-blur-xs hover:bg-card hover:border-purple-300 dark:hover:border-purple-900/60 hover:shadow-[0_8px_24px_-6px_rgba(139,92,246,0.12)]",
  advisory: "border-border/80 bg-card/85 backdrop-blur-xs hover:bg-card hover:border-purple-300 dark:hover:border-purple-900/60 hover:shadow-[0_8px_24px_-6px_rgba(139,92,246,0.12)]",
};

const intentIconColor: Record<string, string> = {
  default: "text-muted-foreground",
  critical: "text-[#E11D48] dark:text-rose-300",
  warning: "text-[#D97706] dark:text-amber-300",
  success: "text-[#059669] dark:text-emerald-300",
  info: "text-[#7C3AED] dark:text-purple-300",
  advisory: "text-[#7C3AED] dark:text-purple-300",
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
  const w = 64;
  const h = 20;
  const step = w / (data.length - 1);
  const points = data.map((v, i) => `${i * step},${h - ((v - min) / range) * (h - 4) - 2}`).join(" ");
  const lastVal = data[data.length - 1];
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
      {title && <title>{title}</title>}
    </svg>
  );
}

/**
 * A compact KPI: label with a small inline icon, a prominent value with its unit, and at
 * most one supporting line. Clickable cards are real keyboard targets.
 */
export function KpiCard({ label, value, unit, trend, trendLabel, intent = "default", hint, icon: Icon, sparkline, sparklineTitle, onClick, subtitle }: KpiCardProps) {
  return (
    <div
      data-kpi
      onClick={onClick}
      onKeyDown={onClick ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } } : undefined}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      className={cn(
        "group relative w-full min-w-0 overflow-hidden rounded-lg border bg-card px-3 py-2.5 text-left transition-colors",
        intentClasses[intent],
        onClick && "cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      )}
    >
      <div className="flex min-w-0 items-center gap-1.5">
        {Icon && <Icon className={cn("h-3.5 w-3.5 shrink-0", intentIconColor[intent])} aria-hidden />}
        <p className="truncate text-xs font-medium text-muted-foreground" title={label.length > 20 ? label : undefined}>{label}</p>
      </div>
      {subtitle && <p className="truncate text-[11px] text-muted-foreground/80" title={subtitle}>{subtitle}</p>}

      <div className="mt-1 flex items-end justify-between gap-2">
        <div className="flex min-w-0 items-baseline gap-1">
          <span className="text-xl font-bold leading-none tracking-tight tabular-nums text-foreground">{value}</span>
          {unit && <span className="text-[11px] font-medium text-muted-foreground">{unit}</span>}
        </div>
        {sparkline && sparkline.length >= 2 && (
          <Sparkline data={sparkline} color={intentSparkColor[intent]} title={sparklineTitle} />
        )}
      </div>

      {(trendLabel || hint || typeof trend === "number") && (
        <div className="mt-1 flex min-w-0 items-center gap-2 text-[11px]">
          {typeof trend === "number" && (
            <span
              className={cn(
                "inline-flex shrink-0 items-center gap-0.5 font-semibold",
                trend > 0 ? "text-emerald-700 dark:text-emerald-300" : trend < 0 ? "text-rose-700 dark:text-rose-300" : "text-muted-foreground",
              )}
            >
              {trend > 0 ? "↑" : trend < 0 ? "↓" : "—"}
              {Math.abs(trend).toFixed(1)}% {trendLabel ? `vs ${trendLabel}` : ""}
            </span>
          )}
          {!trend && trendLabel && <p className="truncate text-muted-foreground" title={trendLabel}>{trendLabel}</p>}
          {hint && <p className="truncate text-muted-foreground" title={hint}>{hint}</p>}
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
