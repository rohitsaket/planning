"use client";

import { useGlobalFilter, COUNTRY_OPTIONS, LAB_OPTIONS, WINDOW_OPTIONS } from "@/stores/global-filter";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/diamond/shared/badges";
import { Filter, X, Globe, FlaskConical, Clock } from "lucide-react";
import { cn } from "@/lib/utils";

export function GlobalFilterBar({ className }: { className?: string }) {
  const { country, branch, lab, windowDays, setCountry, setBranch, setLab, setWindowDays, reset, hasActiveFilters } = useGlobalFilter();
  const active = hasActiveFilters();

  return (
    <div className={cn("flex items-center gap-1.5 flex-wrap px-3 py-1.5 border-b border-border bg-muted/30 text-xs", className)}>
      <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground flex-shrink-0">
        <Filter className="h-3 w-3" />
        <span className="hidden sm:inline">Global Filter</span>
      </div>

      {/* Country */}
      <div className="flex items-center gap-1">
        <Globe className="h-3 w-3 text-muted-foreground hidden sm:block" />
        <Select value={country ?? "ALL"} onValueChange={(v) => setCountry(v === "ALL" ? null : v)}>
          <SelectTrigger size="sm" className="h-7 w-[110px] sm:w-[130px] text-[11px] bg-card">
            <SelectValue placeholder="All Countries" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL" className="text-xs">All Countries</SelectItem>
            {COUNTRY_OPTIONS.map((c) => (
              <SelectItem key={c.value} value={c.value} className="text-xs">{c.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Branch — only show branches for selected country */}
      {country && (
        <div className="flex items-center gap-1">
          <Select value={branch ?? "ALL"} onValueChange={(v) => setBranch(v === "ALL" ? null : v)}>
            <SelectTrigger size="sm" className="h-7 w-[100px] text-[11px] bg-card">
              <SelectValue placeholder="All Branches" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL" className="text-xs">All Branches</SelectItem>
              {getBranches(country).map((b) => (
                <SelectItem key={b} value={b} className="text-xs">{b}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Lab */}
      <div className="flex items-center gap-1">
        <FlaskConical className="h-3 w-3 text-muted-foreground hidden sm:block" />
        <Select value={lab ?? "ALL"} onValueChange={(v) => setLab(v === "ALL" ? null : v)}>
          <SelectTrigger size="sm" className="h-7 w-[90px] text-[11px] bg-card">
            <SelectValue placeholder="All Labs" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL" className="text-xs">All Labs</SelectItem>
            {LAB_OPTIONS.map((l) => (
              <SelectItem key={l.value} value={l.value} className="text-xs">{l.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Window */}
      <div className="flex items-center gap-1">
        <Clock className="h-3 w-3 text-muted-foreground hidden sm:block" />
        <Select value={String(windowDays)} onValueChange={(v) => setWindowDays(parseInt(v, 10))}>
          <SelectTrigger size="sm" className="h-7 w-[70px] text-[11px] bg-card">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {WINDOW_OPTIONS.map((w) => (
              <SelectItem key={w.value} value={String(w.value)} className="text-xs">{w.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {active && (
        <Button variant="ghost" size="sm" className="h-7 text-[11px] gap-1 text-muted-foreground hover:text-foreground" onClick={reset}>
          <X className="h-3 w-3" /> Clear
        </Button>
      )}

      {active && (
        <div className="ml-auto hidden sm:flex items-center gap-1">
          <Badge variant="info" className="gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-sky-500 animate-pulse" />
            Filtered
          </Badge>
        </div>
      )}
    </div>
  );
}

function getBranches(country: string): string[] {
  const map: Record<string, string[]> = {
    US: ["New York", "Los Angeles"],
    HK: ["Central HK"],
    CA: ["Toronto"],
    IN: ["Mumbai", "Surat"],
    BE: ["Antwerp"],
    AE: ["Dubai"],
  };
  return map[country] ?? [];
}
