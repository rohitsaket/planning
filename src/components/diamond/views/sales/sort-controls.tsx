"use client";

import { ArrowDownWideNarrow, ArrowUpNarrowWide } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { SortDirection } from "@/lib/analytics/sales-history-contract";

/**
 * Sort control for a server-paginated table.
 *
 * The column headers on these tables are deliberately not clickable: sorting one loaded
 * page would order 25 rows out of a much larger result and look like the whole table had
 * been sorted. This control sorts on the server, so page 1 really is the top of the
 * chosen order.
 */
export function SortControls<T extends string>({
  keys,
  labels,
  value,
  onChange,
  label,
}: {
  keys: readonly T[];
  labels: Record<T, string>;
  value: { key: T; dir: SortDirection };
  onChange: (next: { key: T; dir: SortDirection }) => void;
  label: string;
}) {
  return (
    <div className="flex items-center gap-1">
      <Select value={value.key} onValueChange={(k) => onChange({ ...value, key: k as T })}>
        <SelectTrigger size="sm" className="h-8 w-[170px] text-xs" aria-label={label}>
          <SelectValue placeholder="Sort by" />
        </SelectTrigger>
        <SelectContent>
          {keys.map((k) => (
            <SelectItem key={k} value={k} className="text-xs">{labels[k]}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        variant="outline"
        size="sm"
        className="h-8 px-2"
        onClick={() => onChange({ ...value, dir: value.dir === "asc" ? "desc" : "asc" })}
        aria-label={value.dir === "asc" ? "Sorted ascending — switch to descending" : "Sorted descending — switch to ascending"}
        title={value.dir === "asc" ? "Ascending" : "Descending"}
      >
        {value.dir === "asc" ? <ArrowUpNarrowWide className="h-3.5 w-3.5" /> : <ArrowDownWideNarrow className="h-3.5 w-3.5" />}
      </Button>
    </div>
  );
}
