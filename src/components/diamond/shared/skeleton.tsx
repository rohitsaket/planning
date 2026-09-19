"use client";

import { cn } from "@/lib/utils";

interface SkeletonProps {
  className?: string;
  style?: React.CSSProperties;
}

export function Skeleton({ className, style }: SkeletonProps) {
  return (
    <div className={cn("animate-pulse rounded-md bg-muted/60", className)} style={style} />
  );
}

// KPI card skeleton — matches the KpiCard layout
export function KpiCardSkeleton() {
  return (
    <div className="p-3 rounded-lg border border-border bg-card">
      <div className="flex items-center gap-2">
        <Skeleton className="h-6 w-6 rounded-md" />
        <Skeleton className="h-3 w-24" />
      </div>
      <div className="mt-3 flex items-end justify-between gap-2">
        <Skeleton className="h-7 w-20" />
        <Skeleton className="h-6 w-16" />
      </div>
      <Skeleton className="mt-2 h-2 w-full" />
    </div>
  );
}

// KPI grid skeleton — n cards
export function KpiGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
      {Array.from({ length: count }).map((_, i) => <KpiCardSkeleton key={i} />)}
    </div>
  );
}

// Table skeleton — n rows
export function TableSkeleton({ rows = 8, cols = 6 }: { rows?: number; cols?: number }) {
  return (
    <div className="rounded-md border border-border bg-card overflow-hidden">
      {/* Header */}
      <div className="flex border-b border-border bg-muted/40 px-2 py-2 gap-2">
        {Array.from({ length: cols }).map((_, i) => (
          <Skeleton key={i} className="h-3 flex-1" />
        ))}
      </div>
      {/* Rows */}
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex border-b border-border/60 last:border-0 px-2 py-2.5 gap-2">
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton key={c} className="h-3 flex-1" style={{ animationDelay: `${r * 50}ms` }} />
          ))}
        </div>
      ))}
    </div>
  );
}

// Chart skeleton — for recharts containers
export function ChartSkeleton({ height = 256 }: { height?: number }) {
  return (
    <div className="rounded-md border border-border bg-card p-3">
      <Skeleton className="h-4 w-40 mb-3" />
      <div className="flex items-end justify-between gap-2" style={{ height }}>
        {Array.from({ length: 12 }).map((_, i) => (
          <Skeleton
            key={i}
            className="flex-1"
            style={{ height: `${30 + Math.sin(i) * 30 + 40}%`, animationDelay: `${i * 80}ms` }}
          />
        ))}
      </div>
    </div>
  );
}

// Section skeleton — title + body
export function SectionSkeleton({ hasChart = false }: { hasChart?: boolean }) {
  return (
    <div className="rounded-md border border-border bg-card overflow-hidden">
      <div className="px-3 py-2 border-b border-border bg-muted/30">
        <Skeleton className="h-4 w-48" />
      </div>
      <div className="p-3">
        {hasChart ? <ChartSkeleton /> : <TableSkeleton rows={5} cols={6} />}
      </div>
    </div>
  );
}

// Full page skeleton
export function PageSkeleton({ kpiCount = 6, sections = 3 }: { kpiCount?: number; sections?: number }) {
  return (
    <div className="flex flex-col gap-3 p-3">
      <Skeleton className="h-12 w-full" />
      <KpiGridSkeleton count={kpiCount} />
      {Array.from({ length: sections }).map((_, i) => <SectionSkeleton key={i} hasChart={i % 2 === 0} />)}
    </div>
  );
}
