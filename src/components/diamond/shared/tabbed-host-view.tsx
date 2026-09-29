"use client";

import { ReactNode, useId, useRef, useState, useEffect, useMemo } from "react";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/auth-store";
import { useNavStore } from "@/stores/nav-store";
import { AccessRestricted } from "@/components/diamond/shared/access-restricted";
import { HostTabContext } from "@/components/diamond/shared/density";

export interface HostTabItem {
  id: string;
  label: string;
  icon?: ReactNode;
  /** The permission the tab needs, or several of which any one admits it. */
  permission?: string | readonly string[];
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
export function isTabPermitted(permission: string | readonly string[] | undefined, userPerms: readonly string[]): boolean {
  if (!permission) return true;
  return typeof permission === "string" ? userPerms.includes(permission) : permission.some((p) => userPerms.includes(p));
}

export function resolveActiveTab(
  tabs: ReadonlyArray<{ id: string; permission?: string | readonly string[] }>,
  navTab: string | null | undefined,
  defaultTab?: string,
  userPerms?: readonly string[],
): string | undefined {
  const allowed = (t: { permission?: string | readonly string[] }) => !userPerms || isTabPermitted(t.permission, userPerms);
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
  // Tabs this user may not open are not shown at all, and a page left with a single tab
  // shows no tab strip. Each tab's content and API still enforce their own permission.
  const visibleTabs = useMemo(() => tabs.filter((t) => isTabPermitted(t.permission, userPerms)), [tabs, userPerms]);
  const idBase = useId();
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const tabId = (id: string) => `${idBase}-tab-${id}`;
  const panelId = (id: string) => `${idBase}-panel-${id}`;

  const [pillStyle, setPillStyle] = useState<{ left: number; top: number; width: number; height: number; ready: boolean }>({
    left: 0,
    top: 2,
    width: 0,
    height: 0,
    ready: false,
  });

  useEffect(() => {
    const updatePill = () => {
      if (!activeTab) return;
      const activeEl = tabRefs.current[activeTab];
      if (activeEl) {
        const next = {
          left: activeEl.offsetLeft,
          top: activeEl.offsetTop,
          width: activeEl.offsetWidth,
          height: activeEl.offsetHeight,
          ready: true,
        };
        setPillStyle((prev) => {
          if (
            prev.ready === next.ready &&
            prev.left === next.left &&
            prev.top === next.top &&
            prev.width === next.width &&
            prev.height === next.height
          ) {
            return prev;
          }
          return next;
        });
      }
    };

    updatePill();
    const timer = setTimeout(updatePill, 50);
    window.addEventListener("resize", updatePill);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("resize", updatePill);
    };
  }, [activeTab, visibleTabs.length]);

  const handleTabClick = (tabId: string) => {
    setNavTab(tabId);
  };

  // Roving tabindex: Left/Right/Home/End move between tabs and activate them (WAI-ARIA tabs pattern).
  const handleTabKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key) || visibleTabs.length === 0) return;
    const idx = Math.max(0, visibleTabs.findIndex((t) => t.id === activeTab));
    const next =
      e.key === "ArrowLeft" ? (idx - 1 + visibleTabs.length) % visibleTabs.length :
      e.key === "ArrowRight" ? (idx + 1) % visibleTabs.length :
      e.key === "Home" ? 0 : visibleTabs.length - 1;
    e.preventDefault();
    const nextId = visibleTabs[next].id;
    setNavTab(nextId);
    tabRefs.current[nextId]?.focus();
  };

  // `activeTab` is undefined only when the user may read none of them.
  const currentTab = tabs.find((t) => t.id === activeTab);
  const isTabAuthorized = Boolean(currentTab) && isTabPermitted(currentTab!.permission, userPerms);
  const ActiveComponent = currentTab?.component;

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden">
      {/* Sleek Compact Tab Header with Frosted Glass */}
      <div className="z-20 flex flex-shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-border/70 bg-card/85 px-page-x py-1 backdrop-blur-md">
        <div className="flex items-center gap-3 min-w-0 flex-1 overflow-x-auto no-scrollbar">
          {/* Page Title */}
          <div className="flex items-center gap-2 flex-shrink-0">
            <h1 className="truncate text-lg font-semibold tracking-tight text-foreground">{title}</h1>
            {advisory && (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wider bg-violet-500/10 text-violet-600 dark:bg-violet-500/20 dark:text-violet-400 border border-violet-500/20">
                Advisory
              </span>
            )}
          </div>

          {visibleTabs.length > 1 && (
          <>
          <div className="h-5 w-px bg-border/80 hidden sm:block flex-shrink-0" />

          {/* Unified Oval Segmented Tab Switch */}
          <div
            role="tablist"
            aria-label={title}
            onKeyDown={handleTabKeyDown}
            className="relative inline-flex items-center p-0.5 rounded-full border border-border/90 bg-muted/50 dark:bg-muted/30 shadow-2xs flex-shrink-0"
          >
            {/* Smooth Sliding Active Pill Indicator */}
            {pillStyle.ready && (
              <span
                aria-hidden="true"
                className="pointer-events-none absolute rounded-full bg-white shadow-xs border border-border/40 transition-all duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)] dark:bg-[#1E2330] dark:border-white/10"
                style={{
                  transform: `translate3d(${pillStyle.left}px, ${pillStyle.top}px, 0)`,
                  width: `${pillStyle.width}px`,
                  height: `${pillStyle.height}px`,
                  left: 0,
                  top: 0,
                }}
              />
            )}

            {visibleTabs.map((tab) => {
              const active = tab.id === activeTab;
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
                    "relative z-10 flex h-7 items-center gap-1.5 whitespace-nowrap rounded-full px-3 text-xs transition-colors duration-200 cursor-pointer select-none",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F9733E]/50",
                    active
                      ? "text-[#EA580C] font-bold dark:text-[#FFEDD5]"
                      : "text-muted-foreground hover:text-foreground font-medium"
                  )}
                >
                  {tab.icon && (
                    <span className={cn("h-3.5 w-3.5 flex-shrink-0 transition-colors duration-200", active ? "text-[#EA580C] dark:text-[#FFEDD5]" : "text-muted-foreground")}>
                      {tab.icon}
                    </span>
                  )}
                  <span>{tab.label}</span>
                  {tab.badge && (
                    <span className={cn(
                      "px-1.5 py-0.2 rounded-full text-[9px] font-mono transition-colors duration-200",
                      active
                        ? "bg-[#EA580C]/12 text-[#EA580C] dark:bg-white/20 dark:text-white"
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
          </>
          )}
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
        aria-labelledby={currentTab && visibleTabs.length > 1 ? tabId(currentTab.id) : undefined}
        aria-label={visibleTabs.length > 1 ? undefined : title}
        className="flex-1 min-h-0 min-w-0 overflow-y-auto overflow-x-hidden flex flex-col"
      >
        {!isTabAuthorized ? (
          <AccessRestricted
            title={currentTab ? `Access Restricted: ${currentTab.label}` : "Access Restricted"}
            requiredPermission={typeof currentTab?.permission === "string" ? currentTab.permission : undefined}
            description={
              currentTab
                ? "You don't have access to this tab."
                : "You don't have access to this page."
            }
          />
        ) : ActiveComponent && currentTab ? (
          // The page inside does not repeat the host title or the tab label; with the tab
          // strip hidden it shows its own title, which is then the only place it appears.
          <HostTabContext.Provider value={{ hostTitle: title, tabLabel: visibleTabs.length > 1 ? currentTab.label : "" }}>
            <ActiveComponent />
          </HostTabContext.Provider>
        ) : null}
      </div>
    </div>
  );
}
