"use client";

import { useEffect, useState } from "react";
import { useNavStore, ViewId } from "@/stores/nav-store";
import { useAuthStore } from "@/stores/auth-store";
import { isViewAuthorized } from "@/lib/auth/view-permissions";
import { isTabPermitted, type HostTabItem } from "@/components/diamond/shared/tabbed-host-view";
import { OVERVIEW_TABS } from "@/components/diamond/views/consolidated/overview-view";
import { SALES_ANALYSIS_TABS } from "@/components/diamond/views/consolidated/sales-analysis-trends-view";
import { INVENTORY_TABS } from "@/components/diamond/views/consolidated/inventory-position-view";
import { FANTASY_DATA_TABS } from "@/components/diamond/views/consolidated/fantasy-data-view";
import { MAPPINGS_TABS } from "@/components/diamond/views/consolidated/mappings-view";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard, BarChart3, TrendingUp, Users, FileText, Package, Boxes, AlertTriangle, Search, Activity, FileWarning, CalendarClock, RefreshCw, ClipboardList, CornerDownLeft, HardDrive, Shapes,
} from "lucide-react";
import { ReactNode } from "react";

interface PaletteItem {
  id: ViewId;
  tab?: string;
  label: string;
  group: string;
  icon: ReactNode;
  keywords: string[];
}

const HOST_TABS: Partial<Record<ViewId, readonly HostTabItem[]>> = {
  dashboard: OVERVIEW_TABS,
  "analysis-sales": SALES_ANALYSIS_TABS,
  "analysis-inventory-position": INVENTORY_TABS,
  "fantasy-data": FANTASY_DATA_TABS,
  "admin-mappings": MAPPINGS_TABS,
};

export function isPaletteItemAllowed(item: Pick<PaletteItem, "id" | "tab">, perms: readonly string[] | undefined): boolean {
  if (!isViewAuthorized(perms ? [...perms] : undefined, item.id)) return false;
  if (!item.tab) return true;
  const tab = HOST_TABS[item.id]?.find((t) => t.id === item.tab);
  return !!tab && isTabPermitted(tab.permission, perms ?? []);
}

