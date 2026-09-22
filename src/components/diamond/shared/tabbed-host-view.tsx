"use client";

import { ReactNode, useState, useEffect } from "react";
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
  const activeTab = (activeNavTab && tabs.some((t) => t.id === activeNavTab))
    ? activeNavTab
    : (defaultTab || tabs[0]?.id);

  const handleTabClick = (tabId: string) => {
    setNavTab(tabId);
  };

  const currentTab = tabs.find((t) => t.id === activeTab) || tabs[0];
  const isTabAuthorized = !currentTab?.permission || userPerms.includes(currentTab.permission);
  const ActiveComponent = currentTab?.component;

  return (
    <div className="flex flex-col min-h-full">
      {/* Sleek Compact Sticky Tab Header */}
      <div className="sticky top-0 z-20 -mx-3 -mt-3 mb-2 border-b border-border bg-card/95 backdrop-blur-md px-3 py-1.5 shadow-xs flex items-center justify-between gap-3 flex-wrap min-h-10">
        <div className="flex items-center gap-2.5 min-w-0 flex-1 overflow-x-auto no-scrollbar">
          {/* Page Title */}
          <div className="flex items-center gap-2 flex-shrink-0">
            <h1 className="text-sm font-semibold tracking-tight text-foreground truncate">{title}</h1>
            {advisory && (
              <span className="inline-flex items-center px-1.5 py-0.2 rounded text-[9px] font-semibold uppercase tracking-wider bg-violet-500/10 text-violet-600 dark:bg-violet-500/20 dark:text-violet-400 border border-violet-500/20">
                Advisory
              </span>
            )}
          </div>

          <div className="h-4 w-px bg-border/60 hidden sm:block flex-shrink-0" />

          {/* Compact Tab Pills */}
          <div className="flex items-center gap-1 flex-shrink-0">
            {tabs.map((tab) => {
              const active = tab.id === activeTab;
              const authorized = !tab.permission || userPerms.includes(tab.permission);
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => handleTabClick(tab.id)}
                  className={cn(
                    "flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap",
                    active
                      ? "bg-primary text-primary-foreground shadow-xs font-semibold"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
                  )}
                >
                  {tab.icon && <span className={cn("h-3.5 w-3.5 flex-shrink-0", active ? "text-primary-foreground" : "text-muted-foreground")}>{tab.icon}</span>}
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
                        ? "bg-primary-foreground/20 text-primary-foreground"
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

      {/* Tab Body */}
      <div className="flex-1 min-h-0">
        {!isTabAuthorized ? (
          <AccessRestricted
            title={`Access Restricted: ${currentTab.label}`}
            requiredPermission={currentTab.permission}
            description="You do not have the required permission to view this specific tab within this module."
          />
        ) : ActiveComponent ? (
          <ActiveComponent />
        ) : null}
      </div>
    </div>
  );
}
