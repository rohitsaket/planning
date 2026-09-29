"use client";

// Workbook Import: turn a Sarin CSV into the structured output workbook. One form and one
// Process File action; the server still uploads, checks, prepares and audits each step
// under its own permission (see sarin/sarin-processing.ts). Shape mappings are
// administered under Administration → Mappings → Sarin Shape Mapping.
//
// The page needs sarin.import.read. Every action has its own permission, mirrored on its
// control and enforced by its API.

import { useAuthStore } from "@/stores/auth-store";
import { PageHeader } from "@/components/diamond/shared/page-header";
import { SarinProcessCard, useSarinProcessing } from "./sarin/sarin-process-card";
import { SarinRecentFiles } from "./sarin/sarin-recent-files";
import { continueProcessing, rightsOf } from "./sarin/sarin-processing";

const NO_PERMISSIONS: string[] = [];

export function WorkbookImportView() {
  const permissions = useAuthStore((s) => s.user?.permissions ?? NO_PERMISSIONS);
  const rights = rightsOf(permissions);
  const processing = useSarinProcessing();

  return (
    <div className="flex flex-col gap-3 p-3">
      <PageHeader title="Workbook Import" subtitle="Prepare the structured output of a Sarin file" />
      <SarinProcessCard rights={rights} open={processing.open} stage={processing.stage} onRun={processing.run} onClose={() => processing.setOpen(null)} />
      <SarinRecentFiles
        rights={rights}
        selected={processing.open?.batchId ?? null}
        busy={processing.stage !== null}
        onOpen={(batchId) => processing.setOpen({ batchId, failure: null })}
        // Processes the file again against the shape mappings in effect now.
        onProcessAgain={(batchId) => {
          processing.setOpen({ batchId, failure: null });
          void processing.run((onStage) => continueProcessing(fetch, batchId, true, rights, onStage));
        }}
      />
    </div>
  );
}
