"use client";

import { useMemo } from "react";
import { useGlobalFilter, COUNTRY_OPTIONS, LAB_OPTIONS, WINDOW_OPTIONS } from "@/stores/global-filter";
import { useAuthStore } from "@/stores/auth-store";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/diamond/shared/badges";
import { Filter, X, Globe, FlaskConical, Clock } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The global country / branch / lab selector.
 *
 * The options are narrowed to what the signed-in account is authorized for. That is a
 * convenience, not a boundary: every API route resolves the same scope from the session
 * and refuses a request for anything outside it, so editing the query string by hand
 * gets a 403 rather than someone else's data.
 */
export function GlobalFilterBar({ className }: { className?: string }) {
  const { country, branch, lab, windowDays, setCountry, setBranch, setLab, setWindowDays, reset, hasActiveFilters } = useGlobalFilter();
  const active = hasActiveFilters();
  const accessScope = useAuthStore((s) => s.user?.accessScope);

  // A null list means unrestricted, so the full option list stands. A value the account is
  // authorized for that this build has no label for is still offered, under its own code:
  // dropping it would silently hide data the account may legitimately read.
  const countryOptions = useMemo(() => {
    const allowed = accessScope?.countries ?? null;
    if (allowed === null) return COUNTRY_OPTIONS;
    const known = COUNTRY_OPTIONS.filter((c) => allowed.includes(c.value));
    const unlabelled = allowed
      .filter((v) => !COUNTRY_OPTIONS.some((c) => c.value === v))
      .map((v) => ({ value: v, label: v }));
    return [...known, ...unlabelled];
  }, [accessScope?.countries]);

  const labOptions = useMemo(() => {
    const allowed = accessScope?.labs ?? null;
    if (allowed === null) return LAB_OPTIONS;
    const known = LAB_OPTIONS.filter((l) => allowed.includes(l.value));
    const unlabelled = allowed
      .filter((v) => !LAB_OPTIONS.some((l) => l.value === v))
      .map((v) => ({ value: v, label: v }));
    return [...known, ...unlabelled];
  }, [accessScope?.labs]);

  const countriesRestricted = (accessScope?.countries ?? null) !== null;
  const labsRestricted = (accessScope?.labs ?? null) !== null;

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
            {/* "All" means all of what this account may see, which is not always all of it. */}
            <SelectItem value="ALL" className="text-xs font-medium">
              {countriesRestricted ? "All authorized countries" : "All Countries"}
            </SelectItem>
            {countryOptions.map((c) => (
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
            <SelectItem value="ALL" className="text-xs font-medium">
              {labsRestricted ? "All authorized labs" : "All Labs"}
            </SelectItem>
            {labOptions.map((l) => (
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

      {/* Stated rather than left to be inferred from a short list of options. */}
      {(countriesRestricted || labsRestricted) && (
        <span title={accessScope?.summary}>
          <Badge variant="warning" className="gap-1 py-0.5 text-[10px]">
            <Globe className="h-3 w-3" />
            <span className="hidden lg:inline">Scoped access</span>
          </Badge>
        </span>
      )}
    </div>
  );
}

/**
 * Branches for a country.
 *
 * Branch is not a scope dimension of its own: a branch belongs to a country, so an
 * account restricted to particular countries can only ever reach the branches inside
 * them — the country selector above has already been narrowed.
 */
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
