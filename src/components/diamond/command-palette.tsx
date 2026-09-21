"use client";

import { useEffect, useState } from "react";
import { useNavStore, ViewId } from "@/stores/nav-store";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard, BarChart3, TrendingUp, Users, ShoppingCart, Globe, Gem,
  FileText, Package, Boxes, Factory, GitBranch, ShieldCheck, AlertTriangle,
  FlaskConical, FileBarChart, Settings, Search, Diamond, Activity, Scale, Layers,
  Map, FileWarning, Workflow, ClipboardCheck, CalendarClock, Hash, RefreshCw,
  BookCheck, ClipboardList, Star, CornerDownLeft, UserPlus,
} from "lucide-react";
import { ReactNode } from "react";

interface PaletteItem {
  id: ViewId;
  label: string;
  group: string;
  icon: ReactNode;
  keywords: string[];
}

const ITEMS: PaletteItem[] = [
  { id: "dashboard", label: "Executive Dashboard", group: "Overview", icon: <LayoutDashboard className="h-4 w-4" />, keywords: ["home", "main", "overview", "kpi"] },
  { id: "analysis-executive", label: "Executive Analysis", group: "Analysis", icon: <Activity className="h-4 w-4" />, keywords: ["exec", "summary"] },
  { id: "analysis-sales", label: "Sales Analysis", group: "Analysis", icon: <ShoppingCart className="h-4 w-4" />, keywords: ["revenue", "invoice", "by dimension"] },
  { id: "analysis-sales-trends", label: "Sales Trends", group: "Analysis", icon: <TrendingUp className="h-4 w-4" />, keywords: ["trend", "growth", "30d"] },
  { id: "analysis-customers", label: "Customers", group: "Analysis", icon: <Users className="h-4 w-4" />, keywords: ["customer", "360", "buyer"] },
  { id: "analysis-orders", label: "Orders", group: "Analysis", icon: <FileText className="h-4 w-4" />, keywords: ["order", "so", "backorder"] },
  { id: "analysis-country", label: "Country / Branch", group: "Analysis", icon: <Globe className="h-4 w-4" />, keywords: ["country", "branch", "geography"] },
  { id: "analysis-polished", label: "Polished Inventory", group: "Analysis", icon: <Gem className="h-4 w-4" />, keywords: ["polished", "stock", "inventory"] },
  { id: "analysis-memo", label: "Memo Analysis", group: "Analysis", icon: <FileText className="h-4 w-4" />, keywords: ["memo", "consignment"] },
  { id: "analysis-wip", label: "WIP Analysis", group: "Analysis", icon: <Boxes className="h-4 w-4" />, keywords: ["wip", "work in progress"] },
  { id: "analysis-forecast", label: "Forecast", group: "Analysis", icon: <TrendingUp className="h-4 w-4" />, keywords: ["forecast", "prediction"] },
  { id: "analysis-stockout", label: "Stockout Risk", group: "Analysis", icon: <AlertTriangle className="h-4 w-4" />, keywords: ["stockout", "risk", "shortage"] },
  { id: "analysis-excess", label: "Excess Stock", group: "Analysis", icon: <Package className="h-4 w-4" />, keywords: ["excess", "overstock"] },
  { id: "analysis-aging", label: "Stock Aging", group: "Analysis", icon: <CalendarClock className="h-4 w-4" />, keywords: ["aging", "old", "slow"] },
  { id: "analysis-reorder-signals", label: "Customer Reorder Signals", group: "Analysis", icon: <Star className="h-4 w-4" />, keywords: ["reorder", "repeat", "prediction"] },
  { id: "requirements-matrix", label: "Requirement Matrix", group: "Requirements", icon: <Hash className="h-4 w-4" />, keywords: ["requirement", "matrix", "demand"] },
  { id: "requirements-priority-queue", label: "Priority Queue", group: "Requirements", icon: <AlertTriangle className="h-4 w-4" />, keywords: ["priority", "critical", "high"] },
  { id: "requirements-orders", label: "Customer Orders", group: "Requirements", icon: <FileText className="h-4 w-4" />, keywords: ["order"] },
  { id: "requirements-backorders", label: "Backorders", group: "Requirements", icon: <FileWarning className="h-4 w-4" />, keywords: ["backorder"] },
  { id: "requirements-special", label: "Special Requirements", group: "Requirements", icon: <Star className="h-4 w-4" />, keywords: ["special"] },
  { id: "planning-rough-availability", label: "Rough Availability", group: "Planning", icon: <Gem className="h-4 w-4" />, keywords: ["rough", "available"] },
  { id: "planning-cases", label: "Planning Cases", group: "Planning", icon: <ClipboardList className="h-4 w-4" />, keywords: ["case", "plan"] },
  { id: "planning-workbook-import", label: "Workbook Import", group: "Planning", icon: <FileText className="h-4 w-4" />, keywords: ["workbook", "import", "xlsx"] },
  { id: "planning-workbench", label: "Planning Workbench", group: "Planning", icon: <LayoutDashboard className="h-4 w-4" />, keywords: ["workbench", "planner"] },
  { id: "planning-approval-queue", label: "Approval Queue", group: "Planning", icon: <BookCheck className="h-4 w-4" />, keywords: ["approval", "queue"] },
  { id: "planning-planned-pieces", label: "Planned Pieces", group: "Planning", icon: <Layers className="h-4 w-4" />, keywords: ["piece", "planned"] },
  { id: "planning-reservations", label: "Rough Reservations", group: "Planning", icon: <ShieldCheck className="h-4 w-4" />, keywords: ["reservation", "rough"] },
  { id: "manufacturing-tracking", label: "Fantasy Tracking", group: "Manufacturing", icon: <Activity className="h-4 w-4" />, keywords: ["tracking"] },
  { id: "manufacturing-traceability", label: "Traceability", group: "Manufacturing", icon: <GitBranch className="h-4 w-4" />, keywords: ["trace", "genealogy"] },
  { id: "manufacturing-plan-vs-actual", label: "Plan vs Actual", group: "Manufacturing", icon: <Scale className="h-4 w-4" />, keywords: ["actual", "variance", "yield"] },
  { id: "fantasy-sync", label: "Fantasy Sync Dashboard", group: "Fantasy ERP", icon: <RefreshCw className="h-4 w-4" />, keywords: ["sync", "fantasy"] },
  { id: "fantasy-rough", label: "Fantasy Rough Stock", group: "Fantasy ERP", icon: <Gem className="h-4 w-4" />, keywords: ["rough"] },
  { id: "fantasy-polished", label: "Fantasy Polished Stock", group: "Fantasy ERP", icon: <Diamond className="h-4 w-4" />, keywords: ["polished"] },
  { id: "fantasy-departments", label: "Fantasy Departments", group: "Fantasy ERP", icon: <Boxes className="h-4 w-4" />, keywords: ["department"] },
  { id: "fantasy-locations", label: "Fantasy Locations", group: "Fantasy ERP", icon: <Map className="h-4 w-4" />, keywords: ["location"] },
  { id: "data-quality-issues", label: "Data Quality Issues", group: "Data Quality", icon: <AlertTriangle className="h-4 w-4" />, keywords: ["quality", "issue"] },
  { id: "data-science-forecast", label: "Forecast", group: "Data Science", icon: <TrendingUp className="h-4 w-4" />, keywords: ["forecast"] },
  { id: "data-science-models", label: "Models", group: "Data Science", icon: <Layers className="h-4 w-4" />, keywords: ["model"] },
  { id: "reports", label: "Reports Library", group: "Reports", icon: <FileBarChart className="h-4 w-4" />, keywords: ["report"] },
  { id: "admin-business-rules", label: "Business Rules", group: "Admin", icon: <ShieldCheck className="h-4 w-4" />, keywords: ["rule", "business"] },
  { id: "admin-weight-bands", label: "Weight Bands", group: "Admin", icon: <Scale className="h-4 w-4" />, keywords: ["weight", "band"] },
  { id: "admin-lab-mappings", label: "Lab Mapping", group: "Admin", icon: <Gem className="h-4 w-4" />, keywords: ["lab", "mapping"] },
  { id: "admin-shape-mappings", label: "Shape Mapping", group: "Admin", icon: <Diamond className="h-4 w-4" />, keywords: ["shape", "mapping"] },
  { id: "admin-feature-flags", label: "Feature Flags", group: "Admin", icon: <Workflow className="h-4 w-4" />, keywords: ["flag", "feature"] },
  { id: "admin-audit-log", label: "Audit Log", group: "Admin", icon: <ClipboardList className="h-4 w-4" />, keywords: ["audit", "log"] },
  { id: "admin-users", label: "Users & Roles", group: "Admin", icon: <Users className="h-4 w-4" />, keywords: ["user", "role", "rbac"] },
  { id: "admin-access-requests", label: "Access Requests", group: "Admin", icon: <UserPlus className="h-4 w-4" />, keywords: ["access", "request", "registration", "signup", "approve"] },
];

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const setView = useNavStore((s) => s.setView);

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

  // Reset query/activeIdx when opening (not via effect to avoid cascading renders)
  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setQuery("");
      setActiveIdx(0);
    }
    setOpen(next);
  };

  const filtered = query.trim()
    ? ITEMS.filter((item) => {
        const q = query.toLowerCase();
        return (
          item.label.toLowerCase().includes(q) ||
          item.group.toLowerCase().includes(q) ||
          item.keywords.some((k) => k.includes(q))
        );
      })
    : ITEMS;

  // Group by category
  const grouped = filtered.reduce<Record<string, PaletteItem[]>>((acc, item) => {
    (acc[item.group] = acc[item.group] || []).push(item);
    return acc;
  }, {});
  const flatFiltered = filtered;

  const selectItem = (item: PaletteItem) => {
    setView(item.id);
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
            placeholder="Type to search views... (Cmd+K to toggle, ↑↓ to navigate, Enter to select)"
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
                    key={item.id}
                    onMouseEnter={() => setActiveIdx(idx)}
                    onClick={() => selectItem(item)}
                    className={cn(
                      "w-full flex items-center gap-3 px-3 py-2 text-left text-sm transition-colors",
                      active ? "bg-primary/10 text-foreground" : "hover:bg-muted/50"
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
