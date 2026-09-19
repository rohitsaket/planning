"use client";

import { useNavStore, ViewId } from "@/stores/nav-store";
import { cn } from "@/lib/utils";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard, BarChart3, TrendingUp, Users, ShoppingCart, Globe, Gem,
  FileText, Package, Boxes, Factory, GitBranch, ShieldCheck, AlertTriangle,
  FlaskConical, FileBarChart, Settings, ChevronDown, ChevronRight, Search,
  Bell, User, Database, Activity, Scale, Layers, Map, FileWarning,
  Workflow, ClipboardCheck, CalendarClock, Hash, RefreshCw, BookCheck, ClipboardList, Diamond,
  Moon, Sun, Monitor, Command as CommandIcon, History
} from "lucide-react";
import { ReactNode, useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useTheme } from "next-themes";
import { apiFetch } from "@/lib/api-client";
import { useQuery } from "@tanstack/react-query";
import { CommandPalette } from "@/components/diamond/command-palette";
import { GlobalFilterBar } from "@/components/diamond/global-filter-bar";

interface NavItem {
  id: ViewId;
  label: string;
  icon: ReactNode;
}
interface NavGroup {
  id: string;
  label: string;
  icon: ReactNode;
  items: NavItem[];
}

const NAV: NavGroup[] = [
  {
    id: "top",
    label: "Overview",
    icon: <LayoutDashboard className="h-4 w-4" />,
    items: [
      { id: "dashboard", label: "Executive Dashboard", icon: <LayoutDashboard className="h-3.5 w-3.5" /> },
    ],
  },
  {
    id: "analysis",
    label: "Analysis",
    icon: <BarChart3 className="h-4 w-4" />,
    items: [
      { id: "analysis-executive", label: "Executive Analysis", icon: <Activity className="h-3.5 w-3.5" /> },
      { id: "analysis-sales", label: "Sales Analysis", icon: <ShoppingCart className="h-3.5 w-3.5" /> },
      { id: "analysis-sales-trends", label: "Sales Trends", icon: <TrendingUp className="h-3.5 w-3.5" /> },
      { id: "analysis-customers", label: "Customers", icon: <Users className="h-3.5 w-3.5" /> },
      { id: "analysis-orders", label: "Orders", icon: <FileText className="h-3.5 w-3.5" /> },
      { id: "analysis-country", label: "Country / Branch", icon: <Globe className="h-3.5 w-3.5" /> },
      { id: "analysis-polished", label: "Polished Inventory", icon: <Gem className="h-3.5 w-3.5" /> },
      { id: "analysis-memo", label: "Memo Analysis", icon: <FileText className="h-3.5 w-3.5" /> },
      { id: "analysis-wip", label: "WIP Analysis", icon: <Boxes className="h-3.5 w-3.5" /> },
      { id: "analysis-forecast", label: "Forecast", icon: <TrendingUp className="h-3.5 w-3.5" /> },
      { id: "analysis-stockout", label: "Stockout Risk", icon: <AlertTriangle className="h-3.5 w-3.5" /> },
      { id: "analysis-excess", label: "Excess Stock", icon: <Package className="h-3.5 w-3.5" /> },
      { id: "analysis-aging", label: "Stock Aging", icon: <CalendarClock className="h-3.5 w-3.5" /> },
      { id: "analysis-reorder-signals", label: "Reorder Signals", icon: <Star className="h-3.5 w-3.5" /> },
      { id: "demand-history", label: "Demand Run History", icon: <History className="h-3.5 w-3.5" /> },
    ],
  },
  {
    id: "requirements",
    label: "Requirements",
    icon: <ClipboardList className="h-4 w-4" />,
    items: [
      { id: "requirements-matrix", label: "Requirement Matrix", icon: <Hash className="h-3.5 w-3.5" /> },
      { id: "requirements-priority-queue", label: "Priority Queue", icon: <AlertTriangle className="h-3.5 w-3.5" /> },
      { id: "requirements-orders", label: "Customer Orders", icon: <FileText className="h-3.5 w-3.5" /> },
      { id: "requirements-replenishment", label: "Replenishment", icon: <RefreshCw className="h-3.5 w-3.5" /> },
      { id: "requirements-backorders", label: "Backorders", icon: <FileWarning className="h-3.5 w-3.5" /> },
      { id: "requirements-special", label: "Special Requirements", icon: <Star className="h-3.5 w-3.5" /> },
      { id: "requirements-forecast-signals", label: "Forecast Signals", icon: <TrendingUp className="h-3.5 w-3.5" /> },
      { id: "requirements-allocation", label: "Allocation", icon: <Workflow className="h-3.5 w-3.5" /> },
    ],
  },
  {
    id: "planning",
    label: "Planning",
    icon: <Diamond className="h-4 w-4" />,
    items: [
      { id: "planning-rough-availability", label: "Rough Availability", icon: <Gem className="h-3.5 w-3.5" /> },
      { id: "planning-cases", label: "Planning Cases", icon: <ClipboardList className="h-3.5 w-3.5" /> },
      { id: "planning-comparison", label: "Plan Comparison", icon: <Scale className="h-3.5 w-3.5" /> },
      { id: "planning-workbook-import", label: "Workbook Import", icon: <FileText className="h-3.5 w-3.5" /> },
      { id: "planning-workbench", label: "Planning Workbench", icon: <LayoutDashboard className="h-3.5 w-3.5" /> },
      { id: "planning-approval-queue", label: "Approval Queue", icon: <BookCheck className="h-3.5 w-3.5" /> },
      { id: "planning-planned-pieces", label: "Planned Pieces", icon: <Layers className="h-3.5 w-3.5" /> },
      { id: "planning-reservations", label: "Rough Reservations", icon: <ShieldCheck className="h-3.5 w-3.5" /> },
    ],
  },
  {
    id: "manufacturing",
    label: "Manufacturing",
    icon: <Factory className="h-4 w-4" />,
    items: [
      { id: "manufacturing-tracking", label: "Fantasy Tracking", icon: <Activity className="h-3.5 w-3.5" /> },
      { id: "manufacturing-departments", label: "Department View", icon: <Boxes className="h-3.5 w-3.5" /> },
      { id: "manufacturing-locations", label: "Location View", icon: <Map className="h-3.5 w-3.5" /> },
      { id: "manufacturing-wip", label: "WIP", icon: <Boxes className="h-3.5 w-3.5" /> },
      { id: "manufacturing-traceability", label: "Traceability", icon: <GitBranch className="h-3.5 w-3.5" /> },
      { id: "manufacturing-plan-vs-actual", label: "Plan vs Actual", icon: <Scale className="h-3.5 w-3.5" /> },
    ],
  },
  {
    id: "fantasy",
    label: "Fantasy ERP",
    icon: <Database className="h-4 w-4" />,
    items: [
      { id: "fantasy-sync", label: "Sync Dashboard", icon: <RefreshCw className="h-3.5 w-3.5" /> },
      { id: "fantasy-rough", label: "Rough Stock", icon: <Gem className="h-3.5 w-3.5" /> },
      { id: "fantasy-polished", label: "Polished Stock", icon: <Diamond className="h-3.5 w-3.5" /> },
      { id: "fantasy-departments", label: "Departments", icon: <Boxes className="h-3.5 w-3.5" /> },
      { id: "fantasy-locations", label: "Locations", icon: <Map className="h-3.5 w-3.5" /> },
      { id: "fantasy-status-mapping", label: "Status Mapping", icon: <Workflow className="h-3.5 w-3.5" /> },
      { id: "fantasy-reconciliation", label: "Reconciliation", icon: <ClipboardCheck className="h-3.5 w-3.5" /> },
    ],
  },
  {
    id: "data-quality",
    label: "Data Quality",
    icon: <FileWarning className="h-4 w-4" />,
    items: [
      { id: "data-quality-issues", label: "Issues", icon: <AlertTriangle className="h-3.5 w-3.5" /> },
      { id: "data-quality-unmapped-labs", label: "Unmapped Labs", icon: <FileWarning className="h-3.5 w-3.5" /> },
      { id: "data-quality-unmapped-shapes", label: "Unmapped Shapes", icon: <FileWarning className="h-3.5 w-3.5" /> },
    ],
  },
  {
    id: "data-science",
    label: "Data Science",
    icon: <FlaskConical className="h-4 w-4" />,
    items: [
      { id: "data-science-anomaly-detection", label: "Anomaly Detection", icon: <AlertTriangle className="h-3.5 w-3.5" /> },
      { id: "data-science-yield-prediction", label: "Yield Prediction", icon: <TrendingUp className="h-3.5 w-3.5" /> },
      { id: "data-science-forecast", label: "Forecast", icon: <TrendingUp className="h-3.5 w-3.5" /> },
      { id: "data-science-models", label: "Models", icon: <Layers className="h-3.5 w-3.5" /> },
      { id: "data-science-prediction-monitoring", label: "Prediction Monitoring", icon: <Activity className="h-3.5 w-3.5" /> },
      { id: "data-science-forecast-accuracy", label: "Forecast Accuracy", icon: <BarChart3 className="h-3.5 w-3.5" /> },
    ],
  },
  {
    id: "reports",
    label: "Reports",
    icon: <FileBarChart className="h-4 w-4" />,
    items: [
      { id: "reports", label: "Reports Library", icon: <FileBarChart className="h-3.5 w-3.5" /> },
    ],
  },
  {
    id: "admin",
    label: "Administration",
    icon: <Settings className="h-4 w-4" />,
    items: [
      { id: "admin-business-rules", label: "Business Rules", icon: <ShieldCheck className="h-3.5 w-3.5" /> },
      { id: "admin-weight-bands", label: "Weight Bands", icon: <Scale className="h-3.5 w-3.5" /> },
      { id: "admin-lab-mappings", label: "Lab Mapping", icon: <Gem className="h-3.5 w-3.5" /> },
      { id: "admin-shape-mappings", label: "Shape Mapping", icon: <Diamond className="h-3.5 w-3.5" /> },
      { id: "admin-feature-flags", label: "Feature Flags", icon: <Workflow className="h-3.5 w-3.5" /> },
      { id: "admin-audit-log", label: "Audit Log", icon: <ClipboardList className="h-3.5 w-3.5" /> },
      { id: "admin-users", label: "Users & Roles", icon: <Users className="h-3.5 w-3.5" /> },
    ],
  },
];

