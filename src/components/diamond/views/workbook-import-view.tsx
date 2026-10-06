"use client";

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
    <div data-page-body className="flex flex-col gap-section px-page-x py-page-y">
      <PageHeader title="Workbook Import" subtitle="Prepare the structured output of a Sarin file" />
      <SarinProcessCard rights={rights} open={processing.open} stage={processing.stage} onRun={processing.run} onClose={() => processing.setOpen(null)} />
      <SarinRecentFiles
        rights={rights}
        selected={processing.open?.batchId ?? null}
        busy={processing.stage !== null}
        onOpen={(batchId) => processing.setOpen({ batchId, failure: null })}
        onProcessAgain={(batchId) => {
          processing.setOpen({ batchId, failure: null });
          void processing.run((onStage) => continueProcessing(fetch, batchId, true, rights, onStage));
        }}
      />
    </div>
  );
}
