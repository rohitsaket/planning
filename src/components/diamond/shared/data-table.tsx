"use client";

import { cn } from "@/lib/utils";
import { ReactNode, useState } from "react";
import { ChevronDown, ChevronRight, Download, FileSpreadsheet, FileText, Search, SlidersHorizontal } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { exportDataTableToExcel } from "@/lib/excel-export";
import { exportToPDF } from "@/lib/pdf-export";

export interface Column<T> {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  sortable?: boolean;
  sortValue?: (row: T) => number | string;
  width?: string;
  sticky?: "left" | "right";
  align?: "left" | "right" | "center";
}

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  loading?: boolean;
  emptyMessage?: string;
  stickyHeader?: boolean;
  maxHeight?: string;
  onRowClick?: (row: T) => void;
  rowClassName?: (row: T) => string;
  initialSortKey?: string;
  initialSortDir?: "asc" | "desc";
  toolbar?: ReactNode;
  exportable?: boolean;
  exportFilename?: string;
  excelExportable?: boolean;
  excelExportFilename?: string;
  pdfExportable?: boolean;
  pdfExportFilename?: string;
  searchable?: boolean;
  searchPlaceholder?: string;
  searchFn?: (row: T, q: string) => boolean;
  pageSize?: number;
  pagination?: boolean;
}

