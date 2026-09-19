"use client";

import { cn } from "@/lib/utils";
import { ReactNode } from "react";

interface BadgeProps {
  children: ReactNode;
  variant?: "default" | "critical" | "high" | "medium" | "low" | "info" | "warning" | "success" | "neutral";
  className?: string;
}

const variantClasses: Record<string, string> = {
  default: "bg-muted text-muted-foreground border-border",
  critical: "bg-rose-100 text-rose-800 border-rose-300 dark:bg-rose-950/50 dark:text-rose-300 dark:border-rose-900",
  high: "bg-orange-100 text-orange-800 border-orange-300 dark:bg-orange-950/50 dark:text-orange-300 dark:border-orange-900",
  medium: "bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-900",
  low: "bg-sky-100 text-sky-800 border-sky-300 dark:bg-sky-950/50 dark:text-sky-300 dark:border-sky-900",
  info: "bg-cyan-100 text-cyan-800 border-cyan-300 dark:bg-cyan-950/50 dark:text-cyan-300 dark:border-cyan-900",
  warning: "bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-900",
  success: "bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-900",
  neutral: "bg-gray-100 text-gray-700 border-gray-300 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700",
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
  };
  const variant = map[status] ?? "default";
  return <Badge variant={variant} className={className}>{status.replace(/_/g, " ")}</Badge>;
}

export function Badge({ children, variant = "default", className }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium border whitespace-nowrap",
        variantClasses[variant],
        className
      )}
    >
      {children}
    </span>
  );
}

export function Pill({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-muted text-muted-foreground border border-border", className)}>
      {children}
    </span>
  );
}
