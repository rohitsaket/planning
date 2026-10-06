"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Search, ShieldAlert } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { PermissionMeta } from "./shared";

export function PermissionEditor({
  areas,
  catalog,
  selected,
  onChange,
  readOnly,
  baseline,
}: {
  areas: string[];
  catalog: PermissionMeta[];
  selected: ReadonlySet<string>;
  onChange: (next: Set<string>) => void;
  readOnly: boolean;
  baseline: ReadonlySet<string>;
}) {
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    return areas
      .map((area) => ({
        area,
        all: catalog.filter((p) => p.area === area),
        shown: catalog.filter((p) => p.area === area && (!q || `${p.label} ${p.area} ${p.capability}`.toLowerCase().includes(q))),
      }))
      .filter((g) => g.shown.length > 0);
  }, [areas, catalog, query]);

  const set = (ids: string[], on: boolean) => {
    const next = new Set(selected);
    for (const id of ids) {
      if (on) next.add(id);
      else next.delete(id);
    }
    onChange(next);
  };
  const toggleCollapsed = (area: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(area)) next.delete(area);
      else next.add(area);
      return next;
    });

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input aria-label="Search permissions" placeholder="Search permissions" value={query} maxLength={80} onChange={(e) => setQuery(e.target.value)} className="h-8 pl-7 text-xs" />
        </div>
        <Button size="sm" variant="outline" className="h-8" onClick={() => setCollapsed(new Set())}>Expand all</Button>
        <Button size="sm" variant="outline" className="h-8" onClick={() => setCollapsed(new Set(areas))}>Collapse all</Button>
      </div>

      {groups.length === 0 && <p className="py-4 text-center text-xs text-muted-foreground">No permissions match your search.</p>}

      {groups.map(({ area, all, shown }) => {
        const open = !collapsed.has(area) || query.trim().length > 0;
        const chosen = all.filter((p) => selected.has(p.id)).length;
        const safeRead = all.filter((p) => p.capability === "View" && !p.sensitive).map((p) => p.id);
        const panelId = `perm-area-${area.replace(/\W+/g, "-")}`;
        return (
          <section key={area} className="rounded-md border border-border">
            <div className="flex flex-wrap items-center gap-2 bg-muted/30 px-2.5 py-1.5">
              <button type="button" className="flex flex-1 items-center gap-1.5 text-left text-xs font-semibold" aria-expanded={open} aria-controls={panelId} onClick={() => toggleCollapsed(area)}>
                {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                {area}
                <span className="font-normal text-muted-foreground tabular-nums">{chosen} of {all.length}</span>
              </button>
              {!readOnly && (
                <>
                  <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" disabled={safeRead.length === 0 || safeRead.every((id) => selected.has(id))} onClick={() => set(safeRead, true)}>
                    Select safe read-only
                  </Button>
                  <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" disabled={chosen === 0} onClick={() => set(all.map((p) => p.id), false)}>
                    Clear group
                  </Button>
                </>
              )}
            </div>
            {open && (
              <ul id={panelId} className="divide-y divide-border/60">
                {shown.map((p) => {
                  const id = `perm-${p.id}`;
                  const on = selected.has(p.id);
                  const changed = on !== baseline.has(p.id);
                  return (
                    <li key={p.id} className={cn("flex items-center gap-2 px-2.5 py-1.5 text-xs", changed && "bg-amber-500/5")}>
                      <Checkbox id={id} checked={on} disabled={readOnly} onCheckedChange={(c) => set([p.id], c === true)} />
                      <label htmlFor={id} className="flex-1 cursor-pointer">{p.label}</label>
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{p.capability}</span>
                      {p.sensitive && (
                        <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400" title="Sensitive: confirmed individually before saving">
                          <ShieldAlert className="h-3 w-3" /> Sensitive
                        </span>
                      )}
                      {changed && <span className="text-[10px] font-semibold text-amber-700 dark:text-amber-400">{on ? "Added" : "Removed"}</span>}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
