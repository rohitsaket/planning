"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ChevronLeft, ChevronRight } from "lucide-react";

export interface ServerPaginationProps {
  page: number;
  pageSize: number;
  /** Total matching rows on the server, not the number of rows on this page. */
  total: number;
  hasMore: boolean;
  onPageChange: (page: number) => void;
  loading?: boolean;
  /** Noun for the row count, e.g. "customers". */
  label?: string;
}

/**
 * Paging control for endpoints that page on the server. It always states the real
 * total so a page of rows is never mistaken for the whole dataset.
 */
export function ServerPagination({
  page,
  pageSize,
  total,
  hasMore,
  onPageChange,
  loading = false,
  label = "rows",
}: ServerPaginationProps) {
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  // Generate page numbers with ellipsis window
  const getPageNumbers = () => {
    if (totalPages <= 7) {
      return Array.from({ length: totalPages }, (_, i) => i + 1);
    }
    const pages: (number | "ellipsis")[] = [];
    pages.push(1);
    if (page > 3) {
      pages.push("ellipsis");
    }
    const start = Math.max(2, page - 1);
    const end = Math.min(totalPages - 1, page + 1);
    for (let i = start; i <= end; i++) {
      pages.push(i);
    }
    if (page < totalPages - 2) {
      pages.push("ellipsis");
    }
    pages.push(totalPages);
    return pages;
  };

  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2 border-t border-border bg-card/60 text-xs flex-wrap">
      <span className="text-muted-foreground tabular-nums text-[11px]">
        {total === 0 ? (
          `No ${label}`
        ) : (
          <>
            Showing <span className="font-semibold text-foreground">{first.toLocaleString()}</span> to{" "}
            <span className="font-semibold text-foreground">{last.toLocaleString()}</span> of{" "}
            <span className="font-semibold text-foreground">{total.toLocaleString()}</span> {label}
            <span className="ml-2 text-muted-foreground/70 hidden sm:inline">
              (server-paginated)
            </span>
          </>
        )}
      </span>
      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="sm"
          className="h-7 w-7 p-0 text-xs rounded-md"
          disabled={page <= 1 || loading}
          onClick={() => onPageChange(page - 1)}
          title="Previous page"
          aria-label="Previous page"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </Button>

        {totalPages > 1 && (
          <div className="flex items-center gap-1">
            {getPageNumbers().map((p, i) => {
              if (p === "ellipsis") {
                return (
                  <span key={`ellipsis-${i}`} className="px-1 text-xs text-muted-foreground select-none">
                    ...
                  </span>
                );
              }
              const isActive = p === page;
              return (
                <button
                  key={p}
                  type="button"
                  disabled={loading}
                  onClick={() => onPageChange(p)}
                  className={cn(
                    "h-7 min-w-7 px-1.5 text-xs font-medium rounded-md transition-colors flex items-center justify-center tabular-nums",
                    isActive
                      ? "bg-brand text-brand-foreground font-bold shadow-xs"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/80 border border-border/60 bg-card"
                  )}
                  aria-current={isActive ? "page" : undefined}
                >
                  {p}
                </button>
              );
            })}
          </div>
        )}

        <Button
          variant="outline"
          size="sm"
          className="h-7 w-7 p-0 text-xs rounded-md"
          disabled={!hasMore || page >= totalPages || loading}
          onClick={() => onPageChange(page + 1)}
          title="Next page"
          aria-label="Next page"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

