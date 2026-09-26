"use client";

import { UserMenu } from "@/components/auth/auth-gate";
import { useAuthStore } from "@/stores/auth-store";
import { isViewAuthorized } from "@/lib/auth/view-permissions";
import { useNavStore, ViewId } from "@/stores/nav-store";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard, BarChart3, TrendingUp, Users, ShoppingCart, Globe, Gem,
  FileText, Package, Boxes, Factory, GitBranch, ShieldCheck, AlertTriangle,
  FlaskConical, FileBarChart, Settings, ChevronDown, ChevronRight, Search,
  Bell, User, Database, Activity, Scale, Layers, Map, FileWarning,
  Workflow, ClipboardCheck, CalendarClock, Hash, RefreshCw, BookCheck, ClipboardList, Diamond,
  Moon, Sun, Monitor, Command as CommandIcon, History, Calculator, ArrowLeftRight, UserPlus,
  Lock, HardDrive, X, Star
} from "lucide-react";
import { ReactNode, useState, useEffect, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useTheme } from "next-themes";
import { apiFetch } from "@/lib/api-client";
import { useQuery } from "@tanstack/react-query";
import { CommandPalette } from "@/components/diamond/command-palette";
import { GlobalFilterBar } from "@/components/diamond/global-filter-bar";
import { DiamondMark } from "@/components/brand/diamond-mark";
import { useRealtimeStore } from "@/stores/realtime-store";

export interface NavItem {
  id: ViewId;
  label: string;
  icon: ReactNode;
  advisory?: boolean;
}

export interface NavGroup {
  id: string;
  label: string;
  icon: ReactNode;
  advisory?: boolean;
  items: NavItem[];
}

