"use client";

import { PageHeader } from "@/components/diamond/shared/page-header";
import { Database, Clock, ShieldCheck, Layers, FileSpreadsheet, HardDrive } from "lucide-react";

export function OverallDataView() {
  return (
    <div className="flex flex-col gap-4 p-3">
      <PageHeader
        title="Overall Data"
        subtitle="Permanent current and historical Lot records retained from Fantasy synchronization"
      />

      {/* Information Banner */}
      <div className="rounded-lg border border-border bg-card p-6 shadow-xs">
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary border border-primary/20">
            <HardDrive className="h-6 w-6" />
          </div>
          <div className="space-y-1">
            <h2 className="text-sm font-semibold text-foreground">
              Master Historical Data Archive
            </h2>
            <p className="text-xs text-muted-foreground leading-relaxed">
              This module serves as the authoritative, permanent record store for all historical and current
              lot records synchronized from Fantasy ERP. Unlike active working views that focus on immediate
              operational windows (such as the 90-day demand and requirement horizon), Overall Data preserves
              complete stone genealogy, lifecycle movement logs, and historical transactions.
            </p>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-3 pt-6 border-t border-border">
          <div className="rounded-md border border-border/60 bg-muted/30 p-3.5 space-y-1.5">
            <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
              <Database className="h-3.5 w-3.5 text-primary" />
              <span>Full Lineage Retention</span>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Archival storage of rough-to-polished transformation records and historical yield metrics across all financial quarters.
            </p>
          </div>

          <div className="rounded-md border border-border/60 bg-muted/30 p-3.5 space-y-1.5">
            <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
              <Clock className="h-3.5 w-3.5 text-primary" />
              <span>Multi-Year Audit History</span>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Permanent snapshot tracking of lot status changes, location transfers, and customer fulfillment logs.
            </p>
          </div>

          <div className="rounded-md border border-border/60 bg-muted/30 p-3.5 space-y-1.5">
            <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
              <FileSpreadsheet className="h-3.5 w-3.5 text-primary" />
              <span>Bulk Historical Query & Export</span>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Dedicated search, multi-field filtering, and enterprise report export across historical datasets.
            </p>
          </div>
        </div>

        <div className="mt-5 rounded-md bg-muted/50 p-3 text-[11px] text-muted-foreground border border-border/40 flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-emerald-500 flex-shrink-0" />
          <span>
            Detailed historical dataset tables, query engines, and deep export tools will be delivered in the upcoming Phase 2 data release.
          </span>
        </div>
      </div>
    </div>
  );
}
