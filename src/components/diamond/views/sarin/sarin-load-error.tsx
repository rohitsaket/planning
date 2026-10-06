"use client";

import { RefreshCw } from "lucide-react";
import { InfoBanner } from "@/components/diamond/shared/empty-state";
import { Button } from "@/components/ui/button";

export function SarinLoadError({ what, error, retrying, onRetry }: { what: string; error: unknown; retrying: boolean; onRetry: () => void }) {
  return (
    <div role="alert">
      <InfoBanner variant="critical">
        <div className="flex flex-wrap items-center gap-2">
          <span>
            {what} could not be loaded. {error instanceof Error ? error.message : ""}
          </span>
          <Button size="sm" variant="outline" className="h-7" onClick={onRetry} disabled={retrying} aria-busy={retrying}>
            <RefreshCw className={retrying ? "mr-1 h-3 w-3 animate-spin" : "mr-1 h-3 w-3"} aria-hidden /> {retrying ? "Retrying…" : "Retry"}
          </Button>
        </div>
      </InfoBanner>
    </div>
  );
}