function Star({ className }: { className?: string }) {
  return <span className={cn("inline-block", className)}>★</span>;
}

function NavGroupItem({ group }: { group: NavGroup }) {
  const collapsed = useNavStore((s) => s.collapsedGroups[group.id]);
  const toggleGroup = useNavStore((s) => s.toggleGroup);
  const view = useNavStore((s) => s.view);
  const setView = useNavStore((s) => s.setView);
  const hasActive = group.items.some((i) => i.id === view) || group.id === "top" && view === "dashboard";

  return (
    <div className="border-b border-sidebar-border/40 last:border-0">
      <button
        type="button"
        onClick={() => toggleGroup(group.id)}
        className={cn(
          "w-full flex items-center gap-2 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-sidebar-foreground/80 hover:bg-sidebar-accent/60 transition-colors",
          hasActive && "text-sidebar-foreground"
        )}
      >
        <span className="text-sidebar-foreground/70">{group.icon}</span>
        <span className="flex-1 truncate">{group.label}</span>
        {group.id !== "top" && (
          <span className="text-muted-foreground">
            {collapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </span>
        )}
      </button>
      {(!collapsed || group.id === "top") && (
        <ul className="space-y-0.5 pb-1">
          {group.items.map((item) => {
            const active = view === item.id;
            return (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => setView(item.id)}
                  className={cn(
                    "w-full flex items-center gap-2 pl-5 pr-3 py-1.5 text-left text-[12px] text-sidebar-foreground/80 hover:bg-sidebar-accent/70 hover:text-sidebar-foreground transition-colors border-l-2",
                    active
                      ? "border-sidebar-primary bg-sidebar-accent text-sidebar-foreground font-medium"
                      : "border-transparent"
                  )}
                >
                  <span className="text-muted-foreground">{item.icon}</span>
                  <span className="flex-1 truncate">{item.label}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function GlobalSearch() {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const setView = useNavStore((s) => s.setView);

  const { data: searchResults } = useQuery({
    queryKey: ["global-search", query],
    queryFn: async () => {
      if (!query || query.length < 2) return null;
      // Search across rough, polished, requirements, cases
      try {
        const [roughRes, polishedRes, reqRes] = await Promise.all([
          apiFetch<{ rows: Array<{ id: string; fantasyRoughId: string; stoneName: string; kapan: string }> }>(`/api/planning/rough?q=${encodeURIComponent(query)}`).catch(() => null),
          apiFetch<{ rows: Array<{ id: string; fantasyLotId: string; shape: string; weight: number }> }>(`/api/fantasy/polished?q=${encodeURIComponent(query)}`).catch(() => null),
          apiFetch<{ data: Array<{ id: string; requirementCode: string; customerName: string | null }> }>(`/api/requirements?q=${encodeURIComponent(query)}`).catch(() => null),
        ]);
        return { rough: roughRes?.rows?.slice(0, 5) ?? [], polished: polishedRes?.rows?.slice(0, 5) ?? [], requirements: reqRes?.data?.slice(0, 5) ?? [] };
      } catch {
        return null;
      }
    },
    enabled: query.length >= 2,
    staleTime: 10_000,
  });

  return (
    <div className="relative w-full max-w-md">
      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
      <Input
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 200)}
        placeholder="Search Lot ID, Rough ID, Kapan, Requirement..."
        className="h-8 pl-8 text-xs bg-muted/50 border-border/60"
      />
      {open && searchResults && (searchResults.rough.length > 0 || searchResults.polished.length > 0 || searchResults.requirements.length > 0) && (
        <div className="absolute top-full mt-1 left-0 right-0 z-50 rounded-md border border-border bg-popover shadow-lg overflow-hidden">
          {searchResults.rough.length > 0 && (
            <div className="p-2">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground px-1 mb-1">Rough Stones</p>
              {searchResults.rough.map((r) => (
                <button key={r.id} onClick={() => { setView("fantasy-rough"); setOpen(false); }} className="w-full flex items-center gap-2 px-2 py-1 text-xs hover:bg-muted rounded text-left">
                  <Gem className="h-3 w-3 text-muted-foreground" />
                  <span className="font-medium">{r.fantasyRoughId}</span>
                  <span className="text-muted-foreground truncate">{r.stoneName}</span>
                </button>
              ))}
            </div>
          )}
          {searchResults.polished.length > 0 && (
            <div className="p-2 border-t border-border">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground px-1 mb-1">Polished Lots</p>
              {searchResults.polished.map((p) => (
                <button key={p.id} onClick={() => { setView("fantasy-polished"); setOpen(false); }} className="w-full flex items-center gap-2 px-2 py-1 text-xs hover:bg-muted rounded text-left">
                  <Diamond className="h-3 w-3 text-muted-foreground" />
                  <span className="font-medium">{p.fantasyLotId}</span>
                  <span className="text-muted-foreground">{p.shape} {p.weight}ct</span>
                </button>
              ))}
            </div>
          )}
          {searchResults.requirements.length > 0 && (
            <div className="p-2 border-t border-border">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground px-1 mb-1">Requirements</p>
              {searchResults.requirements.map((r) => (
                <button key={r.id} onClick={() => { setView("requirements-matrix"); setOpen(false); }} className="w-full flex items-center gap-2 px-2 py-1 text-xs hover:bg-muted rounded text-left">
                  <ClipboardList className="h-3 w-3 text-muted-foreground" />
                  <span className="font-medium">{r.requirementCode}</span>
                  <span className="text-muted-foreground truncate">{r.customerName ?? ""}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setMounted(true), []);
  if (!mounted) return <div className="h-8 w-8" />;
  return (
    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
      {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </Button>
  );
}

function NotificationsBell() {
  const { data } = useQuery({
    queryKey: ["notifications"],
    queryFn: () => apiFetch<{ rows: Array<{ id: string; title: string; message: string; severity: string; read: boolean }> }>("/api/notifications"),
    staleTime: 60_000,
  });
  const unread = data?.rows.filter((n) => !n.read).length ?? 0;
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <Button variant="ghost" size="icon" className="h-8 w-8 relative" onClick={() => setOpen(!open)}>
        <Bell className="h-4 w-4" />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 h-3.5 min-w-3.5 px-1 rounded-full bg-rose-500 text-white text-[9px] font-bold flex items-center justify-center">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </Button>
      {open && data && (
        <div className="absolute top-full mt-1 right-0 w-80 z-50 rounded-md border border-border bg-popover shadow-lg overflow-hidden">
          <div className="px-3 py-2 border-b border-border bg-muted/50">
            <p className="text-xs font-semibold">Notifications ({data.rows.length})</p>
          </div>
          <div className="max-h-80 overflow-y-auto">
            {data.rows.map((n) => (
              <div key={n.id} className="px-3 py-2 border-b border-border/50 last:border-0 hover:bg-muted/40">
                <div className="flex items-start gap-2">
                  <span className={cn("h-1.5 w-1.5 rounded-full mt-1.5 flex-shrink-0",
                    n.severity === "CRITICAL" ? "bg-rose-500" :
                    n.severity === "ERROR" ? "bg-rose-400" :
                    n.severity === "WARNING" ? "bg-amber-400" :
                    "bg-sky-400")} />
                  <div className="min-w-0">
                    <p className="text-xs font-medium truncate">{n.title}</p>
                    <p className="text-[10px] text-muted-foreground line-clamp-2">{n.message}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const sidebarOpen = useNavStore((s) => s.sidebarOpen);
  const setSidebarOpen = useNavStore((s) => s.setSidebarOpen);
  const view = useNavStore((s) => s.view);

  // Close mobile sidebar on view change (via hash change)
  useEffect(() => {
    const closeOnMobile = () => {
      if (typeof window !== "undefined" && window.innerWidth < 768) {
        setSidebarOpen(false);
      }
    };
    window.addEventListener("hashchange", closeOnMobile);
    return () => window.removeEventListener("hashchange", closeOnMobile);
  }, [setSidebarOpen]);

  // Auto-close sidebar on mobile initial load
  useEffect(() => {
    if (typeof window !== "undefined" && window.innerWidth < 768) {
      setSidebarOpen(false);
    }
  }, [setSidebarOpen]);

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      {/* Top bar */}
      <header className="h-12 border-b border-border bg-card/80 backdrop-blur-sm flex items-center gap-1.5 sm:gap-2 px-2 sm:px-3 sticky top-0 z-40">
        {/* Hamburger / collapse toggle */}
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 flex-shrink-0"
          onClick={() => setSidebarOpen(!sidebarOpen)}
          aria-label="Toggle sidebar"
        >
          {sidebarOpen ? (
            <ChevronDown className="h-4 w-4 -rotate-90" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
        </Button>
        <div className="flex items-center gap-2 mr-1 sm:mr-2 flex-shrink-0">
          <div className="h-6 w-6 rounded bg-gradient-to-br from-primary/80 to-primary flex items-center justify-center">
            <Diamond className="h-3.5 w-3.5 text-primary-foreground" />
          </div>
          <div className="hidden sm:flex flex-col leading-none">
            <span className="text-xs font-semibold tracking-tight">Diamond Manufacturing ERP</span>
            <span className="text-[9px] text-muted-foreground">Analysis · Requirement · Planning · Traceability</span>
          </div>
        </div>
        {/* Search: hidden on mobile (use command palette instead) */}
        <div className="hidden md:block flex-1 min-w-0">
          <GlobalSearch />
        </div>
        {/* Spacer for mobile to push actions right */}
        <div className="md:hidden flex-1" />
        <div className="flex items-center gap-1 sm:gap-1.5 ml-auto flex-shrink-0">
          {/* Mobile: show small Cmd+K icon button */}
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 lg:hidden"
            onClick={() => {
              window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, ctrlKey: true }));
            }}
            aria-label="Command palette"
          >
            <CommandIcon className="h-4 w-4" />
          </Button>
          {/* Desktop: show labeled Cmd+K button */}
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-[11px] hidden lg:flex"
            onClick={() => {
              window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, ctrlKey: true }));
            }}
          >
            <CommandIcon className="h-3 w-3" />
            <span>Command</span>
            <kbd className="font-mono text-[9px] bg-muted px-1 py-0.5 rounded border border-border">⌘K</kbd>
          </Button>
          <ThemeToggle />
          <NotificationsBell />
          <div className="h-7 w-7 sm:h-8 sm:w-8 rounded-full bg-muted border border-border flex items-center justify-center">
            <User className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-muted-foreground" />
          </div>
        </div>
      </header>

      {/* Global filter bar (sticky below topbar) */}
      <GlobalFilterBar className="sticky top-12 z-30" />

      <div className="flex flex-1 min-h-0 relative">
        {/* Mobile backdrop when sidebar open */}
        {sidebarOpen && (
          <div
            className="md:hidden fixed inset-0 top-12 bg-black/40 z-30 backdrop-blur-sm"
            onClick={() => setSidebarOpen(false)}
          />
        )}
        {/* Sidebar — overlay on mobile, inline on desktop */}
        {sidebarOpen && (
          <aside
            className={cn(
              "border-r border-sidebar-border bg-sidebar overflow-y-auto z-40",
              // Mobile: fixed drawer overlay
              "fixed inset-y-0 left-0 top-12 w-72 max-w-[85vw] shadow-xl md:shadow-none",
              // Desktop: inline sticky
              "md:static md:sticky md:top-12 md:w-60 md:max-w-none md:flex-shrink-0 md:z-auto md:max-h-[calc(100vh-3rem)]"
            )}
          >
            <nav className="py-1">
              {NAV.map((g) => <NavGroupItem key={g.id} group={g} />)}
            </nav>
            <div className="px-3 py-2 text-[9px] text-muted-foreground/60 border-t border-sidebar-border/40">
              <p>v1.0 · Demand rule v1 · {new Date().getFullYear()}</p>
            </div>
          </aside>
        )}

        {/* Main content */}
        <main className="flex-1 min-w-0 overflow-y-auto max-h-[calc(100vh-3rem-2rem)]">
          {children}
        </main>
      </div>

      {/* Sticky footer */}
      <footer className="mt-auto border-t border-border bg-card/60 px-2 sm:px-3 py-1.5 flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <span className="flex items-center gap-1 flex-shrink-0">
            <ShieldCheck className="h-3 w-3" /> Fantasy
          </span>
          <span className="hidden sm:inline">·</span>
          <span className="hidden sm:inline">90D rule CONFIRMED</span>
          <span className="hidden md:inline">·</span>
          <span className="hidden md:inline">Memo excluded</span>
        </div>
        <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
          <span className="truncate">View: <span className="text-foreground font-medium">{view}</span></span>
        </div>
      </footer>

      {/* Command palette (Cmd+K / Ctrl+K) */}
      <CommandPalette />
    </div>
  );
}
