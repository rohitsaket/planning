"use client";

import { useState } from "react";
import { TabbedHostView, HostTabItem } from "@/components/diamond/shared/tabbed-host-view";
import { FantasySourceBadge } from "@/components/diamond/shared/fantasy-source-badge";
import { FantasyRoughView } from "@/components/diamond/views/fantasy-rough-view";
import { FantasyPolishedView } from "@/components/diamond/views/fantasy-polished-view";
import { FantasySyncView } from "@/components/diamond/views/fantasy-sync-view";
import { OverallDataView } from "@/components/diamond/views/overall-data-view";
import { useAuthStore } from "@/stores/auth-store";
import { cn } from "@/lib/utils";
import { Boxes, HardDrive, RefreshCw } from "lucide-react";

const CURRENT_STOCK = [
  { id: "rough", label: "Rough stock", permission: "rough.read", component: FantasyRoughView },
  { id: "polished", label: "Polished stock", permission: "fantasy.read", component: FantasyPolishedView },
] as const;

/**
 * Current Data: rough and polished stock from the last synchronization. Each stock type
 * keeps its own permission; a reader holding only one sees only that one, with no switch.
 */
function FantasyCurrentDataTab() {
  const perms = useAuthStore((s) => s.user?.permissions ?? []);
  const allowed = CURRENT_STOCK.filter((o) => perms.includes(o.permission));
  const [choice, setChoice] = useState<string>(allowed[0]?.id ?? "");
  const active = allowed.find((o) => o.id === choice) ?? allowed[0];
  if (!active) return null;
  const Active = active.component;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {allowed.length > 1 && (
        <div role="radiogroup" aria-label="Stock type" className="flex gap-1 px-3 pt-3 sm:px-4">
          {allowed.map((o) => (
            <button
              key={o.id}
              type="button"
              role="radio"
              aria-checked={o.id === active.id}
              onClick={() => setChoice(o.id)}
              className={cn(
                "rounded-md border px-3 py-1 text-xs font-medium",
                o.id === active.id ? "border-[#F97316] bg-[#FED7AA] text-[#7C2D12] dark:bg-[#272322] dark:text-[#FFEDD5]" : "border-border text-muted-foreground hover:bg-muted/60",
              )}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
      <Active />
    </div>
  );
}

export const FANTASY_DATA_TABS: HostTabItem[] = [
  { id: "current", label: "Current Data", icon: <Boxes className="h-3.5 w-3.5" />, permission: ["rough.read", "fantasy.read"], component: FantasyCurrentDataTab },
  { id: "integration", label: "Integration Status", icon: <RefreshCw className="h-3.5 w-3.5" />, permission: "fantasy.read", component: FantasySyncView },
  { id: "history", label: "Historical Data", icon: <HardDrive className="h-3.5 w-3.5" />, permission: "overall.read", component: OverallDataView },
];

export function FantasyDataView() {
  return (
    <TabbedHostView
      title="Fantasy Data"
      subtitle="Current stock, synchronization status and the permanent lot history"
      tabs={FANTASY_DATA_TABS}
      defaultTab="current"
      meta={<FantasySourceBadge />}
    />
  );
}
