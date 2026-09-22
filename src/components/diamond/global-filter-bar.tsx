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
    <div className={cn("flex items-center gap-1.5 text-xs", className)}>
      {/* Country */}
      <div className="flex items-center gap-1">
        <Select value={country ?? "ALL"} onValueChange={(v) => setCountry(v === "ALL" ? null : v)}>
          <SelectTrigger size="sm" className="h-8 min-w-[138px] px-2.5 text-xs bg-card/90 border-border/80 shadow-xs">
            <Globe className="h-3.5 w-3.5 text-muted-foreground mr-1.5 shrink-0" />
            <SelectValue placeholder="All Countries" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL" className="text-xs font-medium">All Countries</SelectItem>
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
            <SelectTrigger size="sm" className="h-8 min-w-[120px] px-2.5 text-xs bg-card/90 border-border/80 shadow-xs">
              <SelectValue placeholder="All Branches" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL" className="text-xs font-medium">All Branches</SelectItem>
              {getBranches(country).map((b) => (
                <SelectItem key={b} value={b} className="text-xs">{b}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Lab */}
      <div className="flex items-center gap-1">
        <Select value={lab ?? "ALL"} onValueChange={(v) => setLab(v === "ALL" ? null : v)}>
          <SelectTrigger size="sm" className="h-8 min-w-[110px] px-2.5 text-xs bg-card/90 border-border/80 shadow-xs">
            <FlaskConical className="h-3.5 w-3.5 text-muted-foreground mr-1.5 shrink-0" />
            <SelectValue placeholder="All Labs" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL" className="text-xs font-medium">All Labs</SelectItem>
            {LAB_OPTIONS.map((l) => (
              <SelectItem key={l.value} value={l.value} className="text-xs">{l.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Window */}
      <div className="flex items-center gap-1">
        <Select value={String(windowDays)} onValueChange={(v) => setWindowDays(parseInt(v, 10))}>
          <SelectTrigger size="sm" className="h-8 min-w-[85px] px-2.5 text-xs bg-card/90 border-border/80 shadow-xs">
            <Clock className="h-3.5 w-3.5 text-muted-foreground mr-1.5 shrink-0" />
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
        <Button
          variant="ghost"
          size="sm"
          className="h-7.5 px-2 text-[11px] gap-1 text-muted-foreground hover:text-foreground"
          onClick={reset}
          title="Clear global filters"
        >
          <X className="h-3 w-3" /> <span className="hidden md:inline">Clear</span>
        </Button>
      )}

      {active && (
        <div className="hidden 2xl:flex items-center gap-1">
          <Badge variant="info" className="gap-1 py-0.5 text-[10px]">
            <span className="w-1.5 h-1.5 rounded-full bg-sky-500 animate-pulse" />
            Active
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
