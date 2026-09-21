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
      {/* Sticky Tab Header */}
      <div className="sticky top-0 z-20 -mx-3 -mt-3 mb-3 border-b border-border bg-card/95 backdrop-blur-md px-4 pt-3 pb-0 shadow-xs">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-2.5">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-base font-semibold tracking-tight text-foreground truncate">{title}</h1>
              {advisory && (
                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wider bg-violet-500/10 text-violet-600 dark:bg-violet-500/20 dark:text-violet-400 border border-violet-500/20">
                  Advisory / Future
                </span>
              )}
            </div>
            {subtitle && <p className="text-[11px] text-muted-foreground mt-0.5">{subtitle}</p>}
          </div>
          {(actions || meta) && (
            <div className="flex items-center gap-2 flex-wrap">
              {meta}
              {actions}
            </div>
          )}
        </div>

        {/* Tab Navigation Strip */}
        <div className="flex items-center gap-1 overflow-x-auto no-scrollbar -mb-px">
          {tabs.map((tab) => {
            const active = tab.id === activeTab;
            const authorized = !tab.permission || userPerms.includes(tab.permission);
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => handleTabClick(tab.id)}
                className={cn(
                  "flex items-center gap-2 px-3 py-2 text-xs font-medium border-b-2 transition-colors whitespace-nowrap",
                  active
                    ? "border-primary text-foreground font-semibold bg-background/50"
                    : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
                )}
              >
                {tab.icon && <span className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground">{tab.icon}</span>}
                <span>{tab.label}</span>
                {!authorized && (
                  <span title="Restricted tab">
                    <Lock className="h-3 w-3 text-muted-foreground/70" />
                  </span>
                )}
                {tab.badge && (
                  <span className={cn(
                    "px-1.5 py-0.2 rounded text-[9px] font-mono",
                    tab.badgeVariant === "advisory"
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