export const PALETTE_ITEMS: PaletteItem[] = [
  { id: "dashboard", label: "Overview", group: "Dashboard", icon: <LayoutDashboard className="h-4 w-4" />, keywords: ["home", "dashboard", "kpi", "overview"] },
  { id: "dashboard", tab: "analysis", label: "Overview → Analysis", group: "Dashboard", icon: <BarChart3 className="h-4 w-4" />, keywords: ["executive analysis", "summary", "demand", "shortage"] },
  { id: "analysis-sales", label: "Sales & Trends", group: "Analysis", icon: <TrendingUp className="h-4 w-4" />, keywords: ["sales", "sales analysis", "invoices", "revenue", "category"] },
  { id: "analysis-sales", tab: "trends", label: "Sales & Trends → Sales Trends", group: "Analysis", icon: <Activity className="h-4 w-4" />, keywords: ["trends", "30 day", "90 day", "velocity"] },
  { id: "analysis-customers-orders", label: "Customers & Orders", group: "Analysis", icon: <Users className="h-4 w-4" />, keywords: ["customers", "orders", "country", "branch", "buyer"] },
  { id: "analysis-inventory-position", label: "Inventory", group: "Analysis", icon: <Package className="h-4 w-4" />, keywords: ["inventory", "stock", "position", "lots", "categories"] },
  { id: "analysis-inventory-position", tab: "stockout", label: "Inventory → Stockout Risk", group: "Analysis", icon: <AlertTriangle className="h-4 w-4" />, keywords: ["stockout", "shortage", "risk"] },
  { id: "analysis-inventory-position", tab: "excess", label: "Inventory → Excess Stock", group: "Analysis", icon: <Package className="h-4 w-4" />, keywords: ["excess", "surplus", "overstock"] },
  { id: "analysis-inventory-position", tab: "aging", label: "Inventory → Aging", group: "Analysis", icon: <CalendarClock className="h-4 w-4" />, keywords: ["aging", "stock aging", "bucket", "location"] },
  { id: "fantasy-data", label: "Fantasy Data", group: "Data", icon: <Boxes className="h-4 w-4" />, keywords: ["fantasy", "current data", "polished stock"] },
  { id: "fantasy-data", tab: "integration", label: "Fantasy Data → Integration Status", group: "Data", icon: <RefreshCw className="h-4 w-4" />, keywords: ["sync", "synchronization", "integration", "freshness", "retry"] },
  { id: "fantasy-data", tab: "history", label: "Fantasy Data → Historical Data", group: "Data", icon: <HardDrive className="h-4 w-4" />, keywords: ["historical", "archive", "lots", "overall data"] },
  { id: "data-quality-issues", label: "Import Issues", group: "Data", icon: <FileWarning className="h-4 w-4" />, keywords: ["import issues", "invalid records", "unmapped", "reconciliation", "rejected records", "data quality"] },
  { id: "planning-workbook-import", label: "Workbook Import", group: "Planning", icon: <FileText className="h-4 w-4" />, keywords: ["workbook", "import", "sarin", "csv", "output", "export"] },
  { id: "admin-users-access", label: "Users & Access", group: "Administration", icon: <Users className="h-4 w-4" />, keywords: ["users", "roles", "permissions", "access requests"] },
  { id: "admin-mappings", label: "Mappings", group: "Administration", icon: <Shapes className="h-4 w-4" />, keywords: ["mappings", "weight bands", "lab mapping", "shape mapping", "status mapping"] },
  { id: "admin-mappings", tab: "sarin-shape-mapping", label: "Mappings → Sarin Shape Mapping", group: "Administration", icon: <Shapes className="h-4 w-4" />, keywords: ["sarin shape", "fantasy shape", "needs mapping"] },
  { id: "admin-audit-log", label: "Audit Log", group: "Administration", icon: <ClipboardList className="h-4 w-4" />, keywords: ["audit log", "security", "activity trail"] },
];

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const setView = useNavStore((s) => s.setView);
  const perms = useAuthStore((s) => s.user?.permissions);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "Escape" && open) {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open]);

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setQuery("");
      setActiveIdx(0);
    }
    setOpen(next);
  };

  const visible = PALETTE_ITEMS.filter((item) => isPaletteItemAllowed(item, perms));
  const filtered = query.trim()
    ? visible.filter((item) => {
        const q = query.toLowerCase();
        return (
          item.label.toLowerCase().includes(q) ||
          item.group.toLowerCase().includes(q) ||
          item.keywords.some((k) => k.includes(q))
        );
      })
    : visible;

  const grouped = filtered.reduce<Record<string, PaletteItem[]>>((acc, item) => {
    (acc[item.group] = acc[item.group] || []).push(item);
    return acc;
  }, {});
  const flatFiltered = filtered;

  const selectItem = (item: PaletteItem) => {
    setView(item.id, item.tab ?? null);
    handleOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="p-0 max-w-2xl gap-0 overflow-hidden" showCloseButton={false}>
        <DialogHeader className="sr-only">
          <DialogTitle>Command Palette</DialogTitle>
        </DialogHeader>
        <div className="flex items-center gap-2 border-b border-border px-3">
          <Search className="h-4 w-4 text-muted-foreground" />
          <Input
            autoFocus
            value={query}
            onChange={(e) => { setQuery(e.target.value); setActiveIdx(0); }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setActiveIdx((i) => Math.min(flatFiltered.length - 1, i + 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setActiveIdx((i) => Math.max(0, i - 1)); }
              else if (e.key === "Enter" && flatFiltered[activeIdx]) { e.preventDefault(); selectItem(flatFiltered[activeIdx]); }
            }}
            placeholder="Search pages..."
            className="border-0 focus-visible:ring-0 h-11 text-sm"
          />
          <kbd className="text-[9px] font-mono text-muted-foreground border border-border rounded px-1.5 py-0.5">ESC</kbd>
        </div>
        <div className="max-h-[400px] overflow-y-auto py-2">
          {flatFiltered.length === 0 && (
            <div className="px-4 py-8 text-center text-xs text-muted-foreground">No matches for "{query}"</div>
          )}
          {Object.entries(grouped).map(([group, items]) => (
            <div key={group} className="mb-1">
              <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">{group}</div>
              {items.map((item) => {
                const idx = flatFiltered.indexOf(item);
                const active = idx === activeIdx;
                return (
                  <button
                    key={item.tab ? `${item.id}:${item.tab}` : item.id}
                    onMouseEnter={() => setActiveIdx(idx)}
                    onClick={() => selectItem(item)}
                    className={cn(
                      "w-full flex items-center gap-3 px-3 py-2 text-left text-sm transition-colors",
                      active ? "bg-primary/10 text-foreground" : "hover:bg-muted/50",
                    )}
                  >
                    <span className={cn("text-muted-foreground", active && "text-primary")}>{item.icon}</span>
                    <span className="flex-1 truncate">{item.label}</span>
                    {active && <CornerDownLeft className="h-3 w-3 text-muted-foreground" />}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        <div className="border-t border-border px-3 py-1.5 flex items-center justify-between text-[10px] text-muted-foreground">
          <span>{flatFiltered.length} results</span>
          <span className="flex items-center gap-2">
            <kbd className="font-mono border border-border rounded px-1">↑↓</kbd> navigate
            <kbd className="font-mono border border-border rounded px-1">↵</kbd> select
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
