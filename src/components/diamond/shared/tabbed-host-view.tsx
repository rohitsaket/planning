"use client";

import { ReactNode, useId, useRef } from "react";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/auth-store";
import { useNavStore } from "@/stores/nav-store";
import { Lock } from "lucide-react";
import { AccessRestricted } from "@/components/diamond/shared/access-restricted";

export interface HostTabItem {
  id: string;
  label: string;
  icon?: ReactNode;
  permission?: string;
  badge?: string;
  badgeVariant?: "default" | "secondary" | "advisory" | "outline";
  component: React.ComponentType;
}

/**
 * Active tab for a host: the URL/nav tab when it belongs to this host, else the default,
 * else the first.
 *
 * When permissions are supplied, an unauthorized candidate is skipped rather than
 * selected. A page a user reaches through one tab's permission therefore opens on a tab
 * they may actually read, instead of opening on the default and showing Access
 * Restricted. The selected tab is still authorized again before it renders, and each
 * tab's API enforces its own permission, so this is navigation, not a security decision.
 *
 * Returns undefined when no tab is authorized — the caller shows Access Restricted.
 */
export function resolveActiveTab(
  tabs: ReadonlyArray<{ id: string; permission?: string }>,
  navTab: string | null | undefined,
  defaultTab?: string,
  userPerms?: readonly string[],
): string | undefined {
  const allowed = (t: { permission?: string }) => !userPerms || !t.permission || userPerms.includes(t.permission);
  const pick = (id: string | null | undefined) => tabs.find((t) => t.id === id && allowed(t))?.id;
  return pick(navTab) ?? pick(defaultTab) ?? tabs.find(allowed)?.id;
}

interface TabbedHostViewProps {
  title: string;
  subtitle?: string;
  tabs: HostTabItem[];
  defaultTab?: string;
  actions?: ReactNode;
  meta?: ReactNode;
  advisory?: boolean;
}

export function TabbedHostView({
  title,
  subtitle,
  tabs,
  defaultTab,
  actions,
  meta,
  advisory = false,
}: TabbedHostViewProps) {
  const userPerms = useAuthStore((s) => s.user?.permissions ?? []);
  const activeNavTab = useNavStore((s) => s.tab);
  const setNavTab = useNavStore((s) => s.setTab);
  const activeTab = resolveActiveTab(tabs, activeNavTab, defaultTab, userPerms);
  const idBase = useId();
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const tabId = (id: string) => `${idBase}-tab-${id}`;
  const panelId = (id: string) => `${idBase}-panel-${id}`;

  const handleTabClick = (tabId: string) => {
    setNavTab(tabId);
  };

  // Roving tabindex: Left/Right/Home/End move between tabs and activate them (WAI-ARIA tabs pattern).
  const handleTabKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key) || tabs.length === 0) return;
    const idx = Math.max(0, tabs.findIndex((t) => t.id === activeTab));
    const next =
      e.key === "ArrowLeft" ? (idx - 1 + tabs.length) % tabs.length :
      e.key === "ArrowRight" ? (idx + 1) % tabs.length :
      e.key === "Home" ? 0 : tabs.length - 1;
    e.preventDefault();
    const nextId = tabs[next].id;
    setNavTab(nextId);
    tabRefs.current[nextId]?.focus();
  };

  // `activeTab` is undefined only when the user may read none of them.
  const currentTab = tabs.find((t) => t.id === activeTab);
  const isTabAuthorized = Boolean(currentTab) && (!currentTab!.permission || userPerms.includes(currentTab!.permission));
  const ActiveComponent = currentTab?.component;

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden">
      {/* Sleek Compact Tab Header */}
      <div className="flex-shrink-0 z-20 border-b border-border bg-card/95 px-4 sm:px-5 py-1.5 shadow-xs flex items-center justify-between gap-3 flex-wrap min-h-11">
        <div className="flex items-center gap-3 min-w-0 flex-1 overflow-x-auto no-scrollbar">
          {/* Page Title */}
          <div className="flex items-center gap-2 flex-shrink-0">
            <h1 className="text-lg font-bold tracking-tight text-foreground truncate">{title}</h1>
            {advisory && (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wider bg-violet-500/10 text-violet-600 dark:bg-violet-500/20 dark:text-violet-400 border border-violet-500/20">
                Advisory
              </span>
            )}
          </div>

          <div className="h-5 w-px bg-border/80 hidden sm:block flex-shrink-0" />

          {/* Compact Tab Pills */}
          <div role="tablist" aria-label={title} onKeyDown={handleTabKeyDown} className="flex items-center gap-1 flex-shrink-0">
            {tabs.map((tab) => {
              const active = tab.id === activeTab;
              const authorized = !tab.permission || userPerms.includes(tab.permission);
              return (
                <button
                  key={tab.id}
                  ref={(el) => { tabRefs.current[tab.id] = el; }}
                  type="button"
                  role="tab"
                  id={tabId(tab.id)}
                  aria-selected={active}
                  aria-controls={panelId(tab.id)}
                  tabIndex={active ? 0 : -1}
                  onClick={() => handleTabClick(tab.id)}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-all whitespace-nowrap",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F9733E]/50 focus-visible:ring-offset-1",
                    active
                      ? "bg-[#FFE2D1] text-[#18181B] dark:bg-[#272322] dark:text-[#FFEDD5] font-bold shadow-2xs"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
                  )}
                >
                  {tab.icon && <span className={cn("h-3.5 w-3.5 flex-shrink-0", active ? "text-[#18181B] dark:text-[#FFEDD5]" : "text-muted-foreground")}>{tab.icon}</span>}
                  <span>{tab.label}</span>
                  {!authorized && (
                    <span title="Restricted tab">
                      <Lock className="h-3 w-3 opacity-70" />
                    </span>
                  )}
                  {tab.badge && (
                    <span className={cn(
                      "px-1.5 py-0.2 rounded text-[9px] font-mono",
                      active
                        ? "bg-[#18181B]/15 text-[#18181B] dark:bg-white/20 dark:text-white"
                        : tab.badgeVariant === "advisory"
                        ? "bg-violet-500/10 text-violet-600 dark:text-violet-400"
                        : "bg-muted text-muted-foreground"
                    )}>
                      {tab.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Source Badge & Actions */}
        {(actions || meta) && (
          <div className="flex items-center gap-2 flex-shrink-0 ml-auto">
            {meta}
            {actions}
          </div>
        )}
      </div>

      {/* Tab Body — the single vertical scroll owner for a module. The shell locks the viewport
          (<main> is overflow-hidden), so page content scrolls here, below the always-visible
          title/tab strip. Sub-views that size themselves to `h-full` keep scrolling only their
          own tables; taller sub-views scroll here. Horizontal overflow is handled by the table
          wrappers, never by the page. */}
      <div
        role="tabpanel"
        id={currentTab ? panelId(currentTab.id) : undefined}
        aria-labelledby={currentTab ? tabId(currentTab.id) : undefined}
        className="flex-1 min-h-0 min-w-0 overflow-y-auto overflow-x-hidden flex flex-col"
      >
        {!isTabAuthorized ? (
          <AccessRestricted
            title={currentTab ? `Access Restricted: ${currentTab.label}` : "Access Restricted"}
            requiredPermission={currentTab?.permission}
            description={
              currentTab
                ? "You do not have the required permission to view this specific tab within this module."
                : "You do not have permission to view any section of this module."
            }
          />
        ) : ActiveComponent ? (
          <ActiveComponent />
        ) : null}
      </div>
    </div>
  );
}
