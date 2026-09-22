"use client";

import { toCsv } from "@/lib/csv-export";
import { cn } from "@/lib/utils";
import { ReactNode, useState } from "react";
import { Download, FileSpreadsheet, FileText, Search } from "lucide-react";
import type { Permission } from "@/lib/auth/permissions";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { exportDataTableToExcel } from "@/lib/excel-export";
import { exportToPDF } from "@/lib/pdf-export";

import { useAuthStore } from "@/stores/auth-store";

export interface Column<T> {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  sortable?: boolean;
  sortValue?: (row: T) => number | string;
  // Plain value written to CSV. Defaults to the primitive cell output, then row[key], then sortValue.
  exportValue?: (row: T) => string | number | boolean | null | undefined;
  width?: string;
  sticky?: "left" | "right";
  align?: "left" | "right" | "center";
}

export interface DataTableProps<T> {
  title?: string;
  description?: string;
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
  /**
   * Required whenever any export is enabled: the permission that authorizes exporting
   * THIS dataset. There is no default — a generic table must not inherit a
   * domain-specific policy such as demand.export.
   */
  exportPermission?: Permission;
  /**
   * Set when the table shows one server page of a larger dataset. The client-side
   * export then only claims the rows the user already has, and the button says so.
   */
  exportScope?: "all-loaded-rows" | "current-page";
  searchable?: boolean;
  searchPlaceholder?: string;
  searchFn?: (row: T, q: string) => boolean;
  pageSize?: number;
  pagination?: boolean;
}

export function DataTable<T>({
  title,
  description,
  columns,
  rows,
  loading,
  emptyMessage = "No data available.",
  stickyHeader = true,
  maxHeight,
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
  exportPermission,
  exportScope = "all-loaded-rows",
  searchable = false,
  searchPlaceholder = "Search...",
  searchFn,
  pageSize = 50,
  pagination = false,
}: DataTableProps<T>) {
  const user = useAuthStore((s) => s.user);
  const exportRequested = exportable || excelExportable || pdfExportable;

  // Fail loudly in development when a table offers an export without an export policy,
  // instead of silently applying someone else's permission.
  if (exportRequested && !exportPermission && process.env.NODE_ENV !== "production") {
    throw new Error(
      `DataTable: exports are enabled without an exportPermission (title: ${title ?? "untitled"}). ` +
        "Pass the permission that authorizes exporting this dataset, or disable the export.",
    );
  }

  // The server authorizes every export endpoint independently; this only hides a
  // control the user may not use.
  const userCanExport = Boolean(exportPermission) && Boolean(user?.permissions.includes(exportPermission as Permission));
  const pageScoped = exportScope === "current-page";
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
    const csv = toCsv(columns, processed);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
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
    <div className="rounded-md border border-border overflow-hidden bg-card flex-1 min-h-0 flex flex-col">
      {/* Upper Single-Row Table Header: Title on Left, Search/Exports/Count on Right */}
      {(title || searchable || toolbar || exportable || excelExportable || pdfExportable) && (
        <div className="flex items-center justify-between gap-2 px-3 py-1.5 border-b border-border bg-muted/40 flex-wrap min-h-10 flex-shrink-0">
          {/* Left: Title & Subtle description */}
          <div className="flex items-center gap-2 min-w-0">
            {title && <h2 className="text-xs font-semibold tracking-wide text-foreground truncate">{title}</h2>}
            {description && (
              <span className="text-[10px] text-muted-foreground hidden sm:inline truncate">· {description}</span>
            )}
          </div>

          {/* Right: Search + Toolbar + Exports + Row Count */}
          <div className="flex items-center gap-1.5 flex-wrap ml-auto">
            {searchable && (
              <div className="relative w-44 sm:w-56 md:w-64">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(e) => { setQuery(e.target.value); setPage(1); }}
                  placeholder={searchPlaceholder}
                  className="h-7 pl-7 text-xs bg-background/90"
                />
              </div>
            )}
            {toolbar}
            {exportable && userCanExport && (
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2 text-[11px] gap-1 bg-background/90"
                onClick={exportCsv}
                title={pageScoped ? "Exports the rows on this page only" : undefined}
              >
                <Download className="h-3 w-3" /> {pageScoped ? "Export Page CSV" : "Export CSV"}
              </Button>
            )}
            {excelExportable && userCanExport && (
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2 text-[11px] gap-1 bg-background/90"
                onClick={exportExcel}
                title={pageScoped ? "Exports the rows on this page only" : undefined}
              >
                <FileSpreadsheet className="h-3 w-3" /> {pageScoped ? "Export Page Excel" : "Export Excel"}
              </Button>
            )}
            {pdfExportable && userCanExport && (
              <Button variant="outline" size="sm" className="h-7 px-2 text-[11px] gap-1 bg-background/90" onClick={exportPDF}>
                <FileText className="h-3 w-3" /> Export PDF
              </Button>
            )}
            <div className="text-[10px] text-muted-foreground pl-1 font-mono whitespace-nowrap">
              {processed.length} {processed.length === 1 ? "row" : "rows"}
            </div>
          </div>
        </div>
      )}

      {/* Table Scroll Area — ONLY this inner part scrolls */}
      <div className="overflow-auto flex-1 min-h-0 w-full" style={maxHeight ? { maxHeight } : undefined}>
        <table className="w-full text-xs border-collapse">
          <thead className={cn(stickyHeader && "sticky top-0 z-20 bg-muted")}>
            <tr className="bg-muted">
              {columns.map((c) => (
                <th
                  key={c.key}
                  onClick={() => handleSort(c)}
                  className={cn(
                    "px-2 py-2 font-semibold text-muted-foreground uppercase tracking-wide text-[10px] whitespace-nowrap bg-muted border-b border-border",
                    stickyHeader && "sticky top-0 z-20",
                    c.align === "right" ? "text-right" : c.align === "center" ? "text-center" : "text-left",
                    c.sortable && "cursor-pointer hover:bg-muted-foreground/10 select-none",
                    c.sticky === "left" && "sticky left-0 bg-muted z-30 border-r",
                    c.sticky === "right" && "sticky right-0 bg-muted z-30 border-l"
                  )}
                  style={c.width ? { width: c.width } : undefined}
                >
                  <div
                    className={cn(
                      "flex items-center gap-1",
                      c.align === "right" && "justify-end text-right",
                      c.align === "center" && "justify-center text-center",
                      (!c.align || c.align === "left") && "justify-start text-left"
                    )}
                  >
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
                        "px-2 py-1.5 align-middle",
                        c.align === "right" && "text-right tabular-nums",
                        c.align === "center" && "text-center",
                        (!c.align || c.align === "left") && "text-left",
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
      {pagination && totalPages > 1 && (
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground px-3 py-1.5 border-t border-border bg-muted/30 flex-shrink-0">
          <span>Page {page} of {totalPages}</span>
          <Button size="sm" variant="outline" className="h-6 text-xs px-2" disabled={page === 1} onClick={() => setPage(p => Math.max(1, p - 1))}>Prev</Button>
          <Button size="sm" variant="outline" className="h-6 text-xs px-2" disabled={page === totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))}>Next</Button>
        </div>
      )}
    </div>
  );
}