export function DataTable<T>({
  columns,
  rows,
  loading,
  emptyMessage = "No data available.",
  stickyHeader = true,
  maxHeight = "600px",
  onRowClick,
  rowClassName,
  initialSortKey,
  initialSortDir = "desc",
  toolbar,
  exportable = false,
  exportFilename = "export.csv",
  excelExportable = false,
  excelExportFilename = "export.xlsx",
  pdfExportable = false,
  pdfExportFilename = "export",
  searchable = false,
  searchPlaceholder = "Search...",
  searchFn,
  pageSize = 50,
  pagination = false,
}: DataTableProps<T>) {
  const [sortKey, setSortKey] = useState<string | undefined>(initialSortKey);
  const [sortDir, setSortDir] = useState<"asc" | "desc">(initialSortDir);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);

  let processed = rows;
  if (searchable && searchFn && query) {
    processed = processed.filter((r) => searchFn(r, query));
  }
  if (sortKey) {
    const col = columns.find((c) => c.key === sortKey);
    if (col?.sortValue) {
      processed = [...processed].sort((a, b) => {
        const av = col.sortValue!(a);
        const bv = col.sortValue!(b);
        if (av === bv) return 0;
        const cmp = av < bv ? -1 : 1;
        return sortDir === "asc" ? cmp : -cmp;
      });
    }
  }

  const totalPages = pagination ? Math.max(1, Math.ceil(processed.length / pageSize)) : 1;
  const currentRows = pagination ? processed.slice((page - 1) * pageSize, page * pageSize) : processed;

  const handleSort = (col: Column<T>) => {
    if (!col.sortable) return;
    if (sortKey === col.key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(col.key);
      setSortDir("desc");
    }
  };

  const exportCsv = () => {
    const headers = columns.map((c) => c.header);
    const lines = [headers.join(",")];
    for (const r of processed) {
      const line = columns.map((c) => {
        const val = c.cell(r);
        const s = typeof val === "string" || typeof val === "number" ? String(val) : "";
        return `"${s.replace(/"/g, '""')}"`;
      });
      lines.push(line.join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = exportFilename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportExcel = () => {
    const cols = columns.map((c) => ({ header: c.header, key: c.key }));
    exportDataTableToExcel(processed, cols, excelExportFilename);
  };

  const exportPDF = () => {
    exportToPDF(pdfExportFilename || "export");
  };

  return (
    <div className="flex flex-col gap-2">
      {(searchable || toolbar || exportable || excelExportable || pdfExportable) && (
        <div className="flex items-center gap-2 flex-wrap">
          {searchable && (
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => { setQuery(e.target.value); setPage(1); }}
                placeholder={searchPlaceholder}
                className="h-8 pl-7 text-xs"
              />
            </div>
          )}
          {toolbar}
          {exportable && (
            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={exportCsv}>
              <Download className="h-3 w-3 mr-1" /> Export CSV
            </Button>
          )}
          {excelExportable && (
            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={exportExcel}>
              <FileSpreadsheet className="h-3 w-3 mr-1" /> Export Excel
            </Button>
          )}
          {pdfExportable && (
            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={exportPDF}>
              <FileText className="h-3 w-3 mr-1" /> Export PDF
            </Button>
          )}
          <div className="ml-auto text-[11px] text-muted-foreground">
            {processed.length} {processed.length === 1 ? "row" : "rows"}
          </div>
        </div>
      )}
      <div className="rounded-md border border-border overflow-hidden bg-card" style={{ maxHeight }}>
        <div className="overflow-auto h-full">
          <table className="w-full text-xs border-collapse">
            <thead className={cn(stickyHeader && "sticky top-0 z-10")}>
              <tr className="bg-muted/60 border-b border-border">
                {columns.map((c) => (
                  <th
                    key={c.key}
                    onClick={() => handleSort(c)}
                    className={cn(
                      "px-2 py-2 text-left font-semibold text-muted-foreground uppercase tracking-wide text-[10px] whitespace-nowrap",
                      c.align === "right" && "text-right",
                      c.align === "center" && "text-center",
                      c.sortable && "cursor-pointer hover:bg-muted",
                      c.sticky === "left" && "sticky left-0 bg-muted/80 z-20 border-r",
                      c.sticky === "right" && "sticky right-0 bg-muted/80 z-20 border-l"
                    )}
                    style={c.width ? { width: c.width } : undefined}
                  >
                    <div className="flex items-center gap-1">
                      <span>{c.header}</span>
                      {sortKey === c.key && (
                        <span className="text-[8px]">{sortDir === "asc" ? "▲" : "▼"}</span>
                      )}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={columns.length} className="px-3 py-8 text-center text-muted-foreground">
                    <div className="inline-flex items-center gap-2">
                      <div className="h-3 w-3 border-2 border-muted-foreground border-t-transparent rounded-full animate-spin" />
                      Loading...
                    </div>
                  </td>
                </tr>
              )}
              {!loading && currentRows.length === 0 && (
                <tr>
                  <td colSpan={columns.length} className="px-3 py-8 text-center text-muted-foreground text-xs">{emptyMessage}</td>
                </tr>
              )}
              {!loading && currentRows.map((row, idx) => (
                <tr
                  key={idx}
                  onClick={() => onRowClick?.(row)}
                  className={cn(
                    "border-b border-border/60 last:border-0 transition-colors",
                    // zebra striping
                    idx % 2 === 1 && !onRowClick && "bg-muted/20",
                    onRowClick ? "cursor-pointer hover:bg-primary/5 hover:text-foreground" : "hover:bg-muted/40",
                    rowClassName?.(row)
                  )}
                >
                  {columns.map((c) => (
                    <td
                      key={c.key}
                      className={cn(
                        "px-2 py-1.5 align-top",
                        c.align === "right" && "text-right tabular-nums",
                        c.align === "center" && "text-center",
                        c.sticky === "left" && "sticky left-0 bg-card z-10 border-r",
                        c.sticky === "right" && "sticky right-0 bg-card z-10 border-l"
                      )}
                    >
                      {c.cell(row)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {pagination && totalPages > 1 && (
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span>Page {page} of {totalPages}</span>
          <Button size="sm" variant="outline" className="h-7 text-xs" disabled={page === 1} onClick={() => setPage(p => Math.max(1, p - 1))}>Prev</Button>
          <Button size="sm" variant="outline" className="h-7 text-xs" disabled={page === totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))}>Next</Button>
        </div>
      )}
    </div>
  );
}
