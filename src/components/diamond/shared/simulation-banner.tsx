"use client";

import { FlaskConical } from "lucide-react";
import { InfoBanner } from "@/components/diamond/shared/empty-state";
import { Badge } from "@/components/diamond/shared/badges";
import type { SourceDisclosure } from "@/lib/analysis/source-disclosure";

/**
 * The simulation notice every Analysis page shows while it is displaying fixture data.
 *
 * One component, driven by `sourceDisclosure` from the API response. Views must not
 * reimplement this from a local flag: six of them previously carried their own copy of
 * the banner, and a single editing pass removed all six while a thousand simulated lots
 * were live in the database.
 *
 * Renders nothing when the source is live or not yet established — an empty page must not
 * claim to be simulated any more than it may claim to be live.
 */
export function SimulationBanner({ disclosure }: { disclosure?: SourceDisclosure | null }) {
  if (!disclosure?.simulated || !disclosure.bannerText) return null;
  return (
    <InfoBanner variant="warning">
      <span className="flex items-center gap-2 font-semibold">
        <FlaskConical className="h-4 w-4 shrink-0" />
        {disclosure.bannerText}
      </span>
    </InfoBanner>
  );
}

/**
 * The compact form, for a page header beside a title.
 *
 * Always renders once the source is established — including for live data — so the
 * absence of a badge never reads as "this is live".
 */
export function SourceBadge({ disclosure }: { disclosure?: SourceDisclosure | null }) {
  if (!disclosure || disclosure.mode === "NOT_ESTABLISHED") return null;
  return (
    <Badge variant={disclosure.simulated ? "warning" : "success"} className="gap-1 text-[10px]">
      {disclosure.simulated && <FlaskConical className="h-3 w-3" />}
      {disclosure.label}
    </Badge>
  );
}
