"use client";

import { AlertTriangle, Database, FlaskConical } from "lucide-react";
import { Section } from "@/components/diamond/shared/page-header";
import { Badge } from "@/components/diamond/shared/badges";
import { InfoBanner, Metric } from "@/components/diamond/shared/empty-state";
import { formatIST } from "@/lib/fantasy/time";
import {
  READINESS_INTENT,
  SALES_READINESS_LABELS,
  type SalesReadiness,
} from "@/lib/analytics/sales-history-contract";

const BADGE_VARIANT: Record<string, React.ComponentProps<typeof Badge>["variant"]> = {
  success: "success",
  info: "info",
  warning: "warning",
  critical: "critical",
  neutral: "neutral",
};

/** A figure the snapshot could not establish is shown as UNAVAILABLE, never as zero. */
function count(value: number | null): string {
  return value === null ? "UNAVAILABLE" : value.toLocaleString();
}

function date(value: string | null): string {
  return value ?? "UNAVAILABLE";
}

/**
 * Sales Data Readiness.
 *
 * States what the figures on this page actually are before showing any of them: which
 * snapshot, produced from what source, covering which dates, how much it admitted, how
 * much it could not, and how old it is. Nothing here is ever rendered as healthy on the
 * strength of a check that did not run.
 */
export function SalesReadinessPanel({ readiness, loading }: { readiness?: SalesReadiness; loading?: boolean }) {
  if (loading || !readiness) {
    return (
      <Section title="Sales Data Readiness">
        <p className="text-[11px] text-muted-foreground">{loading ? "Checking the sales snapshot…" : "Readiness is unavailable."}</p>
      </Section>
    );
  }

  const { snapshot } = readiness;
  const intent = READINESS_INTENT[readiness.state];
  const blocked = readiness.recordsBlockedByMissingCategory ?? 0;
  const duplicates = readiness.duplicateLifecycleEvents ?? 0;
  const unconfirmedQty = readiness.recordsWithUnconfirmedQuantity ?? 0;

  return (
    <Section
      title="Sales Data Readiness"
      description="What these figures are, where they came from, and what they do not cover"
      actions={
        <div className="flex items-center gap-2">
          <Badge variant={BADGE_VARIANT[intent]}>{SALES_READINESS_LABELS[readiness.state]}</Badge>
          <Badge variant={snapshot.isSimulated ? "warning" : "neutral"}>{snapshot.sourceStateLabel}</Badge>
        </div>
      }
    >
      <div className="flex flex-col gap-2">
        {snapshot.isSimulated && (
          <InfoBanner variant="warning">
            <span className="inline-flex items-center gap-1 font-medium">
              <FlaskConical className="h-3 w-3" aria-hidden /> Simulated data
            </span>{" "}
            — every sale below is generated from built-in simulation fixtures. This is not a connection to the Fantasy ERP and
            these are not real customer sales.
          </InfoBanner>
        )}

        <InfoBanner variant={intent === "success" ? "success" : intent === "critical" ? "critical" : "info"}>
          {readiness.explanation}
        </InfoBanner>

        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-3 pt-1">
          <Metric label="Sales cutoff (IST)" value={date(snapshot.salesCutoffIst)} />
          <Metric label="Snapshot window" value={snapshot.windowDays ? `${snapshot.windowDays}D` : "UNAVAILABLE"} />
          <Metric label="History from" value={date(readiness.historyCoverageStart)} />
          <Metric label="History to" value={date(readiness.historyCoverageEnd)} />
          <Metric label="Eligible sale records" value={count(readiness.eligibleSalesRecords)} intent="info" />
          <Metric label="Confirmed quantity" value={count(readiness.eligibleConfirmedQuantity)} intent="success" />
          <Metric label="Excluded records" value={count(readiness.excludedRecords)} intent={(readiness.excludedRecords ?? 0) > 0 ? "warning" : undefined} />
          <Metric label="Duplicate lifecycle events" value={count(readiness.duplicateLifecycleEvents)} intent={duplicates > 0 ? "critical" : "success"} />
          <Metric label="Blocked — category" value={count(readiness.recordsBlockedByMissingCategory)} intent={blocked > 0 ? "warning" : undefined} />
          <Metric label="Blocked — quantity" value={count(readiness.recordsWithUnconfirmedQuantity)} intent={unconfirmedQty > 0 ? "warning" : undefined} />
          <Metric
            label="Snapshot produced"
            value={snapshot.snapshotAt ? formatIST(snapshot.snapshotAt, false) : "NOT RUN"}
          />
          <Metric
            label="Last successful sync"
            value={readiness.lastSuccessfulSyncAt ? formatIST(readiness.lastSuccessfulSyncAt, false) : "NOT RUN"}
          />
        </div>

        <p className="text-[10px] text-muted-foreground leading-relaxed pt-1">
          <Database className="inline h-3 w-3 mr-1 align-[-1px]" aria-hidden />
          Figures are read from the authoritative sales snapshot
          {snapshot.snapshotId ? ` (${snapshot.snapshotId.slice(0, 8)})` : ""}; they cannot be newer than it. Freshness is judged
          against an advisory {readiness.freshnessThresholdHours}-hour threshold set by operations, not a confirmed business
          rule{readiness.snapshotAgeHours !== null ? `; this snapshot is ${readiness.snapshotAgeHours}h old` : ""}. Quantity and
          carat weight are reported separately throughout, and a record count is never presented as a piece quantity.
        </p>

        {!snapshot.approvedWindowLayout && snapshot.snapshotId && (
          <p className="inline-flex items-center gap-1 text-[10px] text-amber-700 dark:text-amber-400" role="status">
            <AlertTriangle className="h-3 w-3" aria-hidden />
            This snapshot was calculated over {snapshot.windowDays} days, not the approved 90-day window, so the three 30-day
            windows and the movement table are unavailable for it.
          </p>
        )}
      </div>
    </Section>
  );
}
