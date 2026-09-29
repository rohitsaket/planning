"use client";

import { FlaskConical } from "lucide-react";
import { Badge } from "@/components/diamond/shared/badges";
import { formatIST } from "@/lib/fantasy/time";
import type { SalesReadiness, SalesReadinessState } from "@/lib/analytics/sales-history-contract";

type Variant = React.ComponentProps<typeof Badge>["variant"];

/**
 * The compact sales-data status: one state, the figures a reader needs to trust the page,
 * and at most one next action. Nothing is shown as ready on the strength of a check that
 * did not run; a figure the snapshot could not establish reads "Unavailable", never zero.
 */
const STATUS: Record<SalesReadinessState, { label: string; variant: Variant; next: string | null }> = {
  CURRENT: { label: "Ready", variant: "success", next: null },
  SIMULATED: { label: "Simulated", variant: "warning", next: null },
  STALE: { label: "Stale", variant: "warning", next: "Run the demand calculation to refresh sales." },
  INCOMPLETE: { label: "Incomplete", variant: "warning", next: "Review excluded records in Data Quality." },
  BLOCKED_BY_DATA_QUALITY: { label: "Needs Review", variant: "critical", next: "Review excluded records in Data Quality." },
  NOT_RUN: { label: "Not Run", variant: "neutral", next: "Run the demand calculation to load sales." },
  UNAVAILABLE: { label: "Unavailable", variant: "neutral", next: null },
};

const figure = (value: number | null) => (value === null ? "Unavailable" : value.toLocaleString());

export function SalesReadinessPanel({ readiness, loading }: { readiness?: SalesReadiness; loading?: boolean }) {
  if (loading) return null;
  const status = STATUS[readiness?.state ?? "UNAVAILABLE"];
  const snapshot = readiness?.snapshot;
  return (
    <section aria-label="Sales data status" className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-border bg-card px-3 py-2 text-[11px]">
      <span className="flex items-center gap-1.5">
        <span className="text-muted-foreground">Sales data</span>
        <Badge variant={status.variant}>{status.label}</Badge>
        {snapshot?.isSimulated && readiness?.state !== "SIMULATED" && (
          <Badge variant="warning" className="gap-1"><FlaskConical className="h-3 w-3" aria-hidden />Simulated</Badge>
        )}
      </span>
      {readiness && (
        <>
          <Fact label="Window" value={snapshot?.windowDays ? `${snapshot.windowDays} days` : "Unavailable"} />
          <Fact label="Confirmed quantity" value={figure(readiness.eligibleConfirmedQuantity)} />
          <Fact label="Excluded records" value={figure(readiness.excludedRecords)} />
          <Fact label="Last sync" value={readiness.lastSuccessfulSyncAt ? formatIST(readiness.lastSuccessfulSyncAt, false) : "Not Run"} />
        </>
      )}
      {status.next && <span className="font-medium text-foreground">{status.next}</span>}
    </section>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <span>
      <span className="text-muted-foreground">{label}: </span>
      <span className="font-medium tabular-nums">{value}</span>
    </span>
  );
}