export const NAV: NavGroup[] = [
  // 1. Dashboard (Landing)
  {
    id: "dashboard-group",
    label: "Dashboard",
    icon: <LayoutDashboard className="h-4 w-4" />,
    items: [
      { id: "dashboard", label: "Executive Dashboard", icon: <LayoutDashboard className="h-3.5 w-3.5" /> },
    ],
  },
  // 2. Analysis (Direct Analytical Workspace)
  {
    id: "analysis-group",
    label: "Analysis",
    icon: <BarChart3 className="h-4 w-4" />,
    items: [
      { id: "analysis-executive", label: "Executive Analysis", icon: <BarChart3 className="h-3.5 w-3.5" /> },
      // Sales Analysis + Sales Trends live as tabs inside one module (#analysis-sales?tab=analysis|trends).
      { id: "analysis-sales", label: "Sales Analysis & Trends", icon: <TrendingUp className="h-3.5 w-3.5" /> },
      { id: "analysis-customers-orders", label: "Customers & Orders", icon: <Users className="h-3.5 w-3.5" /> },
      { id: "analysis-inventory-position", label: "Inventory", icon: <Package className="h-3.5 w-3.5" /> },
      { id: "analysis-stockout", label: "Stockout Risk", icon: <AlertTriangle className="h-3.5 w-3.5" />, advisory: true },
      { id: "analysis-excess", label: "Excess Stock", icon: <Package className="h-3.5 w-3.5" /> },
      { id: "analysis-aging", label: "Stock Aging", icon: <CalendarClock className="h-3.5 w-3.5" /> },
      { id: "analysis-reorder-signals", label: "Reorder Signals", icon: <Star className="h-3.5 w-3.5" />, advisory: true },
      // Demand Run History and Demand Trace moved to the Demand section. Their view ids,
      // hashes, routes and components are unchanged — only the sidebar placement moved.
      { id: "transfer-analyzer", label: "Transfer Analyzer", icon: <ArrowLeftRight className="h-3.5 w-3.5" />, advisory: true },
      { id: "aging-dashboard", label: "Aging Dashboard", icon: <LayoutDashboard className="h-3.5 w-3.5" /> },
    ],
  },
  // 3. Fantasy ERP (Source)
  {
    id: "fantasy-group",
    label: "Fantasy ERP",
    icon: <Database className="h-4 w-4" />,
    items: [
      { id: "fantasy-live", label: "Current Data", icon: <Boxes className="h-3.5 w-3.5" /> },
      { id: "fantasy-sync", label: "Sync Monitor", icon: <RefreshCw className="h-3.5 w-3.5" /> },
    ],
  },
  // 3. Overall Data (Permanent Archive)
  {
    id: "overall-data-group",
    label: "Overall Data",
    icon: <HardDrive className="h-4 w-4" />,
    items: [
      { id: "overall-data", label: "Overall Data", icon: <HardDrive className="h-3.5 w-3.5" /> },
    ],
  },
  // 4. Data Quality (Integrity)
  {
    id: "data-quality-group",
    label: "Data Quality",
    icon: <FileWarning className="h-4 w-4" />,
    items: [
      { id: "data-quality-issues", label: "Data Quality Issues", icon: <AlertTriangle className="h-3.5 w-3.5" /> },
    ],
  },
  // 5. Demand (Market signal and its calculation history)
  //
  // Inventory stays in Analysis; this section is only about demand. Stock Strategy is
  // hidden here because it belongs to the later planning/replenishment phase — its view
  // id, route, component, permission and tests are all untouched, so re-listing it is a
  // one-line change when that phase starts.
  {
    id: "demand-group",
    label: "Demand",
    icon: <BarChart3 className="h-4 w-4" />,
    items: [
      { id: "demand-overview", label: "Demand Overview", icon: <Activity className="h-3.5 w-3.5" /> },
      { id: "analysis-demand-trace", label: "Demand Trace", icon: <Calculator className="h-3.5 w-3.5" /> },
    ],
  },
  // 6. Requirements and Priority (Demand Translation)
  {
    id: "requirements-group",
    label: "Requirements and Priority",
    icon: <ClipboardList className="h-4 w-4" />,
    items: [
      { id: "requirements-matrix", label: "Requirement Matrix", icon: <Hash className="h-3.5 w-3.5" /> },
      { id: "requirements-priority-queue", label: "Priority Queue", icon: <AlertTriangle className="h-3.5 w-3.5" /> },
      { id: "orders-exceptions", label: "Orders and Exceptions", icon: <FileText className="h-3.5 w-3.5" /> },
      { id: "replenishment-allocation", label: "Replenishment and Allocation", icon: <Workflow className="h-3.5 w-3.5" /> },
    ],
  },
  // 7. Planning (Rough Optimization)
  {
    id: "planning-group",
    label: "Planning",
    icon: <Diamond className="h-4 w-4" />,
    items: [
      { id: "planning-rough-availability", label: "Rough Availability", icon: <Gem className="h-3.5 w-3.5" /> },
      { id: "planning-workbook-import", label: "Workbook Import", icon: <FileText className="h-3.5 w-3.5" /> },
      { id: "planning-workbench", label: "Planning Workbench", icon: <LayoutDashboard className="h-3.5 w-3.5" /> },
      { id: "planning-comparison", label: "Plan Comparison", icon: <Scale className="h-3.5 w-3.5" /> },
      { id: "planning-approval-queue", label: "Approval Queue", icon: <BookCheck className="h-3.5 w-3.5" /> },
    ],
  },
  // 8. Manufacturing (Execution)
  {
    id: "manufacturing-group",
    label: "Manufacturing",
    icon: <Factory className="h-4 w-4" />,
    items: [
      { id: "manufacturing-overview", label: "Manufacturing Overview", icon: <Boxes className="h-3.5 w-3.5" /> },
      { id: "manufacturing-traceability", label: "Traceability", icon: <GitBranch className="h-3.5 w-3.5" /> },
    ],
  },
  // 9. Evaluation and Reconciliation (Plan vs Actual)
  {
    id: "evaluation-group",
    label: "Evaluation and Reconciliation",
    icon: <Scale className="h-4 w-4" />,
    items: [
      { id: "plan-vs-actual", label: "Plan vs Actual", icon: <ClipboardCheck className="h-3.5 w-3.5" /> },
    ],
  },
  // 10. Data Science (Advisory / Future)
  {
    id: "data-science-group",
    label: "Data Science",
    icon: <FlaskConical className="h-4 w-4" />,
    advisory: true,
    items: [
      { id: "data-science-forecasting", label: "Forecasting", icon: <TrendingUp className="h-3.5 w-3.5" />, advisory: true },
      { id: "data-science-predictive-models", label: "Predictive Models", icon: <Layers className="h-3.5 w-3.5" />, advisory: true },
      { id: "data-science-prediction-monitoring", label: "Model Monitoring", icon: <Activity className="h-3.5 w-3.5" />, advisory: true },
    ],
  },
  // 11. Reports
  {
    id: "reports-group",
    label: "Reports",
    icon: <FileBarChart className="h-4 w-4" />,
    items: [
      { id: "reports", label: "Reports Library", icon: <FileBarChart className="h-3.5 w-3.5" /> },
    ],
  },
  // 12. Administration
  {
    id: "admin-group",
    label: "Administration",
    icon: <Settings className="h-4 w-4" />,
    items: [
      { id: "admin-users-access", label: "Users and Access", icon: <Users className="h-3.5 w-3.5" /> },
      { id: "admin-rules-mappings", label: "Business Rules and Mappings", icon: <ShieldCheck className="h-3.5 w-3.5" /> },
      { id: "admin-system-settings", label: "System Settings", icon: <Settings className="h-3.5 w-3.5" /> },
      { id: "admin-audit-log", label: "Audit Log", icon: <ClipboardList className="h-3.5 w-3.5" /> },
    ],
  },
];

