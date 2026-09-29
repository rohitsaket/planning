"use client";

import { useApi } from "@/lib/api-client";
import { useAuthStore } from "@/stores/auth-store";
import { FANTASY_SOURCE_STATE_LABELS, type FantasySourceStateSummary } from "@/lib/fantasy/source-state";

/**
 * Where the Fantasy data on a page comes from, taken from the central source state rather
 * than a fixed string, so a page can never claim a live ERP connection while fixture
 * simulation is running. Renders nothing for a reader who may not see the source state.
 */
export function FantasySourceBadge() {
  // Asked only of readers the source-state API admits, so no page makes a doomed request.
  const canRead = useAuthStore((s) => !!s.user?.permissions.includes("fantasy.read"));
  const { data } = useApi<{ sourceState: FantasySourceStateSummary }>(canRead ? "/api/fantasy/sync" : null);
  const sourceState = data?.sourceState;
  if (!sourceState) return null;
  const live = sourceState.effectiveState === "LIVE_FANTASY";
  return (
    <span
      className={
        live
          ? "inline-flex items-center gap-1 rounded border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-300"
          : "inline-flex items-center gap-1 rounded border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-300"
      }
      title={sourceState.statusExplanation}
    >
      Source: {FANTASY_SOURCE_STATE_LABELS[sourceState.effectiveState]}
    </span>
  );
}
