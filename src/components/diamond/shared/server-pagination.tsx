"use client";

import { Button } from "@/components/ui/button";
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

  return (
    <div className="flex items-center justify-between gap-2 px-3 py-1.5 border-t border-border bg-muted/30 text-[11px] flex-wrap">
      <span className="text-muted-foreground tabular-nums">
        {total === 0 ? `No ${label}` : `Showing ${first.toLocaleString()}–${last.toLocaleString()} of ${total.toLocaleString()} ${label}`}
        <span className="ml-2 text-muted-foreground/70">
          (page {page.toLocaleString()} of {totalPages.toLocaleString()}, server-paginated)
        </span>
      </span>
      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="sm"
          className="h-7 px-2 text-[11px] gap-1"
          disabled={page <= 1 || loading}
          onClick={() => onPageChange(page - 1)}
        >
          <ChevronLeft className="h-3 w-3" /> Previous
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-7 px-2 text-[11px] gap-1"
          disabled={!hasMore || loading}
          onClick={() => onPageChange(page + 1)}
        >
          Next <ChevronRight className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}
