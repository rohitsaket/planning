"use client";

import { cn } from "@/lib/utils";
import { ReactNode } from "react";

interface BadgeProps {
  children: ReactNode;
  variant?: "default" | "critical" | "high" | "medium" | "low" | "info" | "warning" | "success" | "neutral" | "advisory" | "simulation";
  className?: string;
}

const variantClasses: Record<string, string> = {
  default: "bg-muted/80 text-muted-foreground border-border/80",
  critical: "bg-[#18181B] text-white border-[#18181B] dark:bg-rose-950/70 dark:text-rose-200 dark:border-rose-900 shadow-2xs font-bold",
  high: "bg-[#3F3F46] text-white border-[#3F3F46] dark:bg-orange-950/70 dark:text-orange-200 dark:border-orange-900 shadow-2xs font-bold",
  medium: "bg-[#F4F4F5] text-[#18181B] border-[#E4E4E7] dark:bg-zinc-800 dark:text-zinc-200 dark:border-zinc-700 font-bold",
  low: "bg-[#EFF6FF] text-[#2563EB] border-[#BFDBFE] dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-900/60",
  info: "bg-[#F3E8FF] text-[#7E22CE] border-[#E9D5FF] dark:bg-purple-950/40 dark:text-purple-300 dark:border-purple-900/60",
  warning: "bg-[#FEF3C7] text-[#B45309] border-[#FDE68A] dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900/60",
  success: "bg-[#D1FAE5] text-[#047857] border-[#A7F3D0] dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900/60",
  advisory: "bg-[#F3E8FF] text-[#7E22CE] border-[#E9D5FF] dark:bg-purple-950/40 dark:text-purple-300 dark:border-purple-900/60",
  simulation: "bg-[#FFF7E6] text-[#B45309] border-[#FDE68A] dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800/60",
  neutral: "bg-zinc-100 text-zinc-700 border-zinc-200/90 dark:bg-zinc-800 dark:text-zinc-300 dark:border-zinc-700",
};

const variantDot: Record<string, string> = {
  success: "bg-[#10B981]",
  warning: "bg-[#F59E0B]",
  critical: "bg-rose-500",
  high: "bg-orange-500",
  info: "bg-purple-500",
  simulation: "bg-amber-500",
};

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const map: Record<string, BadgeProps["variant"]> = {
    CRITICAL: "critical",
    HIGH: "high",
    MEDIUM: "medium",
    LOW: "low",
    WATCH: "neutral",
    APPROVED: "success",
    RELEASED_TO_MANUFACTURING: "success",
    RELEASED: "success",
    SELECTED: "info",
    APPROVAL_PENDING: "warning",
    READY_FOR_REVIEW: "warning",
    DRAFT: "neutral",
    REJECTED: "critical",
    REPLAN_REQUIRED: "warning",
    CANCELLED: "neutral",
    SUPERSEDED: "neutral",
    ACTIVE: "info",
    PARTIALLY_COVERED: "warning",
    FULLY_PLANNED: "success",
    IN_MANUFACTURING: "info",
    PARTIALLY_FULFILLED: "warning",
    FULFILLED: "success",
    ON_HOLD: "neutral",
    EXPIRED: "neutral",
    ERROR: "critical",
    BLOCKING: "critical",
    WARNING: "warning",
    INFO: "info",
    OPEN: "info",
    IN_REVIEW: "warning",
    RESOLVED: "success",
    IGNORED: "neutral",
    FAILED: "critical",
    PARTIAL: "warning",
    SUCCESS: "success",
    HEALTHY: "success",
    RUNNING: "info",
    AVAILABLE: "success",
    RESERVED: "warning",
    HOLD: "neutral",
    TRANSFER: "info",
    MEMO: "info",
    PHYSICAL: "neutral",
    PLANNING_AVAILABLE: "success",
    SOFT_RESERVED: "warning",
    UNDER_PLANNING: "info",
    PLAN_APPROVED: "success",
    // Honest states for checks that have not run or policies that are not configured.
    NOT_RUN: "neutral",
    NOT_CONFIGURED: "warning",
    UNAVAILABLE: "warning",
    UNKNOWN: "neutral",
    STALE: "warning",
    DEGRADED: "warning",
    CONFIGURED: "success",
    WIP_COVERAGE_APPLIED: "success",
    WIP_COVERAGE_UNAVAILABLE: "warning",
    ADVISORY: "info",
    ADVISORY_UNCONFIRMED: "warning",
    ADVISORY_CONFIRMED_RULE: "info",
  };
  const variant = map[status] ?? "default";
  return <Badge variant={variant} className={className}>{status.replace(/_/g, " ")}</Badge>;
}

export function Badge({ children, variant = "default", className }: BadgeProps) {
  const dotColor = variantDot[variant];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-semibold border whitespace-nowrap shadow-2xs transition-all",
        variantClasses[variant],
        className
      )}
    >
      {dotColor && <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", dotColor)} />}
      <span>{children}</span>
    </span>
  );
}

export function Pill({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-medium bg-muted/80 text-muted-foreground border border-border/80", className)}>
      {children}
    </span>
  );
}
