"use client";

// Recent Files: the imports the user may see (scoped on the server), newest first, with a
// business status and the actions that apply.

import { useState } from "react";
import { useApi } from "@/lib/api-client";
import { Section } from "@/components/diamond/shared/page-header";
import { Badge } from "@/components/diamond/shared/badges";
import { InfoBanner } from "@/components/diamond/shared/empty-state";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatIST } from "@/lib/fantasy/time";
import { SarinLoadError } from "./sarin-load-error";
import { packetTypeName } from "@/lib/domain/packet-type";
import { useOutputExport } from "./sarin-file-result";
import { fileStatus, type FileStatus, type ImportSummary, type Paged, type ProcessingRights } from "./sarin-processing";

const PAGE = 10;

const STATUS_VARIANT: Record<FileStatus, "success" | "warning" | "critical" | "info" | "neutral"> = {
  Processing: "info",
  "Needs Attention": "warning",
  "Output Ready": "success",
  "Output Ready with Warnings": "warning",
  Failed: "critical",
  Archived: "neutral",
};

/** Whether this user can move the file on from its stored state. */
function canProcessAgain(b: ImportSummary, rights: ProcessingRights): boolean {
  if (b.status === "ARCHIVED" || b.status === "VALIDATING") return false;
  if (b.revalidationRequired || b.status === "FAILED" || b.status === "UPLOADED") return rights.validate;
  // Output that shows unmapped shapes can be processed again once they are mapped.
  if (b.status === "VALIDATED" && b.currentOutputId && b.currentOutputUnmappedRows > 0) return rights.validate;
  return b.status === "VALIDATED" && !b.currentOutputId && rights.generate;
}

export function SarinRecentFiles({
  rights,
  selected,
  busy,
  onOpen,
  onProcessAgain,
}: {
  rights: ProcessingRights;
  selected: string | null;
  busy: boolean;
  onOpen: (batchId: string) => void;
  onProcessAgain: (batchId: string) => void;
}) {
  const [page, setPage] = useState(1);
  const files = useApi<Paged<ImportSummary>>(`/api/planning/sarin/imports?pageSize=${PAGE}&page=${page}`);
  const exporter = useOutputExport();
  const pages = Math.max(1, Math.ceil((files.data?.total ?? 0) / PAGE));

  return (
    <Section title="Recent Files" bodyClassName="p-2">
      {files.isLoading ? (
        <p className="px-1 text-[11px] text-muted-foreground" role="status">Loading files…</p>
      ) : files.error ? (
        <SarinLoadError what="Recent files" error={files.error} retrying={files.isFetching} onRetry={() => void files.refetch()} />
      ) : !files.data?.rows.length ? (
        <p className="p-2 text-[11px] text-muted-foreground">No files yet.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {exporter.error && <div role="alert"><InfoBanner variant="critical">{exporter.error}</InfoBanner></div>}
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full min-w-[780px] border-collapse text-xs">
              <thead className="border-b border-border bg-muted/60 text-[10px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  {["File", "Packet type", "Planning date", "Lab", "Processed", "Status", "Action"].map((h) => (
                    <th key={h} scope="col" className="px-2 py-1.5 text-left">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {files.data.rows.map((b) => {
                  const status = fileStatus(b);
                  return (
                    <tr key={b.id} className={cn("border-b border-border/40 last:border-0", selected === b.id && "bg-muted/60")} aria-current={selected === b.id ? "true" : undefined}>
                      <td className="max-w-[240px] truncate px-2 py-1.5 font-medium" title={b.sourceFile.fileName}>{b.sourceFile.fileName}</td>
                      <td className="px-2 py-1.5">{packetTypeName(b.packetType)}</td>
                      <td className="px-2 py-1.5 tabular-nums">{b.planningDate}</td>
                      <td className="px-2 py-1.5">{b.labId ?? "—"}</td>
                      <td className="px-2 py-1.5 whitespace-nowrap text-muted-foreground">{formatIST(b.createdAt, false)}</td>
                      <td className="px-2 py-1.5"><Badge variant={STATUS_VARIANT[status]}>{status}</Badge></td>
                      <td className="px-2 py-1">
                        <div className="flex flex-wrap items-center gap-1">
                          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => onOpen(b.id)} aria-label={`Open ${b.sourceFile.fileName}`}>Open</Button>
                          {(status === "Output Ready" || status === "Output Ready with Warnings") && rights.export && b.currentOutputId && (
                            <Button size="sm" variant="outline" className="h-7 text-xs" disabled={exporter.exporting !== null} aria-label={`Export output of ${b.sourceFile.fileName}`} onClick={() => void exporter.run(b.id, b.currentOutputId!, "xlsx")}>
                              Export XLSX
                            </Button>
                          )}
                          {canProcessAgain(b, rights) && (
                            <Button size="sm" variant="outline" className="h-7 text-xs" disabled={busy} aria-label={`Process ${b.sourceFile.fileName} again`} onClick={() => onProcessAgain(b.id)}>
                              Process Again
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {pages > 1 && (
            <nav className="flex items-center gap-2 px-1 text-[11px]" aria-label="Recent file pages">
              <Button size="sm" variant="outline" className="h-7" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
              <span className="tabular-nums">Page {page} of {pages} · {files.data.total.toLocaleString("en-IN")} files</span>
              <Button size="sm" variant="outline" className="h-7" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Next</Button>
            </nav>
          )}
        </div>
      )}
    </Section>
  );
}

