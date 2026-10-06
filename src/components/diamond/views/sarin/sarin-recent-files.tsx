"use client";

import { useMemo, useState } from "react";
import { useApi } from "@/lib/api-client";
import { Section } from "@/components/diamond/shared/page-header";
import { Badge } from "@/components/diamond/shared/badges";
import { InfoBanner } from "@/components/diamond/shared/empty-state";
import { Button } from "@/components/ui/button";
import { formatIST } from "@/lib/fantasy/time";
import { SarinLoadError } from "./sarin-load-error";
import { packetTypeName } from "@/lib/domain/packet-type";
import { useOutputExport } from "./sarin-file-result";
import { fileStatus, type FileStatus, type ImportSummary, type Paged, type ProcessingRights } from "./sarin-processing";
import { DataTable, type Column } from "@/components/diamond/shared/data-table";
import { ServerPagination } from "@/components/diamond/shared/server-pagination";

const PAGE = 10;

const STATUS_VARIANT: Record<FileStatus, "success" | "warning" | "critical" | "info" | "neutral"> = {
  Processing: "info",
  "Needs Attention": "warning",
  "Output Ready": "success",
  "Output Ready with Warnings": "warning",
  Failed: "critical",
  Archived: "neutral",
};

function canProcessAgain(b: ImportSummary, rights: ProcessingRights): boolean {
  if (b.status === "ARCHIVED" || b.status === "VALIDATING") return false;
  if (b.revalidationRequired || b.status === "FAILED" || b.status === "UPLOADED") return rights.validate;
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

  const columns: Column<ImportSummary>[] = useMemo(
    () => [
      {
        key: "fileName",
        header: "File",
        sortable: true,
        sortValue: (b) => b.sourceFile.fileName,
        cell: (b) => (
          <span className="font-medium max-w-[240px] truncate block" title={b.sourceFile.fileName}>
            {b.sourceFile.fileName}
          </span>
        ),
      },
      {
        key: "packetType",
        header: "Packet Type",
        sortable: true,
        sortValue: (b) => packetTypeName(b.packetType),
        cell: (b) => packetTypeName(b.packetType),
      },
      {
        key: "planningDate",
        header: "Planning Date",
        sortable: true,
        sortValue: (b) => b.planningDate,
        cell: (b) => <span className="tabular-nums">{b.planningDate}</span>,
      },
      {
        key: "labId",
        header: "Lab",
        sortable: true,
        sortValue: (b) => b.labId ?? "",
        cell: (b) => b.labId ?? "—",
      },
      {
        key: "createdAt",
        header: "Processed",
        sortable: true,
        sortValue: (b) => new Date(b.createdAt).getTime(),
        cell: (b) => <span className="whitespace-nowrap text-muted-foreground">{formatIST(b.createdAt, false)}</span>,
      },
      {
        key: "status",
        header: "Status",
        sortable: true,
        sortValue: (b) => fileStatus(b),
        cell: (b) => {
          const status = fileStatus(b);
          return <Badge variant={STATUS_VARIANT[status]}>{status}</Badge>;
        },
      },
      {
        key: "action",
        header: "Action",
        align: "right",
        cell: (b) => {
          const status = fileStatus(b);
          return (
            <div className="flex flex-wrap items-center justify-end gap-1">
              <Button
                size="sm"
                variant="outline"
                className="h-6 px-2 text-[11px]"
                onClick={() => onOpen(b.id)}
                aria-label={`Open ${b.sourceFile.fileName}`}
              >
                Open
              </Button>
              {(status === "Output Ready" || status === "Output Ready with Warnings") && rights.export && b.currentOutputId && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 px-2 text-[11px]"
                  disabled={exporter.exporting !== null}
                  aria-label={`Export output of ${b.sourceFile.fileName}`}
                  onClick={() => void exporter.run(b.id, b.currentOutputId!, "xlsx")}
                >
                  Export XLSX
                </Button>
              )}
              {canProcessAgain(b, rights) && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 px-2 text-[11px]"
                  disabled={busy}
                  aria-label={`Process ${b.sourceFile.fileName} again`}
                  onClick={() => onProcessAgain(b.id)}
                >
                  Process Again
                </Button>
              )}
            </div>
          );
        },
      },
    ],
    [busy, exporter, onOpen, onProcessAgain, rights],
  );

  return (
    <Section title="Recent Files" description="Uploaded and processed Sarin workbooks">
      {exporter.error && (
        <div role="alert" className="mb-2">
          <InfoBanner variant="critical">{exporter.error}</InfoBanner>
        </div>
      )}
      {files.error ? (
        <SarinLoadError what="Recent files" error={files.error} retrying={files.isFetching} onRetry={() => void files.refetch()} />
      ) : (
        <div className="flex flex-col gap-2">
          <DataTable<ImportSummary>
            tableId="sarin-recent-files"
            columns={columns}
            rows={files.data?.rows ?? []}
            loading={files.isLoading}
            emptyMessage="No files yet."
            rowClassName={(b) => (selected === b.id ? "bg-muted/70 font-medium" : "")}
          />
          <ServerPagination
            page={page}
            pageSize={PAGE}
            total={files.data?.total ?? 0}
            hasMore={page * PAGE < (files.data?.total ?? 0)}
            onPageChange={setPage}
            loading={files.isLoading}
            label="files"
          />
        </div>
      )}
    </Section>
  );
}


