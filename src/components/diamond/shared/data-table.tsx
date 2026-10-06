"use client";

import { toCsv } from "@/lib/csv-export";
import { cn } from "@/lib/utils";
import {
  ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ChevronDown,
  ChevronUp,
  Download,
  Eye,
  FileSpreadsheet,
  FileText,
  Filter,
  FilterX,
  GripVertical,
  RotateCcw,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import type { Permission } from "@/lib/auth/permissions";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { createPortal } from "react-dom";
import { exportDataTableToExcel } from "@/lib/excel-export";
import { exportToPDF } from "@/lib/pdf-export";
import { useAuthStore } from "@/stores/auth-store";
import { BOUNDED_REGION_MAX_HEIGHT, useSectionContext } from "@/components/diamond/shared/density";
import { readTableLayout, reconcileColumnOrder, tableLayoutStorageKey } from "@/components/diamond/shared/table-layout";

export interface Column<T> {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  sortable?: boolean;
  sortValue?: (row: T) => number | string;
  exportValue?: (row: T) => string | number | boolean | null | undefined;
  filterValue?: (row: T) => string | number | boolean | null | undefined;
  width?: string;
  sticky?: "left" | "right";
  align?: "left" | "right" | "center";
  wrap?: boolean;
}

export function getColumnValueString<T>(col: Column<T>, row: T): string {
  if (col.filterValue) {
    const v = col.filterValue(row);
    if (v === null || v === undefined || v === "") return "(Blank)";
    return String(v);
  }
  if (col.exportValue) {
    const v = col.exportValue(row);
    if (v === null || v === undefined || v === "") return "(Blank)";
    return String(v);
  }
  const raw = (row as Record<string, unknown>)[col.key];
  if (
    typeof raw === "string" ||
    typeof raw === "number" ||
    typeof raw === "boolean"
  ) {
    return String(raw);
  }
  if (raw instanceof Date) {
    return raw.toISOString();
  }
  if (col.sortValue) {
    const s = col.sortValue(row);
    if (s !== null && s !== undefined && s !== "") return String(s);
  }
  if (raw === null || raw === undefined || raw === "") return "(Blank)";
  return String(raw);
}

function cellTooltip<T>(col: Column<T>, row: T): string | undefined {
  const raw = (row as Record<string, unknown>)[col.key];
  const value = typeof raw === "string" || typeof raw === "number" ? String(raw) : col.filterValue ? col.filterValue(row) : undefined;
  if (value === null || value === undefined) return undefined;
  const text = String(value).trim();
  return text.length > 18 && !/^[[{]/.test(text) ? text : undefined;
}

export interface DataTableProps<T> {
  title?: string;
  description?: string;
  columns: Column<T>[];
  rows: T[];
  loading?: boolean;
  emptyMessage?: string;
  scroll?: "flow" | "bounded";
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
  exportPermission?: Permission;
  exportScope?: "all-loaded-rows" | "current-page";
  searchable?: boolean;
  searchPlaceholder?: string;
  searchFn?: (row: T, q: string) => boolean;
  pageSize?: number;
  pagination?: boolean;
  enableColumnFilter?: boolean;
  enableColumnReorder?: boolean;
  enableColumnResize?: boolean;
  enableColumnValueFilter?: boolean;
  tableId?: string;
}

export function DataTable<T>({
  title,
  description,
  columns: initialColumns,
  rows,
  loading,
  emptyMessage = "No data available.",
  scroll = "flow",
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
  enableColumnFilter = true,
  enableColumnReorder = true,
  enableColumnResize = true,
  enableColumnValueFilter = true,
  tableId,
}: DataTableProps<T>) {
  const { inSection, hasHeader, headerSlot } = useSectionContext();
  const user = useAuthStore((s) => s.user);
  const exportRequested = exportable || excelExportable || pdfExportable;

  if (
    exportRequested &&
    !exportPermission &&
    process.env.NODE_ENV !== "production"
  ) {
    throw new Error(
      `DataTable: exports are enabled without an exportPermission (title: ${
        title ?? "untitled"
      }). ` +
        "Pass the permission that authorizes exporting this dataset, or disable the export."
    );
  }

  const userCanExport =
    Boolean(exportPermission) &&
    Boolean(user?.permissions.includes(exportPermission as Permission));
  const pageScoped = exportScope === "current-page";
  const [sortKey, setSortKey] = useState<string | undefined>(initialSortKey);
  const [sortDir, setSortDir] = useState<"asc" | "desc">(initialSortDir);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const scrollRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const bounded = scroll === "bounded";

  const [savedLayout] = useState(() => readTableLayout(tableId));
  const [layoutFor, setLayoutFor] = useState(tableId);
  const [userOrder, setUserOrder] = useState<string[]>(savedLayout.orderedKeys);
  const [hiddenKeys, setHiddenKeys] = useState<Set<string>>(() => new Set(savedLayout.hiddenKeys));
  const [colWidths, setColWidths] = useState<Record<string, number>>(savedLayout.colWidths);
  if (layoutFor !== tableId) {
    const next = readTableLayout(tableId);
    setLayoutFor(tableId);
    setUserOrder(next.orderedKeys);
    setHiddenKeys(new Set(next.hiddenKeys));
    setColWidths(next.colWidths);
  }
  const columnKeys = useMemo(() => initialColumns.map((c) => c.key), [initialColumns]);
  const orderedKeys = useMemo(() => reconcileColumnOrder(userOrder, columnKeys), [userOrder, columnKeys]);

  const [columnSearch, setColumnSearch] = useState("");

  const [columnFilters, setColumnFilters] = useState<
    Record<string, Set<string>>
  >({});

  const [draggedColKey, setDraggedColKey] = useState<string | null>(null);
  const [dragOverColKey, setDragOverColKey] = useState<string | null>(null);

  const resizingRef = useRef<{
    key: string;
    startX: number;
    startWidth: number;
  } | null>(null);

  const persistLayout = useCallback(
    (keys: string[], hidden: Set<string>, widths: Record<string, number>) => {
      if (!tableId || typeof window === "undefined") return;
      try {
        localStorage.setItem(
          tableLayoutStorageKey(tableId),
          JSON.stringify({
            orderedKeys: keys,
            hiddenKeys: Array.from(hidden),
            colWidths: widths,
          })
        );
      } catch {
        // Ignore storage errors
      }
    },
    [tableId]
  );

  const columnMap = useMemo(() => {
    const map = new Map<string, Column<T>>();
    for (const col of initialColumns) {
      map.set(col.key, col);
    }
    return map;
  }, [initialColumns]);

  const allOrderedColumns = useMemo(() => {
    const list: Column<T>[] = [];
    for (const key of orderedKeys) {
      const col = columnMap.get(key);
      if (col) list.push(col);
    }
    for (const col of initialColumns) {
      if (!orderedKeys.includes(col.key)) {
        list.push(col);
      }
    }
    return list;
  }, [orderedKeys, columnMap, initialColumns]);

  const visibleColumns = useMemo(() => {
    return allOrderedColumns.filter((col) => !hiddenKeys.has(col.key));
  }, [allOrderedColumns, hiddenKeys]);

  const lastHeightRef = useRef(0);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (loading) {
      if (lastHeightRef.current)
        el.style.minHeight = `${lastHeightRef.current}px`;
    } else {
      el.style.minHeight = "";
      lastHeightRef.current = el.offsetHeight;
    }
  });

  useEffect(() => {
    if (bounded) scrollRef.current?.scrollTo({ top: 0 });
  }, [bounded, sortKey, sortDir, query, page, rows, columnFilters]);

  const shownPage = useRef(page);
  useEffect(() => {
    if (shownPage.current === page) return;
    shownPage.current = page;
    const root = rootRef.current;
    const scrollerTop = root?.closest("[data-scroll-owner]")?.getBoundingClientRect().top ?? 0;
    if (!bounded && root && root.getBoundingClientRect().top < scrollerTop) root.scrollIntoView({ block: "start" });
  }, [bounded, page]);

  let processed = rows;
  if (searchable && searchFn && query) {
    processed = processed.filter((r) => searchFn(r, query));
  }

  const activeColumnFilterKeys = useMemo(() => {
    return Object.keys(columnFilters).filter((k) => {
      const set = columnFilters[k];
      return set !== undefined && set.size > 0;
    });
  }, [columnFilters]);

  if (activeColumnFilterKeys.length > 0) {
    processed = processed.filter((r) => {
      for (const colKey of activeColumnFilterKeys) {
        const allowed = columnFilters[colKey];
        if (!allowed) continue;
        const col = columnMap.get(colKey);
        if (!col) continue;
        const val = getColumnValueString(col, r);
        if (!allowed.has(val)) {
          return false;
        }
      }
      return true;
    });
  }

  if (sortKey) {
    const col = columnMap.get(sortKey);
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

  const totalPages = pagination
    ? Math.max(1, Math.ceil(processed.length / pageSize))
    : 1;
  const currentRows = pagination
    ? processed.slice((page - 1) * pageSize, page * pageSize)
    : processed;

  const handleSort = (col: Column<T>) => {
    if (!col.sortable) return;
    if (sortKey === col.key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(col.key);
      setSortDir("desc");
    }
  };

  const moveColumn = (
    key: string,
    direction: "left" | "right" | "up" | "down"
  ) => {
    const idx = orderedKeys.indexOf(key);
    if (idx === -1) return;
    const targetIdx =
      direction === "left" || direction === "up" ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= orderedKeys.length) return;
    const updated = [...orderedKeys];
    const [item] = updated.splice(idx, 1);
    updated.splice(targetIdx, 0, item);
    setUserOrder(updated);
    persistLayout(updated, hiddenKeys, colWidths);
  };

  const reorderColumn = (sourceKey: string, targetKey: string) => {
    if (sourceKey === targetKey) return;
    const sourceIdx = orderedKeys.indexOf(sourceKey);
    const targetIdx = orderedKeys.indexOf(targetKey);
    if (sourceIdx === -1 || targetIdx === -1) return;
    const updated = [...orderedKeys];
    const [item] = updated.splice(sourceIdx, 1);
    updated.splice(targetIdx, 0, item);
    setUserOrder(updated);
    persistLayout(updated, hiddenKeys, colWidths);
  };

  const toggleColumnVisibility = (key: string) => {
    setHiddenKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        if (visibleColumns.length <= 1 && !prev.has(key)) {
          return prev;
        }
        next.add(key);
      }
      persistLayout(orderedKeys, next, colWidths);
      return next;
    });
  };

  const showAllColumns = () => {
    const next = new Set<string>();
    setHiddenKeys(next);
    persistLayout(orderedKeys, next, colWidths);
  };

  const resetColumns = () => {
    setUserOrder([]);
    setHiddenKeys(new Set());
    setColWidths({});
    setColumnFilters({});
    if (tableId && typeof window !== "undefined") {
      try {
        localStorage.removeItem(tableLayoutStorageKey(tableId));
      } catch {
        // Ignore
      }
    }
  };

  const clearAllColumnFilters = () => {
    setColumnFilters({});
    setPage(1);
  };

  const handleResizeStart = (e: React.MouseEvent, colKey: string) => {
    e.preventDefault();
    e.stopPropagation();
    const thElement = (e.currentTarget as HTMLElement).closest("th");
    const currentWidth =
      colWidths[colKey] || thElement?.getBoundingClientRect().width || 120;

    resizingRef.current = {
      key: colKey,
      startX: e.clientX,
      startWidth: currentWidth,
    };

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!resizingRef.current) return;
      const deltaX = moveEvent.clientX - resizingRef.current.startX;
      const newWidth = Math.max(
        48,
        Math.round(resizingRef.current.startWidth + deltaX)
      );
      setColWidths((prev) => ({
        ...prev,
        [resizingRef.current!.key]: newWidth,
      }));
    };

    const handleMouseUp = () => {
      if (resizingRef.current) {
        setColWidths((prev) => {
          persistLayout(orderedKeys, hiddenKeys, prev);
          return prev;
        });
      }
      resizingRef.current = null;
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  };

  const exportCsv = () => {
    const csv = toCsv(visibleColumns, processed);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = exportFilename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportExcel = () => {
    const cols = visibleColumns.map((c) => ({ header: c.header, key: c.key }));
    exportDataTableToExcel(processed, cols, excelExportFilename);
  };

  const exportPDF = () => {
    exportToPDF(pdfExportFilename || "export");
  };

  const filteredColumnsForPopover = useMemo(() => {
    if (!columnSearch.trim()) return allOrderedColumns;
    const q = columnSearch.toLowerCase();
    return allOrderedColumns.filter(
      (c) =>
        c.header.toLowerCase().includes(q) || c.key.toLowerCase().includes(q)
    );
  }, [allOrderedColumns, columnSearch]);

  const columnValueCounts = useMemo(() => {
    const map: Record<string, { value: string; count: number }[]> = {};
    for (const col of initialColumns) {
      const counts = new Map<string, number>();
      for (const row of rows) {
        const val = getColumnValueString(col, row);
        counts.set(val, (counts.get(val) ?? 0) + 1);
      }
      const sorted = Array.from(counts.entries())
        .map(([value, count]) => ({ value, count }))
        .sort((a, b) => {
          const numA = Number(a.value);
          const numB = Number(b.value);
          if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
          return a.value.localeCompare(b.value);
        });
      map[col.key] = sorted;
    }
    return map;
  }, [initialColumns, rows]);

  const shouldPortalToSectionHeader = inSection && hasHeader && !title;
  const hasToolbarItems = Boolean(
    title ||
      searchable ||
      toolbar ||
      enableColumnFilter ||
      activeColumnFilterKeys.length > 0 ||
      exportable ||
      excelExportable ||
      pdfExportable
  );

  const toolbarControls = (
    <div className="flex items-center gap-1.5 flex-wrap ml-auto">
      {searchable && (
        <div className="relative w-44 sm:w-56 md:w-64">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(1);
            }}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
            className="h-control bg-background/90 pl-7 text-xs"
          />
        </div>
      )}

      {activeColumnFilterKeys.length > 0 && (
        <Button
          variant="outline"
          size="sm"
          className="h-control gap-1 border-amber-500/30 bg-amber-500/10 px-2 text-xs font-medium text-amber-700 hover:bg-amber-500/20 dark:text-amber-400"
          onClick={clearAllColumnFilters}
          title="Clear all active column filters"
        >
          <FilterX className="h-3 w-3" />
          <span>Clear Filters ({activeColumnFilterKeys.length})</span>
        </Button>
      )}

      {enableColumnFilter && (
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="h-control gap-1.5 bg-background/90 px-2 text-xs font-medium text-foreground hover:bg-muted"
              title="Customize & filter columns"
            >
              <SlidersHorizontal className="h-3 w-3 text-muted-foreground" />
              <span>Columns</span>
              <span className="rounded bg-muted px-1 font-mono text-[10px] text-muted-foreground">
                {visibleColumns.length}/{initialColumns.length}
              </span>
            </Button>
          </PopoverTrigger>
          <PopoverContent
            align="end"
            className="w-72 p-2.5 space-y-2 bg-popover shadow-lg border border-border"
          >
            <div className="flex items-center justify-between border-b border-border/80 pb-1.5">
              <div className="flex items-center gap-1.5">
                <SlidersHorizontal className="h-3.5 w-3.5 text-primary" />
                <span className="text-xs font-semibold text-foreground">
                  Column Settings
                </span>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-5 px-1.5 text-[10px] text-muted-foreground hover:text-foreground"
                  onClick={showAllColumns}
                >
                  <Eye className="h-2.5 w-2.5 mr-1" /> All
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-5 px-1.5 text-[10px] text-muted-foreground hover:text-foreground"
                  onClick={resetColumns}
                  title="Reset to default order, visibility and filters"
                >
                  <RotateCcw className="h-2.5 w-2.5 mr-1" /> Reset
                </Button>
              </div>
            </div>

            {initialColumns.length > 6 && (
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                <Input
                  value={columnSearch}
                  onChange={(e) => setColumnSearch(e.target.value)}
                  placeholder="Search columns..."
                  className="h-6 pl-6 text-[11px] bg-muted/40"
                />
              </div>
            )}

            <div className="max-h-60 overflow-y-auto space-y-0.5 pr-0.5">
              {filteredColumnsForPopover.map((col, idx) => {
                const isVisible = !hiddenKeys.has(col.key);
                const isFirst = idx === 0;
                const isLast =
                  idx === filteredColumnsForPopover.length - 1;

                return (
                  <div
                    key={col.key}
                    className={cn(
                      "flex items-center justify-between gap-1.5 px-1.5 py-1 rounded text-xs transition-colors hover:bg-muted/60 group",
                      !isVisible && "opacity-50"
                    )}
                  >
                    <label className="flex items-center gap-2 cursor-pointer min-w-0 flex-1 select-none">
                      <Checkbox
                        checked={isVisible}
                        onCheckedChange={() =>
                          toggleColumnVisibility(col.key)
                        }
                        className="h-3.5 w-3.5"
                      />
                      <span
                        className={cn(
                          "text-[11px] truncate",
                          isVisible
                            ? "text-foreground font-medium"
                            : "text-muted-foreground line-through"
                        )}
                      >
                        {col.header}
                      </span>
                    </label>

                    {enableColumnReorder && (
                      <div className="flex items-center gap-0.5 opacity-60 group-hover:opacity-100 transition-opacity">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-5 w-5 p-0 text-muted-foreground hover:text-foreground disabled:opacity-20"
                          disabled={isFirst}
                          onClick={() => moveColumn(col.key, "up")}
                          title="Move Up / Left"
                        >
                          <ChevronUp className="h-3 w-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-5 w-5 p-0 text-muted-foreground hover:text-foreground disabled:opacity-20"
                          disabled={isLast}
                          onClick={() => moveColumn(col.key, "down")}
                          title="Move Down / Right"
                        >
                          <ChevronDown className="h-3 w-3" />
                        </Button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="border-t border-border/80 pt-1.5 text-[11px] leading-tight text-muted-foreground">
              Drag headers to reorder. Use the filter icon to filter.
            </div>
          </PopoverContent>
        </Popover>
      )}

      {toolbar}

      {userCanExport && (exportable || excelExportable || pdfExportable) && (
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-control gap-1 bg-background/90 px-2 text-xs" title={pageScoped ? "Exports the rows on this page only" : "Exports the loaded rows"}>
              <Download className="h-3.5 w-3.5" /> Export
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-56 p-1">
            <p className="px-2 py-1 text-[11px] text-muted-foreground">{pageScoped ? "Rows on this page" : "Loaded rows"}</p>
            {exportable && (
              <button type="button" className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-muted focus-visible:bg-muted focus-visible:outline-none" onClick={exportCsv}>
                <Download className="h-3.5 w-3.5" /> {pageScoped ? "Export visible rows (CSV)" : "Export loaded rows (CSV)"}
              </button>
            )}
            {excelExportable && (
              <button type="button" className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-muted focus-visible:bg-muted focus-visible:outline-none" onClick={exportExcel}>
                <FileSpreadsheet className="h-3.5 w-3.5" /> {pageScoped ? "Export visible rows (Excel)" : "Export loaded rows (Excel)"}
              </button>
            )}
            {pdfExportable && (
              <button type="button" className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-muted focus-visible:bg-muted focus-visible:outline-none" onClick={exportPDF}>
                <FileText className="h-3.5 w-3.5" /> {pageScoped ? "Export visible rows (PDF)" : "Export loaded rows (PDF)"}
              </button>
            )}
          </PopoverContent>
        </Popover>
      )}
      <div className="whitespace-nowrap pl-1 text-[11px] tabular-nums text-muted-foreground">
        {processed.length} {processed.length === 1 ? "row" : "rows"}
      </div>
    </div>
  );

  return (
    <div
      ref={rootRef}
      data-table-root
      data-table-scroll={scroll}
      className={cn(
        "isolate flex flex-col bg-card",
        !inSection && "overflow-clip rounded-lg border border-border/80",
      )}
    >
      {shouldPortalToSectionHeader && headerSlot && createPortal(toolbarControls, headerSlot)}

      {!shouldPortalToSectionHeader && hasToolbarItems && (
        <div className="flex flex-shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/30 px-card py-1.5">
          <div className="flex items-center gap-2 min-w-0">
            {title && (
              <h2 className="truncate text-[13px] font-semibold text-foreground">
                {title}
              </h2>
            )}
            {description && (
              <span className="hidden truncate text-xs text-muted-foreground sm:inline">
                · {description}
              </span>
            )}
          </div>

          {toolbarControls}
        </div>
      )}

      <div
        ref={scrollRef}
        data-table-viewport
        className={cn(
          "w-full max-w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
          bounded ? "overflow-auto" : "overflow-x-auto overflow-y-hidden",
        )}
        {...(bounded ? { tabIndex: 0, role: "region", "aria-label": title ? `${title} rows` : "Table rows" } : {})}
        style={bounded ? { maxHeight: BOUNDED_REGION_MAX_HEIGHT } : undefined}
      >
        <table className="w-full text-xs border-collapse">
          <thead className={cn(bounded && "sticky top-0 z-20 bg-[#FEE1C7] dark:bg-[#1D2332]")}>
            <tr className="bg-[#FEE1C7] dark:bg-[#1D2332]">
              {visibleColumns.map((c, colIndex) => {
                const isFirst = colIndex === 0;
                const isLast = colIndex === visibleColumns.length - 1;
                const customWidth = colWidths[c.key];
                const widthStyle = customWidth
                  ? { width: `${customWidth}px`, minWidth: `${customWidth}px` }
                  : c.width
                  ? { width: c.width }
                  : undefined;

                const hasActiveFilter =
                  columnFilters[c.key] !== undefined &&
                  columnFilters[c.key].size > 0 &&
                  columnFilters[c.key].size <
                    (columnValueCounts[c.key]?.length ?? 0);

                return (
                  <th
                    key={c.key}
                    scope="col"
                    aria-sort={c.sortable ? (sortKey === c.key ? (sortDir === "asc" ? "ascending" : "descending") : "none") : undefined}
                    draggable={enableColumnReorder}
                    onDragStart={(e) => {
                      if (!enableColumnReorder) return;
                      e.dataTransfer.setData("text/plain", c.key);
                      setDraggedColKey(c.key);
                    }}
                    onDragOver={(e) => {
                      if (!enableColumnReorder) return;
                      e.preventDefault();
                      if (dragOverColKey !== c.key) {
                        setDragOverColKey(c.key);
                      }
                    }}
                    onDragLeave={() => {
                      if (dragOverColKey === c.key) {
                        setDragOverColKey(null);
                      }
                    }}
                    onDrop={(e) => {
                      if (!enableColumnReorder) return;
                      e.preventDefault();
                      const sourceKey =
                        e.dataTransfer.getData("text/plain") || draggedColKey;
                      if (sourceKey && sourceKey !== c.key) {
                        reorderColumn(sourceKey, c.key);
                      }
                      setDraggedColKey(null);
                      setDragOverColKey(null);
                    }}
                    onDragEnd={() => {
                      setDraggedColKey(null);
                      setDragOverColKey(null);
                    }}
                    className={cn(
                      "group relative select-none whitespace-nowrap border-b border-[#FDBA74] bg-[#FEE1C7]/92 backdrop-blur-md px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-[#7C2D12] transition-colors dark:border-border dark:bg-[#1D2332]/92 dark:text-[#E4E4E7]",
                      bounded &&
                        "sticky top-0 z-20 shadow-[inset_0_-1px_0_0_var(--color-border)]",
                      c.align === "right"
                        ? "text-right"
                        : c.align === "center"
                        ? "text-center"
                        : "text-left",
                      c.sortable && "hover:bg-[#FED7AA] dark:hover:bg-muted/70",
                      c.sticky === "left" && "sticky left-0 bg-[#FEE1C7]/95 dark:bg-[#1D2332]/95 z-25 border-r border-[#FDBA74] dark:border-border",
                      c.sticky === "right" && "sticky right-0 bg-[#FEE1C7]/95 dark:bg-[#1D2332]/95 z-25 border-l border-[#FDBA74] dark:border-border",
                      draggedColKey === c.key && "opacity-40",
                      dragOverColKey === c.key &&
                        draggedColKey !== c.key &&
                        "ring-2 ring-primary ring-inset bg-primary/10"
                    )}
                    style={widthStyle}
                  >
                    <div
                      className={cn(
                        "flex items-center gap-1 w-full",
                        c.align === "right" && "justify-end text-right",
                        c.align === "center" && "justify-center text-center",
                        (!c.align || c.align === "left") && "justify-start text-left"
                      )}
                    >
                      {enableColumnReorder && (
                        <GripVertical className="h-3 w-3 text-muted-foreground/40 opacity-0 group-hover:opacity-100 cursor-grab active:cursor-grabbing flex-shrink-0 transition-opacity" />
                      )}

                      <span
                        className={cn(
                          "cursor-pointer truncate",
                          c.align === "right" && "text-right",
                          c.align === "center" && "text-center",
                          (!c.align || c.align === "left") && "text-left flex-1",
                          c.sortable && "hover:text-foreground"
                        )}
                        onClick={() => handleSort(c)}
                        title={c.sortable ? `Sort by ${c.header}` : c.header}
                      >
                        {c.header}
                      </span>

                      {c.sortable && (
                        <span aria-hidden="true" className="text-[9px] shrink-0 select-none">
                          {sortKey === c.key ? (
                            <span className="text-[#F9733E] font-extrabold">{sortDir === "asc" ? "▲" : "▼"}</span>
                          ) : (
                            <span className="text-[#5C4E46]/40 dark:text-muted-foreground/40 font-semibold opacity-60 group-hover:opacity-100 transition-opacity">↕</span>
                          )}
                        </span>
                      )}

                      {enableColumnValueFilter && (
                        <div className={cn(
                          "transition-opacity shrink-0",
                          hasActiveFilter ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                        )}>
                          <ColumnValueFilterPopover
                            column={c}
                            allUniqueValues={columnValueCounts[c.key] ?? []}
                            activeSelectedValues={columnFilters[c.key]}
                            hasActiveFilter={hasActiveFilter}
                            onApplyFilter={(selectedSet) => {
                              setColumnFilters((prev) => {
                                const next = { ...prev };
                                const totalCount =
                                  columnValueCounts[c.key]?.length ?? 0;
                                if (
                                  selectedSet.size === 0 ||
                                  selectedSet.size === totalCount
                                ) {
                                  delete next[c.key];
                                } else {
                                  next[c.key] = selectedSet;
                                }
                                return next;
                              });
                              setPage(1);
                            }}
                          />
                        </div>
                      )}
                    </div>

                    {enableColumnResize && (
                      <div
                        onMouseDown={(e) => handleResizeStart(e, c.key)}
                        className="absolute right-0 top-0 bottom-0 w-2 cursor-col-resize hover:bg-primary/60 group-hover:bg-border/60 transition-colors z-10"
                        title="Drag to resize column width"
                      />
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td
                  colSpan={visibleColumns.length || 1}
                  className="px-3 py-6 text-center text-muted-foreground"
                >
                  <div className="inline-flex items-center gap-2">
                    <div className="h-3 w-3 border-2 border-muted-foreground border-t-transparent rounded-full animate-spin" />
                    Loading...
                  </div>
                </td>
              </tr>
            )}
            {!loading && currentRows.length === 0 && (
              <tr>
                <td
                  colSpan={visibleColumns.length || 1}
                  className="px-3 py-6 text-center text-xs text-muted-foreground"
                >
                  {emptyMessage}
                </td>
              </tr>
            )}
            {!loading &&
              currentRows.map((row, idx) => (
                <tr
                  key={idx}
                  onClick={() => onRowClick?.(row)}
                  tabIndex={onRowClick ? 0 : undefined}
                  onKeyDown={onRowClick ? (e) => { if (e.key === "Enter") onRowClick(row); } : undefined}
                  className={cn(
                    "h-row border-b border-border/40 transition-colors duration-150 last:border-b-0",
                    onRowClick && "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                    idx % 2 === 1 && !onRowClick && "bg-muted/15",
                    onRowClick
                      ? "cursor-pointer hover:bg-[#FEEBD8] dark:hover:bg-white/[0.06] hover:text-foreground"
                      : "hover:bg-[#FFF2E5] dark:hover:bg-white/[0.04]",
                    rowClassName?.(row)
                  )}
                >
                  {visibleColumns.map((c) => {
                    const customWidth = colWidths[c.key];
                    const widthStyle = customWidth
                      ? { width: `${customWidth}px`, minWidth: `${customWidth}px` }
                      : c.width
                      ? { width: c.width }
                      : undefined;

                    const fullValue = c.wrap ? undefined : cellTooltip(c, row);
                    return (
                      <td
                        key={c.key}
                        style={widthStyle}
                        title={fullValue}
                        className={cn(
                          "px-2.5 py-1 align-middle",
                          c.align === "right" &&
                            "text-right tabular-nums whitespace-nowrap",
                          c.align === "center" && "text-center whitespace-nowrap",
                          (!c.align || c.align === "left") && "text-left",
                          (!c.align || c.align === "left") && !c.wrap && "max-w-[22rem] truncate whitespace-nowrap",
                          c.sticky === "left" &&
                            "sticky left-0 bg-inherit z-10 border-r border-border/50",
                          c.sticky === "right" &&
                            "sticky right-0 bg-inherit z-10 border-l border-border/50"
                        )}
                      >
                        {c.cell(row)}
                      </td>
                    );
                  })}
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {pagination && totalPages > 1 && (
        <div className="flex flex-shrink-0 items-center gap-2 border-t border-border/80 bg-[#FFF3EB]/95 dark:bg-[#131720]/95 backdrop-blur-md px-card py-1.5 text-[11px] text-muted-foreground">
          <span>
            Page {page} of {totalPages}
          </span>
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-2 text-xs"
            disabled={page === 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Prev
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-2 text-xs"
            disabled={page === totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
}

function ColumnValueFilterPopover<T>({
  column,
  allUniqueValues,
  activeSelectedValues,
  hasActiveFilter,
  onApplyFilter,
}: {
  column: Column<T>;
  allUniqueValues: { value: string; count: number }[];
  activeSelectedValues?: Set<string>;
  hasActiveFilter: boolean;
  onApplyFilter: (selected: Set<string>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [searchValue, setSearchValue] = useState("");

  const appliedSelection = () =>
    activeSelectedValues && activeSelectedValues.size > 0
      ? new Set(activeSelectedValues)
      : new Set(allUniqueValues.map((v) => v.value));

  const [stagedSelection, setStagedSelection] = useState<Set<string>>(appliedSelection);
  const handleOpenChange = (next: boolean) => {
    if (next) setStagedSelection(appliedSelection());
    setOpen(next);
  };

  const filteredValues = useMemo(() => {
    if (!searchValue.trim()) return allUniqueValues;
    const q = searchValue.toLowerCase();
    return allUniqueValues.filter((v) => v.value.toLowerCase().includes(q));
  }, [allUniqueValues, searchValue]);

  const toggleValue = (val: string) => {
    setStagedSelection((prev) => {
      const next = new Set(prev);
      if (next.has(val)) {
        next.delete(val);
      } else {
        next.add(val);
      }
      return next;
    });
  };

  const selectAll = () => {
    setStagedSelection(new Set(allUniqueValues.map((v) => v.value)));
  };

  const deselectAll = () => {
    setStagedSelection(new Set());
  };

  const handleApply = () => {
    onApplyFilter(stagedSelection);
    setOpen(false);
  };

  const handleClear = () => {
    const allSet = new Set(allUniqueValues.map((v) => v.value));
    setStagedSelection(allSet);
    onApplyFilter(new Set());
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          className={cn(
            "p-1 rounded transition-colors flex-shrink-0",
            hasActiveFilter
              ? "text-primary bg-primary/20 hover:bg-primary/30 ring-1 ring-primary/40"
              : "text-muted-foreground/60 hover:text-foreground hover:bg-muted-foreground/20"
          )}
          title={`Filter ${column.header}`}
        >
          <Filter
            className={cn(
              "h-2.5 w-2.5",
              hasActiveFilter && "fill-primary text-primary"
            )}
          />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-64 p-2.5 space-y-2.5 bg-popover shadow-xl border border-border"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border/80 pb-1.5">
          <div className="flex items-center gap-1.5 min-w-0">
            <Filter className="h-3.5 w-3.5 text-primary flex-shrink-0" />
            <span className="text-xs font-semibold text-foreground truncate">
              Filter: {column.header}
            </span>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="text-muted-foreground hover:text-foreground p-0.5 rounded"
          >
            <X className="h-3 w-3" />
          </button>
        </div>

        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
          <Input
            value={searchValue}
            onChange={(e) => setSearchValue(e.target.value)}
            placeholder="Search values..."
            className="h-7 pl-6 text-xs bg-muted/40"
          />
        </div>

        <div className="flex items-center justify-between text-[10px] text-muted-foreground px-0.5">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={selectAll}
              className="text-primary hover:underline font-medium"
            >
              Select All
            </button>
            <span>·</span>
            <button
              type="button"
              onClick={deselectAll}
              className="text-muted-foreground hover:text-foreground"
            >
              Deselect All
            </button>
          </div>
          <span className="font-mono text-[9.5px]">
            {stagedSelection.size} of {allUniqueValues.length} selected
          </span>
        </div>

        <div className="max-h-48 overflow-y-auto space-y-0.5 pr-0.5 border rounded border-border/60 p-1 bg-muted/10">
          {filteredValues.length === 0 ? (
            <div className="text-[11px] text-center text-muted-foreground py-3">
              No matching values
            </div>
          ) : (
            filteredValues.map((item) => {
              const isChecked = stagedSelection.has(item.value);
              return (
                <label
                  key={item.value}
                  className={cn(
                    "flex items-center justify-between gap-2 px-1.5 py-1 rounded text-xs cursor-pointer select-none transition-colors hover:bg-muted/60",
                    isChecked ? "text-foreground font-medium" : "text-muted-foreground opacity-70"
                  )}
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <Checkbox
                      checked={isChecked}
                      onCheckedChange={() => toggleValue(item.value)}
                      className="h-3.5 w-3.5"
                    />
                    <span className="text-[11px] truncate">{item.value}</span>
                  </div>
                  <span className="text-[10px] text-muted-foreground font-mono">
                    ({item.count})
                  </span>
                </label>
              );
            })
          )}
        </div>

        <div className="flex items-center justify-between pt-1 border-t border-border/80">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-[11px] text-muted-foreground hover:text-foreground"
            onClick={handleClear}
          >
            Clear
          </Button>
          <Button
            type="button"
            variant="default"
            size="sm"
            className="h-6 px-3 text-[11px] bg-primary text-primary-foreground font-medium"
            onClick={handleApply}
          >
            Apply
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
