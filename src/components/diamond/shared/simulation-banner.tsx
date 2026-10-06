"use client";

import { FlaskConical } from "lucide-react";
import { InfoBanner } from "@/components/diamond/shared/empty-state";
import { Badge } from "@/components/diamond/shared/badges";
import type { SourceDisclosure } from "@/lib/analysis/source-disclosure";

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

export function SourceBadge({ disclosure }: { disclosure?: SourceDisclosure | null }) {
  if (!disclosure || disclosure.mode === "NOT_ESTABLISHED") return null;
  return (
    <Badge variant={disclosure.simulated ? "warning" : "success"} className="gap-1 text-[10px]">
      {disclosure.simulated && <FlaskConical className="h-3 w-3" />}
      {disclosure.label}
    </Badge>
  );
}
