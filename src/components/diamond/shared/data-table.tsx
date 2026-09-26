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
import { exportDataTableToExcel } from "@/lib/excel-export";
import { exportToPDF } from "@/lib/pdf-export";
import { useAuthStore } from "@/stores/auth-store";

/**
 * Viewport-aware row-viewport height for data-dense tables. Roughly 7–12 rows: ~336px at
 * 1366×768, ~468px at 1440×900, capped at 520px on large displays, never below 300px.
 * `dvh` follows the real viewport on mobile browsers; the surrounding chrome (shell header,
 * tab strip, section header, KPIs, chart) is what the 27rem accounts for.
 */
export const DATA_TABLE_VIEWPORT_MAX_HEIGHT =
  "clamp(300px, calc(100dvh - 27rem), 520px)";

export interface Column<T> {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  sortable?: boolean;
  sortValue?: (row: T) => number | string;
  // Plain value written to CSV. Defaults to the primitive cell output, then row[key], then sortValue.
  exportValue?: (row: T) => string | number | boolean | null | undefined;
  // Custom string value for per-column filter matching. Defaults to exportValue, then row[key], then sortValue.
  filterValue?: (row: T) => string | number | boolean | null | undefined;
  width?: string;
  sticky?: "left" | "right";
  align?: "left" | "right" | "center";
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
  /**
   * Enable interactive column filtering (show/hide), column reordering, resizing, and per-column value filters.
   * Defaults to true.
   */
  enableColumnFilter?: boolean;
  enableColumnReorder?: boolean;
  enableColumnResize?: boolean;
  enableColumnValueFilter?: boolean;
  /**
   * Optional storage ID to persist custom column order/visibility in localStorage.
   */
  tableId?: string;
}

