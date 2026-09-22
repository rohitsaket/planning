"use client";

import { useEffect, useState } from "react";
import { useNavStore, ViewId } from "@/stores/nav-store";
import { useAuthStore } from "@/stores/auth-store";
import { isViewAuthorized } from "@/lib/auth/view-permissions";
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
  BookCheck, ClipboardList, Star, CornerDownLeft, UserPlus, Lock, HardDrive,
  Calculator, ArrowLeftRight, History
} from "lucide-react";
import { ReactNode } from "react";

interface PaletteItem {
  id: ViewId;
  // Tab inside a tabbed host view; several palette entries may target one view id.
  tab?: string;
  label: string;
  group: string;
  icon: ReactNode;
  keywords: string[];
  advisory?: boolean;
}

const ITEMS: PaletteItem[] = [
  // 1. Dashboard
  { id: "dashboard", label: "Executive Dashboard", group: "Dashboard", icon: <LayoutDashboard className="h-4 w-4" />, keywords: ["home", "main", "overview", "kpi", "executive"] },

  // 2. Analysis (Direct Analytical Workspace)
  { id: "analysis-executive", label: "Executive Analysis", group: "Analysis", icon: <BarChart3 className="h-4 w-4" />, keywords: ["executive", "summary", "kpi", "demand", "inventory"] },
  { id: "analysis-sales", tab: "analysis", label: "Sales Analysis & Trends → Sales Analysis", group: "Analysis", icon: <TrendingUp className="h-4 w-4" />, keywords: ["sales", "invoices", "revenue", "category", "customer", "sales analysis"] },
  { id: "analysis-sales", tab: "trends", label: "Sales Analysis & Trends → Sales Trends", group: "Analysis", icon: <Activity className="h-4 w-4" />, keywords: ["trends", "30 day", "90 day", "velocity", "history", "sales trends"] },
  { id: "analysis-customers-orders", label: "Customers & Orders", group: "Analysis", icon: <Users className="h-4 w-4" />, keywords: ["customers", "orders", "country", "branch", "buyer", "geography", "accounts"] },
  { id: "analysis-inventory-position", label: "Inventory", group: "Analysis", icon: <Package className="h-4 w-4" />, keywords: ["rough", "wip", "polished", "memo", "inventory", "stock", "pipeline"] },
  { id: "analysis-stockout", label: "Stockout Risk", group: "Analysis", icon: <AlertTriangle className="h-4 w-4" />, advisory: true, keywords: ["stockout", "shortage", "risk", "projected stock"] },
  { id: "analysis-excess", label: "Excess Stock", group: "Analysis", icon: <Package className="h-4 w-4" />, keywords: ["excess", "surplus", "overstock"] },
  { id: "analysis-aging", label: "Stock Aging", group: "Analysis", icon: <CalendarClock className="h-4 w-4" />, keywords: ["aging", "slow moving", "days", "old stock"] },
  { id: "analysis-reorder-signals", label: "Reorder Signals", group: "Analysis", icon: <Star className="h-4 w-4" />, advisory: true, keywords: ["reorder", "repeat customer", "prediction"] },
  { id: "demand-history", label: "Demand Run History", group: "Analysis", icon: <History className="h-4 w-4" />, keywords: ["demand", "run", "history", "calculation"] },
  { id: "analysis-demand-trace", label: "Demand Trace", group: "Analysis", icon: <Calculator className="h-4 w-4" />, keywords: ["demand", "trace", "formula", "calculation", "lots"] },
  { id: "transfer-analyzer", label: "Transfer Analyzer", group: "Analysis", icon: <ArrowLeftRight className="h-4 w-4" />, advisory: true, keywords: ["transfer", "country", "branch", "excess", "shortage"] },
  { id: "aging-dashboard", label: "Aging Dashboard", group: "Analysis", icon: <LayoutDashboard className="h-4 w-4" />, keywords: ["aging", "dashboard", "slow moving", "inventory"] },

  // 3. Fantasy ERP
  { id: "fantasy-live", label: "Live Data", group: "Fantasy ERP", icon: <Boxes className="h-4 w-4" />, keywords: ["rough stock", "polished stock", "departments", "locations", "erp", "live"] },
  { id: "fantasy-sync", label: "Sync Monitor", group: "Fantasy ERP", icon: <RefreshCw className="h-4 w-4" />, keywords: ["sync", "reconciliation", "monitor", "integration", "dashboard"] },

  // 4. Overall Data
  { id: "overall-data", label: "Overall Data", group: "Overall Data", icon: <HardDrive className="h-4 w-4" />, keywords: ["historical", "archive", "lots", "permanent", "records"] },

  // 5. Data Quality
  { id: "data-quality-issues", label: "Data Quality Issues", group: "Data Quality", icon: <AlertTriangle className="h-4 w-4" />, keywords: ["quality", "unmapped", "labs", "shapes", "issues", "anomalies"] },

  // 6. Demand and Inventory
  { id: "demand-overview", label: "Demand Overview", group: "Demand and Inventory", icon: <Activity className="h-4 w-4" />, keywords: ["executive analysis", "sales analysis", "sales trends", "demand run history"] },
  { id: "inventory-position", label: "Inventory Position", group: "Demand and Inventory", icon: <Package className="h-4 w-4" />, keywords: ["polished inventory", "memo analysis", "wip analysis", "stockout risk", "excess stock"] },
  { id: "customers-orders", label: "Customers and Orders", group: "Demand and Inventory", icon: <Users className="h-4 w-4" />, keywords: ["customers", "orders", "country", "branch", "buyer", "geography"] },
  { id: "demand-trace", label: "Demand Trace (Workflow)", group: "Demand and Inventory", icon: <Calculator className="h-4 w-4" />, keywords: ["trace", "calculation", "formula", "engine", "breakdown", "workflow"] },
  { id: "stock-strategy", label: "Stock Strategy", group: "Demand and Inventory", icon: <ArrowLeftRight className="h-4 w-4" />, keywords: ["stock aging", "aging dashboard", "reorder signals", "transfer analyzer"] },

  // 6. Requirements and Priority
  { id: "requirements-matrix", label: "Requirement Matrix", group: "Requirements and Priority", icon: <Hash className="h-4 w-4" />, keywords: ["requirement", "matrix", "demand", "target", "carat"] },
  { id: "requirements-priority-queue", label: "Priority Queue", group: "Requirements and Priority", icon: <AlertTriangle className="h-4 w-4" />, keywords: ["priority", "critical", "high", "ranking", "urgent"] },
  { id: "orders-exceptions", label: "Orders and Exceptions", group: "Requirements and Priority", icon: <FileText className="h-4 w-4" />, keywords: ["customer orders", "backorders", "special requirements", "exceptions"] },
  { id: "replenishment-allocation", label: "Replenishment and Allocation", group: "Requirements and Priority", icon: <Workflow className="h-4 w-4" />, keywords: ["replenishment", "allocation", "stock replenishment", "reserve"] },

  // 7. Planning
  { id: "planning-rough-availability", label: "Rough Availability", group: "Planning", icon: <Gem className="h-4 w-4" />, keywords: ["rough inventory", "rough reservations", "available stones", "kapan"] },
  { id: "planning-workbook-import", label: "Workbook Import", group: "Planning", icon: <FileText className="h-4 w-4" />, keywords: ["workbook", "import", "xlsx", "excel", "upload"] },
  { id: "planning-workbench", label: "Planning Workbench", group: "Planning", icon: <LayoutDashboard className="h-4 w-4" />, keywords: ["planning cases", "planned pieces", "workbench", "planner"] },
  { id: "planning-comparison", label: "Plan Comparison", group: "Planning", icon: <Scale className="h-4 w-4" />, keywords: ["plan comparison", "evaluate", "versions", "side by side"] },
  { id: "planning-approval-queue", label: "Approval Queue", group: "Planning", icon: <BookCheck className="h-4 w-4" />, keywords: ["approval", "queue", "signoff", "manager approval"] },

  // 8. Manufacturing
  { id: "manufacturing-overview", label: "Manufacturing Overview", group: "Manufacturing", icon: <Boxes className="h-4 w-4" />, keywords: ["fantasy tracking", "department view", "location view", "wip"] },
  { id: "manufacturing-traceability", label: "Traceability", group: "Manufacturing", icon: <GitBranch className="h-4 w-4" />, keywords: ["trace", "genealogy", "stone history", "parent rough"] },

  // 9. Evaluation and Reconciliation
  { id: "plan-vs-actual", label: "Plan vs Actual", group: "Evaluation and Reconciliation", icon: <Scale className="h-4 w-4" />, keywords: ["plan vs actual", "fantasy reconciliation", "yield variance", "reconciliation"] },

  // 10. Data Science (Advisory / Future)
  { id: "data-science-forecasting", label: "Forecasting", group: "Data Science", icon: <TrendingUp className="h-4 w-4" />, advisory: true, keywords: ["operational forecast", "predictive forecast", "forecast accuracy", "future"] },
  { id: "data-science-predictive-models", label: "Predictive Models", group: "Data Science", icon: <Layers className="h-4 w-4" />, advisory: true, keywords: ["anomaly detection", "yield prediction", "models", "advisory"] },
  { id: "data-science-prediction-monitoring", label: "Model Monitoring", group: "Data Science", icon: <Activity className="h-4 w-4" />, advisory: true, keywords: ["prediction monitoring", "drift", "metrics", "monitoring"] },

  // 11. Reports
  { id: "reports", label: "Reports Library", group: "Reports", icon: <FileBarChart className="h-4 w-4" />, keywords: ["reports", "export", "pdf", "excel", "summary"] },

  // 12. Administration
  { id: "admin-users-access", label: "Users and Access", group: "Administration", icon: <Users className="h-4 w-4" />, keywords: ["users and roles", "access requests", "rbac", "permissions"] },
  { id: "admin-rules-mappings", label: "Business Rules and Mappings", group: "Administration", icon: <ShieldCheck className="h-4 w-4" />, keywords: ["business rules", "weight bands", "lab mapping", "shape mapping", "status mapping"] },
  { id: "admin-system-settings", label: "System Settings", group: "Administration", icon: <Settings className="h-4 w-4" />, keywords: ["feature flags", "system settings", "integrations", "config"] },
  { id: "admin-audit-log", label: "Audit Log", group: "Administration", icon: <ClipboardList className="h-4 w-4" />, keywords: ["audit log", "security", "activity trail", "events"] },
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
                const authorized = isViewAuthorized(perms, item.id);
                return (
                  <button
                    key={item.tab ? `${item.id}:${item.tab}` : item.id}
                    onMouseEnter={() => setActiveIdx(idx)}
                    onClick={() => selectItem(item)}
                    className={cn(
                      "w-full flex items-center gap-3 px-3 py-2 text-left text-sm transition-colors",
                      active ? "bg-primary/10 text-foreground" : "hover:bg-muted/50",
                      !authorized && !active && "text-muted-foreground/70"
                    )}
                  >
                    <span className={cn("text-muted-foreground", active && "text-primary")}>{item.icon}</span>
                    <span className="flex-1 truncate">{item.label}</span>
                    {item.advisory && (
                      <span className="text-[9px] font-medium px-1.5 py-0.5 rounded bg-violet-500/10 text-violet-600 dark:text-violet-400 border border-violet-500/20">
                        Advisory
                      </span>
                    )}
                    {!authorized && (
                      <span className="flex items-center gap-1 text-[10px] font-medium text-amber-600 dark:text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/20">
                        <Lock className="h-3 w-3" />
                        Locked
                      </span>
                    )}
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
