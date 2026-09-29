"use client";

import { Ban } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNavStore } from "@/stores/nav-store";

/**
 * Where a link to a retired page lands — manufacturing execution, traceability, plan versus
 * actual, forecasting and predictive models, reports, stock strategy, reorder or transfer
 * analysis. Those are outside the planning utility, so this says so plainly instead of showing
 * old or demonstration records or silently sending the reader elsewhere. It shows no data.
 */
export function OutOfScopeView() {
  const setView = useNavStore((s) => s.setView);
  return (
    <div data-page-body className="flex flex-col gap-section px-page-x py-page-y">
      <div role="status" className="flex flex-col items-center gap-2 rounded-lg border border-border/80 bg-card px-6 py-10 text-center">
        <div className="rounded-full bg-muted/70 p-2 text-muted-foreground" aria-hidden>
          <Ban className="h-5 w-5" />
        </div>
        <h1 className="text-lg font-semibold tracking-tight">Not available</h1>
        <p className="max-w-md text-sm text-muted-foreground">
          This page is outside the current planning utility. Manufacturing execution, production tracking, plan-versus-actual
          results, forecasting models and report libraries are not part of it. Planning outputs and their source records are
          available in Workbook Import and Planning Workbench.
        </p>
        <div className="mt-1 flex flex-wrap justify-center gap-2">
          <Button size="sm" onClick={() => setView("planning-workbook-import")}>Open Workbook Import</Button>
          <Button size="sm" variant="outline" onClick={() => setView("dashboard")}>Go to Overview</Button>
        </div>
      </div>
    </div>
  );
}