export function DataTable<T>({
  title,
  description,
  columns: initialColumns,
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
  enableColumnFilter = true,
  enableColumnReorder = true,
  enableColumnResize = true,
  enableColumnValueFilter = true,
  tableId,
}: DataTableProps<T>) {
  const user = useAuthStore((s) => s.user);
  const exportRequested = exportable || excelExportable || pdfExportable;

  // Fail loudly in development when a table offers an export without an export policy,
  // instead of silently applying someone else's permission.
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

  // This control serialises rows the browser already received from a list endpoint that
  // authorized them under its own read permission. It is a convenience download, not a
  // server-authorized export: a user who can see the table can obtain the same bytes
  // from the API directly. Sensitive and full-dataset exports must go through a server
  // endpoint with its own export permission (see /api/demand/export and
  // /api/fantasy/overall/export) — those are not built on this control.
  const userCanExport =
    Boolean(exportPermission) &&
    Boolean(user?.permissions.includes(exportPermission as Permission));
  const pageScoped = exportScope === "current-page";
  const [sortKey, setSortKey] = useState<string | undefined>(initialSortKey);
  const [sortDir, setSortDir] = useState<"asc" | "desc">(initialSortDir);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Column order state
  const [orderedKeys, setOrderedKeys] = useState<string[]>(() =>
    initialColumns.map((c) => c.key)
  );

  // Column visibility state (hidden column keys)
  const [hiddenKeys, setHiddenKeys] = useState<Set<string>>(new Set());

  // Column widths state
  const [colWidths, setColWidths] = useState<Record<string, number>>({});

  // Column search inside customize columns popover
  const [columnSearch, setColumnSearch] = useState("");

  // Per-column value filters state: maps colKey -> Set of allowed values
  const [columnFilters, setColumnFilters] = useState<
    Record<string, Set<string>>
  >({});

  // Drag-and-drop state for column header reordering
  const [draggedColKey, setDraggedColKey] = useState<string | null>(null);
  const [dragOverColKey, setDragOverColKey] = useState<string | null>(null);

  // Resizing state
  const resizingRef = useRef<{
    key: string;
    startX: number;
    startWidth: number;
  } | null>(null);

  // Sync ordered keys when initialColumns change
  useEffect(() => {
    setOrderedKeys((prev) => {
      const incomingKeys = initialColumns.map((c) => c.key);
      const existing = prev.filter((k) => incomingKeys.includes(k));
      const added = incomingKeys.filter((k) => !existing.includes(k));
      return [...existing, ...added];
    });
  }, [initialColumns]);

  // Load from localStorage if tableId is provided
  useEffect(() => {
    if (!tableId || typeof window === "undefined") return;
    try {
      const saved = localStorage.getItem(`dt_layout_${tableId}`);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed.orderedKeys)) {
          const validKeys = initialColumns.map((c) => c.key);
          const filtered = parsed.orderedKeys.filter((k: string) =>
            validKeys.includes(k)
          );
          const missing = validKeys.filter((k) => !filtered.includes(k));
          setOrderedKeys([...filtered, ...missing]);
        }
        if (Array.isArray(parsed.hiddenKeys)) {
          setHiddenKeys(new Set(parsed.hiddenKeys));
        }
        if (parsed.colWidths && typeof parsed.colWidths === "object") {
          setColWidths(parsed.colWidths);
        }
      }
    } catch {
      // Ignore storage errors
    }
  }, [tableId, initialColumns]);

  // Save to localStorage when layout changes
  const persistLayout = useCallback(
    (keys: string[], hidden: Set<string>, widths: Record<string, number>) => {
      if (!tableId || typeof window === "undefined") return;
      try {
        localStorage.setItem(
          `dt_layout_${tableId}`,
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

  // Map of column definition by key
  const columnMap = useMemo(() => {
    const map = new Map<string, Column<T>>();
    for (const col of initialColumns) {
      map.set(col.key, col);
    }
    return map;
  }, [initialColumns]);

  // Ordered list of all columns
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

  // Visible columns (reordered and filtered)
  const visibleColumns = useMemo(() => {
    return allOrderedColumns.filter((col) => !hiddenKeys.has(col.key));
  }, [allOrderedColumns, hiddenKeys]);

  // Height of the row viewport while rows are shown
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

  // A new sort, search, page or dataset starts the row viewport at the top.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [sortKey, sortDir, query, page, rows, columnFilters]);

  // Filter processed rows by global search AND by active per-column filters
  let processed = rows;
  if (searchable && searchFn && query) {
    processed = processed.filter((r) => searchFn(r, query));
  }

  // Apply per-column value filters
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

  // Sorting
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

  // Reorder column helper
  const moveColumn = (
    key: string,
    direction: "left" | "right" | "up" | "down"
  ) => {
    setOrderedKeys((prev) => {
      const idx = prev.indexOf(key);
      if (idx === -1) return prev;
      const targetIdx =
        direction === "left" || direction === "up" ? idx - 1 : idx + 1;
      if (targetIdx < 0 || targetIdx >= prev.length) return prev;
      const updated = [...prev];
      const [item] = updated.splice(idx, 1);
      updated.splice(targetIdx, 0, item);
      persistLayout(updated, hiddenKeys, colWidths);
      return updated;
    });
  };

  const reorderColumn = (sourceKey: string, targetKey: string) => {
    if (sourceKey === targetKey) return;
    setOrderedKeys((prev) => {
      const sourceIdx = prev.indexOf(sourceKey);
      const targetIdx = prev.indexOf(targetKey);
      if (sourceIdx === -1 || targetIdx === -1) return prev;
      const updated = [...prev];
      const [item] = updated.splice(sourceIdx, 1);
      updated.splice(targetIdx, 0, item);
      persistLayout(updated, hiddenKeys, colWidths);
      return updated;
    });
  };

  // Visibility toggle helper
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
    const defaultKeys = initialColumns.map((c) => c.key);
    const defaultHidden = new Set<string>();
    const defaultWidths = {};
    setOrderedKeys(defaultKeys);
    setHiddenKeys(defaultHidden);
    setColWidths(defaultWidths);
    setColumnFilters({});
    persistLayout(defaultKeys, defaultHidden, defaultWidths);
    if (tableId && typeof window !== "undefined") {
      try {
        localStorage.removeItem(`dt_layout_${tableId}`);
      } catch {
        // Ignore
      }
    }
  };

  const clearAllColumnFilters = () => {
    setColumnFilters({});
    setPage(1);
  };

  // Column resizing handlers
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

  // Compute distinct values and counts for all columns
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
          // Sort by numeric value if both are numbers, otherwise alphabetically
          const numA = Number(a.value);
          const numB = Number(b.value);
          if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
          return a.value.localeCompare(b.value);
        });
      map[col.key] = sorted;
    }
    return map;
  }, [initialColumns, rows]);

  return (
    <div className="rounded-2xl border border-border/80 overflow-hidden bg-card flex-1 min-h-0 flex flex-col shadow-[0_4px_24px_-4px_rgba(249,115,62,0.04)]">
      {/* Upper Single-Row Table Header: Title on Left, Search/Columns/Exports/Count on Right */}
      {(title ||
        searchable ||
        toolbar ||
        enableColumnFilter ||
        activeColumnFilterKeys.length > 0 ||
        exportable ||
        excelExportable ||
        pdfExportable) && (
        <div className="flex items-center justify-between gap-2 px-3 py-1.5 border-b border-border bg-muted/40 flex-wrap min-h-10 flex-shrink-0">
          {/* Left: Title & Subtle description */}
          <div className="flex items-center gap-2 min-w-0">
            {title && (
              <h2 className="text-xs font-semibold tracking-wide text-foreground truncate">
                {title}
              </h2>
            )}
            {description && (
              <span className="text-[10px] text-muted-foreground hidden sm:inline truncate">
                · {description}
              </span>
            )}
          </div>

          {/* Right: Search + Active Filter Badges + Columns Popover + Toolbar + Exports + Row Count */}
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
                  className="h-7 pl-7 text-xs bg-background/90"
                />
              </div>
            )}

            {/* Clear All Column Filters Button */}
            {activeColumnFilterKeys.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2 text-[11px] gap-1 bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30 hover:bg-amber-500/20 font-medium"
                onClick={clearAllColumnFilters}
                title="Clear all active column filters"
              >
                <FilterX className="h-3 w-3" />
                <span>Clear Filters ({activeColumnFilterKeys.length})</span>
              </Button>
            )}

            {/* Column Customizer / Filter Popover */}
            {enableColumnFilter && (
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 px-2 text-[11px] gap-1.5 bg-background/90 font-medium text-foreground hover:bg-muted"
                    title="Customize & filter columns"
                  >
                    <SlidersHorizontal className="h-3 w-3 text-muted-foreground" />
                    <span>Columns</span>
                    <span className="text-[9px] px-1 py-0.2 rounded bg-muted font-mono text-muted-foreground">
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

                  <div className="text-[9.5px] text-muted-foreground border-t border-border/80 pt-1.5 leading-tight">
                    💡 Drag column headers to rearrange. Click the filter icon on any column to filter values.
                  </div>
                </PopoverContent>
              </Popover>
            )}

            {toolbar}

            {exportable && userCanExport && (
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2 text-[11px] gap-1 bg-background/90"
                onClick={exportCsv}
                title={
                  pageScoped
                    ? "Exports the rows on this page only"
                    : undefined
                }
              >
                <Download className="h-3 w-3" />{" "}
                {pageScoped ? "Export visible rows (CSV)" : "Export loaded rows (CSV)"}
              </Button>
            )}
            {excelExportable && userCanExport && (
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2 text-[11px] gap-1 bg-background/90"
                onClick={exportExcel}
                title={
                  pageScoped
                    ? "Exports the rows on this page only"
                    : undefined
                }
              >
                <FileSpreadsheet className="h-3 w-3" />{" "}
                {pageScoped ? "Export visible rows (Excel)" : "Export loaded rows (Excel)"}
              </Button>
            )}
            {pdfExportable && userCanExport && (
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2 text-[11px] gap-1 bg-background/90"
                onClick={exportPDF}
              >
                <FileText className="h-3 w-3" /> Export loaded rows (PDF)
              </Button>
            )}
            <div className="text-[10px] text-muted-foreground pl-1 font-mono whitespace-nowrap">
              {processed.length} {processed.length === 1 ? "row" : "rows"}
            </div>
          </div>
        </div>
      )}

      {/* Table Scroll Area */}
      <div
        ref={scrollRef}
        tabIndex={0}
        aria-label={title ? `${title} rows` : "Table rows"}
        className="overflow-auto flex-1 min-h-0 w-full max-w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        style={maxHeight ? { maxHeight } : undefined}
      >
        <table className="w-full text-xs border-collapse">
          <thead className={cn(stickyHeader && "sticky top-0 z-20 bg-[#FFE7D3] dark:bg-[#1D2332]")}>
            <tr className="bg-[#FFE7D3] dark:bg-[#1D2332]">
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
                      "group relative px-2.5 py-2 font-bold text-[#5C4E46] dark:text-[#E4E4E7] uppercase tracking-wider text-[10px] whitespace-nowrap bg-[#FFE7D3] dark:bg-[#1D2332] border-b border-[#F0D5C0] dark:border-border border-r border-[#F0D5C0]/60 dark:border-border/50 last:border-r-0 transition-colors select-none",
                      stickyHeader &&
                        "sticky top-0 z-20 shadow-[inset_0_-1px_0_0_var(--color-border)]",
                      c.align === "right"
                        ? "text-right"
                        : c.align === "center"
                        ? "text-center"
                        : "text-left",
                      c.sortable && "hover:bg-[#FCD8BE] dark:hover:bg-muted/70",
                      c.sticky === "left" && "sticky left-0 bg-[#FFE7D3] dark:bg-[#1D2332] z-25 border-r border-[#F0D5C0] dark:border-border",
                      c.sticky === "right" && "sticky right-0 bg-[#FFE7D3] dark:bg-[#1D2332] z-25 border-l border-[#F0D5C0] dark:border-border",
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

                      {/* Sort Indicator Arrow */}
                      {c.sortable && (
                        <span className="text-[9px] shrink-0 select-none">
                          {sortKey === c.key ? (
                            <span className="text-[#F9733E] font-extrabold">{sortDir === "asc" ? "▲" : "▼"}</span>
                          ) : (
                            <span className="text-[#5C4E46]/40 dark:text-muted-foreground/40 font-semibold opacity-60 group-hover:opacity-100 transition-opacity">↕</span>
                          )}
                        </span>
                      )}

                      {/* Per-Column Value Filter Popover — visible when active or on header hover */}
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

                    {/* Column Resizer Handle */}
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
                  className="px-3 py-8 text-center text-muted-foreground"
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
                  className="px-3 py-8 text-center text-muted-foreground text-xs"
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
                  className={cn(
                    "border-b border-border/40 last:border-b-0 transition-colors duration-150",
                    // zebra striping
                    idx % 2 === 1 && !onRowClick && "bg-muted/15",
                    onRowClick
                      ? "cursor-pointer hover:bg-[#FFEEDB] dark:hover:bg-white/[0.06] hover:text-foreground"
                      : "hover:bg-[#FFF6EF] dark:hover:bg-white/[0.04]",
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

                    return (
                      <td
                        key={c.key}
                        style={widthStyle}
                        className={cn(
                          "px-2.5 py-1.5 align-middle border-r border-border/40 last:border-r-0",
                          c.align === "right" &&
                            "text-right tabular-nums whitespace-nowrap",
                          c.align === "center" && "text-center whitespace-nowrap",
                          (!c.align || c.align === "left") && "text-left",
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
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground px-3 py-1.5 border-t border-border bg-muted/30 flex-shrink-0">
          <span>
            Page {page} of {totalPages}
          </span>
          <Button
            size="sm"
            variant="outline"
            className="h-6 text-xs px-2"
            disabled={page === 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Prev
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-6 text-xs px-2"
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

/**
 * Dedicated Popover Component for filtering distinct values of a specific column.
 */
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

  // Staged selection while popover is open
  const [stagedSelection, setStagedSelection] = useState<Set<string>>(() => {
    if (activeSelectedValues && activeSelectedValues.size > 0) {
      return new Set(activeSelectedValues);
    }
    return new Set(allUniqueValues.map((v) => v.value));
  });

  // Keep staged selection in sync when active filter changes
  useEffect(() => {
    if (activeSelectedValues && activeSelectedValues.size > 0) {
      setStagedSelection(new Set(activeSelectedValues));
    } else {
      setStagedSelection(new Set(allUniqueValues.map((v) => v.value)));
    }
  }, [activeSelectedValues, allUniqueValues]);

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
    <Popover open={open} onOpenChange={setOpen}>
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
        {/* Header with Title and Close Button */}
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

        {/* Search Values */}
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
          <Input
            value={searchValue}
            onChange={(e) => setSearchValue(e.target.value)}
            placeholder="Search values..."
            className="h-7 pl-6 text-xs bg-muted/40"
          />
        </div>

        {/* Quick Select/Deselect Bar */}
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

        {/* Value Checkbox List */}
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

        {/* Footer Actions */}
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
