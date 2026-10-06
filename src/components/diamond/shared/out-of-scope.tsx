"use client";

import { Ban } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNavStore } from "@/stores/nav-store";

/**
 * Where a link to a retired page lands — manufacturing execution, traceability, plan versus
 * actual, forecasting and predictive models, reports, stock strategy, reorder or transfer
 * analysis, the legacy planning workbench and approvals, rough stock, and requirements and
 * orders. This says so
 * plainly instead of showing old or demonstration records or silently sending the reader
 * elsewhere. It shows no data and requests none.
 */
const REASONS: Record<string, string> = {
  "rough-stock": "No authoritative rough-stock source is configured.",
  requirements: "Requirements and order workflows are not configured for this planning utility.",
};
const DEFAULT_REASON =
  "This page is outside the current planning utility. Manufacturing execution, production tracking, plan-versus-actual " +
  "results, forecasting models, report libraries and the legacy planning workbench are not part of it. Planning outputs " +
  "and their source records are available in Workbook Import.";

export function OutOfScopeView() {
  const setView = useNavStore((s) => s.setView);
  // An alias may name why the page is unavailable; the reason key is carried as the tab.
  const reason = useNavStore((s) => (s.tab ? REASONS[s.tab] : undefined)) ?? DEFAULT_REASON;
  return (
    <div data-page-body className="flex flex-col gap-section px-page-x py-page-y">
      <div role="status" className="flex flex-col items-center gap-2 rounded-lg border border-border/80 bg-card px-6 py-10 text-center">
        <div className="rounded-full bg-muted/70 p-2 text-muted-foreground" aria-hidden>
          <Ban className="h-5 w-5" />
        </div>
        <h1 className="text-lg font-semibold tracking-tight">Not available</h1>
        <p className="max-w-md text-sm text-muted-foreground">{reason}</p>
        <div className="mt-1 flex flex-wrap justify-center gap-2">
          <Button size="sm" onClick={() => setView("planning-workbook-import")}>Open Workbook Import</Button>
          <Button size="sm" variant="outline" onClick={() => setView("dashboard")}>Go to Overview</Button>
        </div>
      </div>
    </div>
  );
}