function NavGroupItem({ group }: { group: NavGroup }) {
  const perms = useAuthStore((s) => s.user?.permissions);
  const collapsed = useNavStore((s) => s.collapsedGroups[group.id]);
  const toggleGroup = useNavStore((s) => s.toggleGroup);
  const view = useNavStore((s) => s.view);
  const setView = useNavStore((s) => s.setView);
  const setSidebarOpen = useNavStore((s) => s.setSidebarOpen);

  const hasActive = group.items.some((i) => i.id === view);
  const isSingleItem = group.items.length === 1;

  const handleGroupHeaderClick = () => {
    if (isSingleItem) {
      setView(group.items[0].id);
      if (typeof window !== "undefined" && window.innerWidth < 768) {
        setSidebarOpen(false);
      }
    } else {
      toggleGroup(group.id);
    }
  };

  const handleItemClick = (id: ViewId) => {
    setView(id);
    if (typeof window !== "undefined" && window.innerWidth < 768) {
      setSidebarOpen(false);
    }
  };

  return (
    <div className="border-b border-sidebar-border/30 last:border-0 py-0.5">
      <button
        type="button"
        onClick={handleGroupHeaderClick}
        className={cn(
          "w-full flex items-center gap-2 px-3 py-1.5 text-left text-[10px] font-bold uppercase tracking-wider transition-colors rounded-md mx-auto",
          hasActive
            ? "text-sidebar-foreground font-bold"
            : "text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent/50"
        )}
      >
        <span className="text-sidebar-foreground/60">{group.icon}</span>
        <span className="flex-1 truncate">{group.label}</span>
        {group.advisory && (
          <span className="text-[8px] font-semibold px-1.5 py-0.2 rounded bg-purple-50 text-purple-700 dark:bg-purple-950/50 dark:text-purple-300 border border-purple-200/60 lowercase tracking-normal">
            Advisory
          </span>
        )}
        {!isSingleItem && (
          <span className="text-muted-foreground ml-1">
            {collapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </span>
        )}
      </button>

      {(!collapsed || isSingleItem) && (
        <ul className="space-y-0.5 py-0.5">
          {group.items.map((item) => {
            const active = view === item.id;
            const authorized = isViewAuthorized(perms, item.id);
            return (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => handleItemClick(item.id)}
                  title={!authorized ? "Access Restricted — Click to view requirements" : item.label}
                  className={cn(
                    "w-[calc(100%-12px)] mx-1.5 flex items-center gap-2 px-2.5 py-1.5 text-left text-[12px] rounded-lg transition-all relative",
                    active
                      ? "bg-[#FFE2D1] text-[#1C1917] dark:bg-[#272322] dark:text-[#FFEDD5] font-bold shadow-2xs"
                      : "text-sidebar-foreground/80 hover:bg-sidebar-accent/70 hover:text-sidebar-foreground font-medium",
                    !authorized && !active && "text-sidebar-foreground/45 hover:text-sidebar-foreground/65"
                  )}
                >
                  {active && (
                    <span className="absolute right-1.5 top-1.5 bottom-1.5 w-1 rounded-full bg-[#F9733E]" />
                  )}
                  <span className={cn("shrink-0", active ? "text-[#1C1917] dark:text-[#FFEDD5]" : "text-sidebar-foreground/60")}>{item.icon}</span>
                  <span className="flex-1 truncate">{item.label}</span>
                  {item.advisory && (
                    <span className="text-[8px] font-medium px-1 rounded bg-purple-50 text-purple-600 dark:bg-purple-950/50 dark:text-purple-300 border border-purple-200/50">
                      Adv
                    </span>
                  )}
                  {!authorized && (
                    <Lock className="h-3 w-3 text-muted-foreground/50 shrink-0 ml-auto" aria-label="Restricted Access" />
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// Collapsed state on desktop: a narrow rail of group icons with expand header.
function NavRail() {
  const perms = useAuthStore((s) => s.user?.permissions);
  const view = useNavStore((s) => s.view);
  const setSidebarOpen = useNavStore((s) => s.setSidebarOpen);
  const toggleGroup = useNavStore((s) => s.toggleGroup);
  const collapsedGroups = useNavStore((s) => s.collapsedGroups);

  const openGroup = (groupId: string) => {
    if (collapsedGroups[groupId]) toggleGroup(groupId);
    setSidebarOpen(true);
  };

  return (
    <aside className="hidden md:flex md:static md:w-14 md:flex-shrink-0 md:my-2 md:ml-2 md:h-[calc(100vh-16px)] md:flex-col md:rounded-2xl border border-sidebar-border bg-sidebar shadow-xs overflow-hidden z-20">
      {/* NavRail Top Header */}
      <div className="h-12 border-b border-sidebar-border flex items-center justify-center flex-shrink-0">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-sidebar-foreground hover:bg-sidebar-accent"
          onClick={() => setSidebarOpen(true)}
          aria-label="Expand sidebar"
          title="Expand sidebar"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
      <nav className="flex-1 overflow-y-auto flex flex-col items-center gap-0.5 py-2">
        {NAV.map((g) => {
          const active = g.items.some((i) => i.id === view);
          const allRestricted = g.items.every((i) => !isViewAuthorized(perms, i.id));
          return (
            <button
              key={g.id}
              type="button"
              onClick={() => openGroup(g.id)}
              title={`${g.label}${allRestricted ? " (Restricted)" : ""}`}
              aria-label={`${g.label} — expand sidebar`}
              className={cn(
                "relative flex h-9 w-9 items-center justify-center rounded-md transition-colors",
                active
                  ? "bg-sidebar-accent text-sidebar-foreground"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
                allRestricted && !active && "opacity-50"
              )}
            >
              {active && <span className="absolute left-0 h-5 w-0.5 rounded-r bg-sidebar-primary" />}
              {g.icon}
              {allRestricted && (
                <span className="absolute bottom-1 right-1 h-1.5 w-1.5 rounded-full bg-amber-500/70" />
              )}
            </button>
          );
        })}
      </nav>
    </aside>
  );
}

function GlobalSearch() {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const setView = useNavStore((s) => s.setView);

  const { data: searchResults, isFetching } = useQuery({
    queryKey: ["global-search", query],
    queryFn: async () => {
      if (!query || query.trim().length < 2) return null;
      try {
        const q = encodeURIComponent(query.trim());
        const [roughRes, polishedRes, reqRes] = await Promise.all([
          apiFetch<{ rows: Array<{ id: string; fantasyRoughId: string; stoneName: string; kapan: string; country: string }> }>(`/api/fantasy/rough?q=${q}&take=5`).catch(() => null),
          apiFetch<{ rows: Array<{ id: string; fantasyLotId: string; shape: string; weight: number; country: string }> }>(`/api/fantasy/polished?q=${q}&take=5`).catch(() => null),
          apiFetch<{ data: Array<{ id: string; requirementCode: string; customerName: string | null }> }>(`/api/requirements?q=${q}&pageSize=5`).catch(() => null),
        ]);
        return {
          rough: roughRes?.rows?.slice(0, 5) ?? [],
          polished: polishedRes?.rows?.slice(0, 5) ?? [],
          requirements: reqRes?.data?.slice(0, 5) ?? [],
        };
      } catch {
        return null;
      }
    },
    enabled: query.trim().length >= 2,
    staleTime: 5_000,
  });

  const hasResults =
    searchResults &&
    (searchResults.rough.length > 0 || searchResults.polished.length > 0 || searchResults.requirements.length > 0);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && hasResults) {
      if (searchResults.rough.length > 0) {
        setView("fantasy-live", "rough");
        setOpen(false);
      } else if (searchResults.polished.length > 0) {
        setView("fantasy-live", "polished");
        setOpen(false);
      } else if (searchResults.requirements.length > 0) {
        setView("requirements-matrix");
        setOpen(false);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div className="relative w-full max-w-md">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
      <Input
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        placeholder="Search Lot ID, Rough ID, Kapan..."
        className="h-8 pl-8 pr-7 text-xs bg-muted/40 hover:bg-muted/60 focus:bg-card border-border/70 focus:border-[#F9733E]/60 rounded-xl transition-all shadow-2xs"
      />
      {query && (
        <button
          type="button"
          onClick={() => { setQuery(""); setOpen(false); }}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-0.5 cursor-pointer"
          title="Clear search"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
      {open && query.trim().length >= 2 && (
        <div
          className="absolute top-full mt-1.5 left-0 right-0 z-50 rounded-xl border border-border bg-popover shadow-xl overflow-hidden max-h-80 overflow-y-auto animate-in fade-in-50 zoom-in-95"
          onMouseDown={(e) => e.preventDefault()} // Prevent input blur when clicking items
        >
          {isFetching && !searchResults && (
            <div className="px-3 py-4 text-center text-xs text-muted-foreground">Searching...</div>
          )}
          {hasResults && (
            <>
              {searchResults.rough.length > 0 && (
                <div className="p-1.5">
                  <p className="text-[10px] uppercase font-semibold tracking-wide text-muted-foreground px-2 py-0.5">Rough Stones</p>
                  {searchResults.rough.map((r) => (
                    <button
                      key={r.id}
                      onClick={() => { setView("fantasy-live", "rough"); setOpen(false); }}
                      className="w-full flex items-center justify-between px-2 py-1 text-xs hover:bg-muted rounded text-left transition-colors cursor-pointer"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <Gem className="h-3.5 w-3.5 text-primary shrink-0" />
                        <span className="font-semibold">{r.fantasyRoughId}</span>
                        <span className="text-muted-foreground truncate">{r.stoneName} (Kapan: {r.kapan})</span>
                      </div>
                      <span className="text-[10px] text-muted-foreground uppercase font-mono ml-2 shrink-0">{r.country}</span>
                    </button>
                  ))}
                </div>
              )}
              {searchResults.polished.length > 0 && (
                <div className="p-1.5 border-t border-border">
                  <p className="text-[10px] uppercase font-semibold tracking-wide text-muted-foreground px-2 py-0.5">Polished Lots</p>
                  {searchResults.polished.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => { setView("fantasy-live", "polished"); setOpen(false); }}
                      className="w-full flex items-center justify-between px-2 py-1 text-xs hover:bg-muted rounded text-left transition-colors cursor-pointer"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <Diamond className="h-3.5 w-3.5 text-sky-500 shrink-0" />
                        <span className="font-semibold">{p.fantasyLotId}</span>
                        <span className="text-muted-foreground">{p.shape} {p.weight}ct</span>
                      </div>
                      <span className="text-[10px] text-muted-foreground uppercase font-mono ml-2 shrink-0">{p.country}</span>
                    </button>
                  ))}
                </div>
              )}
              {searchResults.requirements.length > 0 && (
                <div className="p-1.5 border-t border-border">
                  <p className="text-[10px] uppercase font-semibold tracking-wide text-muted-foreground px-2 py-0.5">Requirements</p>
                  {searchResults.requirements.map((r) => (
                    <button
                      key={r.id}
                      onClick={() => { setView("requirements-matrix"); setOpen(false); }}
                      className="w-full flex items-center justify-between px-2 py-1 text-xs hover:bg-muted rounded text-left transition-colors cursor-pointer"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <ClipboardList className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                        <span className="font-semibold">{r.requirementCode}</span>
                        <span className="text-muted-foreground truncate">{r.customerName ?? "Stock Requirement"}</span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
          {!isFetching && searchResults && !hasResults && (
            <div className="px-3 py-4 text-center text-xs text-muted-foreground">
              No results found for &ldquo;{query}&rdquo;
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const emptySubscribe = () => () => {};

function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const mounted = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  );
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
    queryFn: () => apiFetch<{ rows: Array<{ id: string; title: string; message: string; severity: string; read: boolean; createdAt?: string }> }>("/api/notifications"),
    staleTime: 60_000,
  });
  const unread = data?.rows.filter((n) => !n.read).length ?? 0;
  const [open, setOpen] = useState(false);
  const realtimeEvents = useRealtimeStore((s) => s.events);
  const realtimeConnected = useRealtimeStore((s) => s.connected);
  const realtimeUnread = useRealtimeStore((s) => s.unreadCount);
  const clearRealtimeUnread = useRealtimeStore((s) => s.clearUnread);
  const totalUnread = unread + realtimeUnread;

  const handleToggle = () => {
    const next = !open;
    setOpen(next);
    if (next && realtimeUnread > 0) clearRealtimeUnread();
  };

  const formatRelTime = (iso: string) => {
    const diff = Date.now() - new Date(iso).getTime();
    const sec = Math.floor(diff / 1000);
    if (sec < 60) return `${sec}s ago`;
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h ago`;
    return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  };

  return (
    <div className="relative">
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 relative text-muted-foreground hover:text-foreground hover:bg-muted/80 rounded-lg"
        onClick={handleToggle}
        aria-label="Notifications"
      >
        <Bell className="h-4 w-4" />
        {realtimeConnected && (
          <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-emerald-500 ring-2 ring-card animate-pulse" title="Connected to realtime updates" />
        )}
        {totalUnread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 h-4 min-w-4 px-1 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center shadow-[0_1px_4px_rgba(239,68,68,0.45)] ring-2 ring-card">
            {totalUnread > 9 ? "9+" : totalUnread}
          </span>
        )}
      </Button>
      {open && (
        <div className="absolute top-full mt-2 right-0 w-84 z-50 rounded-xl border border-border bg-popover shadow-xl overflow-hidden animate-in fade-in-50 zoom-in-95">
          <div className="px-3.5 py-2.5 border-b border-border bg-muted/40 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <p className="text-xs font-bold text-foreground">Action Inbox</p>
              {totalUnread > 0 && (
                <span className="text-[10px] font-bold px-1.5 py-0.2 rounded-full bg-red-500/15 text-red-600 dark:text-red-400">
                  {totalUnread} new
                </span>
              )}
            </div>
            <span className={cn("flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full border",
              realtimeConnected
                ? "text-emerald-700 bg-emerald-50 border-emerald-200 dark:text-emerald-300 dark:bg-emerald-950/40 dark:border-emerald-800"
                : "text-muted-foreground bg-muted border-border")}>
              <span className={cn("h-1.5 w-1.5 rounded-full", realtimeConnected ? "bg-emerald-500" : "bg-muted-foreground")} />
              {realtimeConnected ? "Live Channel" : "Offline"}
            </span>
          </div>

          <div className="max-h-88 overflow-y-auto divide-y divide-border/40">
            {realtimeEvents.length > 0 && (
              <>
                <div className="px-3 py-1 bg-primary/5 border-b border-border/40">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-primary">Live Activity ({realtimeEvents.length})</p>
                </div>
                {realtimeEvents.map((evt) => (
                  <div key={evt.id} className="px-3.5 py-2.5 hover:bg-muted/40 transition-colors">
                    <div className="flex items-start gap-2.5">
                      <span className={cn("h-2 w-2 rounded-full mt-1 shrink-0",
                        evt.severity === "error" ? "bg-rose-500" :
                        evt.severity === "warning" ? "bg-amber-500" :
                        evt.severity === "success" ? "bg-emerald-500" :
                        "bg-primary")} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-2">
                          <p className="text-xs font-semibold text-foreground truncate">{evt.title}</p>
                          <span className="text-[9px] text-muted-foreground shrink-0 tabular-nums">{formatRelTime(evt.timestamp)}</span>
                        </div>
                        <p className="text-[11px] text-muted-foreground line-clamp-2 mt-0.5 leading-relaxed">{evt.message}</p>
                        {evt.demoMode && (
                          <span className="inline-block mt-1 text-[9px] font-medium text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 px-1.5 py-0.2 rounded border border-amber-200 dark:border-amber-800">
                            simulation
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </>
            )}

            {data && data.rows.length > 0 && (
              <>
                <div className="px-3 py-1 bg-muted/20 border-b border-border/40">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Recent System Alerts ({data.rows.length})</p>
                </div>
                {data.rows.map((n) => (
                  <div key={n.id} className={cn("px-3.5 py-2.5 hover:bg-muted/40 transition-colors", !n.read && "bg-primary/[0.02]")}>
                    <div className="flex items-start gap-2.5">
                      <span className={cn("h-2 w-2 rounded-full mt-1 shrink-0",
                        n.severity === "CRITICAL" ? "bg-rose-500" :
                        n.severity === "ERROR" ? "bg-rose-400" :
                        n.severity === "WARNING" ? "bg-amber-500" :
                        "bg-primary")} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-2">
                          <p className="text-xs font-semibold text-foreground truncate">{n.title}</p>
                          {n.createdAt && (
                            <span className="text-[9px] text-muted-foreground shrink-0 tabular-nums">{formatRelTime(n.createdAt)}</span>
                          )}
                        </div>
                        <p className="text-[11px] text-muted-foreground line-clamp-2 mt-0.5 leading-relaxed">{n.message}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </>
            )}

            {realtimeEvents.length === 0 && (!data || data.rows.length === 0) && (
              <div className="px-4 py-8 text-center text-xs text-muted-foreground">
                <p className="font-medium text-foreground">No alerts</p>
                <p className="text-[11px] mt-0.5">Your action inbox is up to date.</p>
              </div>
            )}
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

  // Auto-close sidebar when viewport shrinks below md (768px)
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 768) {
        setSidebarOpen(false);
      }
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [setSidebarOpen]);

  return (
    <div data-app-shell className="h-screen max-h-screen w-full flex text-foreground overflow-hidden">
      {/* Mobile backdrop when sidebar open */}
      {sidebarOpen && (
        <div
          className="md:hidden fixed inset-0 bg-black/50 z-40 backdrop-blur-xs"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar — overlay on mobile, static rounded panel on desktop */}
      {sidebarOpen && (
        <aside
          className={cn(
            "bg-sidebar flex flex-col border border-sidebar-border shadow-xs overflow-hidden transition-all",
            // Mobile: fixed drawer overlay
            "fixed inset-y-2 left-2 w-72 max-w-[85vw] rounded-2xl shadow-2xl z-50",
            // Desktop: static side-by-side rounded panel with subtle margin
            "md:static md:my-2 md:ml-2 md:h-[calc(100vh-16px)] md:w-64 md:max-w-none md:flex-shrink-0 md:rounded-2xl md:z-20 md:shadow-xs"
          )}
        >
          {/* Sidebar Top Header with Warm Brand Capsule + Planning Title + Collapse Button */}
          <div className="p-2.5 flex-shrink-0">
            <div className="bg-[#FFE2D0]/95 dark:bg-[#25201D] border border-[#F5CEB5] dark:border-[#3D322C] rounded-xl p-2.5 flex items-center justify-between gap-2 shadow-2xs">
              <div className="flex items-center gap-2.5 min-w-0 flex-1">
                <div className="h-7 w-7 rounded-lg bg-[#18181B] text-white flex items-center justify-center flex-shrink-0 shadow-xs">
                  <DiamondMark className="h-4 w-4" />
                </div>
                <div className="flex flex-col leading-tight min-w-0 flex-1">
                  <span className="text-xs font-black tracking-tight text-[#18181B] dark:text-[#FFEDD5] truncate select-none">
                    Planning
                  </span>
                  <span className="text-[9px] text-[#786960] dark:text-[#A8988E] truncate select-none">
                    ERP Platform
                  </span>
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-[#18181B]/60 hover:text-[#18181B] hover:bg-[#FCD8BE]/60 dark:text-muted-foreground dark:hover:text-foreground flex-shrink-0"
                onClick={() => setSidebarOpen(false)}
                aria-label="Collapse sidebar"
                title="Collapse sidebar"
              >
                <ChevronDown className="h-3.5 w-3.5 -rotate-90" />
              </Button>
            </div>
          </div>

          {/* Navigation Items */}
          <nav className="flex-1 overflow-y-auto px-1 py-1">
            {NAV.map((g) => (
              <NavGroupItem key={g.id} group={g} />
            ))}
          </nav>

          {/* Sidebar Footer — Plan Smarter / Brighter Tomorrows Card */}
          <div className="p-2.5 border-t border-sidebar-border/30 flex-shrink-0">
            <div className="bg-[#FFE2D0]/90 dark:bg-[#25201D] border border-[#F5CEB5] dark:border-[#3D322C] rounded-xl p-3 mb-1 text-xs shadow-2xs">
              <p className="font-bold text-[#18181B] dark:text-[#FFEDD5] text-[11px] leading-tight">Plan Smarter</p>
              <p className="text-[#786960] dark:text-[#A8988E] text-[10px] mt-0.5 leading-tight">Brighter Tomorrows</p>
            </div>
          </div>
        </aside>
      )}

      {/* Collapsed: icon rail on desktop */}
      {!sidebarOpen && <NavRail />}

      {/* Right Content Area: Top Bar + Main View + Bottom Footer */}
      <div className="flex-1 flex flex-col h-screen min-w-0 overflow-hidden">
        {/* Pinned Top Bar */}
        <header className="sticky top-0 z-50 h-12 border-b border-border bg-card/95 backdrop-blur-md flex items-center gap-1.5 sm:gap-2 px-2 sm:px-4 flex-shrink-0">
          {/* Mobile hamburger toggle (only when sidebar is closed) */}
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 md:hidden flex-shrink-0"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open navigation menu"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>

          {/* Search */}
          <div className="hidden sm:block w-48 xl:w-56 2xl:w-64 flex-shrink-0">
            <GlobalSearch />
          </div>

          {/* Global Filter Bar inside top bar */}
          <div className="hidden md:flex items-center flex-shrink-0">
            <GlobalFilterBar />
          </div>

          {/* Spacer to push actions right */}
          <div className="flex-1" />

          {/* Right actions */}
          <div className="flex items-center gap-1 sm:gap-1.5 ml-auto flex-shrink-0">
            {/* Mobile: show small Cmd+K icon button */}
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 lg:hidden text-muted-foreground hover:text-foreground"
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
              className="h-7 gap-1.5 text-[11px] hidden xl:flex text-muted-foreground hover:text-foreground border-border bg-card"
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
            <UserMenu />
          </div>
        </header>

        {/* Center Main Workspace */}
        <main className="flex-1 min-w-0 h-full overflow-y-auto overflow-x-hidden flex flex-col">
          {children}
        </main>

        {/* Pinned Bottom Footer */}
        <footer className="h-8 border-t border-border bg-card/90 backdrop-blur-sm px-2 sm:px-3 flex items-center justify-between gap-2 text-[10px] text-muted-foreground flex-shrink-0 z-10 select-none">
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
      </div>

      {/* Command palette (Cmd+K / Ctrl+K) */}
      <CommandPalette />
    </div>
  );
}
