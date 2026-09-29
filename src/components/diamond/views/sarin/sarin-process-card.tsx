"use client";

// Prepare Sarin Output: choose a Sarin CSV and its details, click Process File, and get
// either the issues to correct or the finished output. The form's checks only help before
// a round trip; the server repeats every one of them. Who uploads, what they may see and
// what they may do always come from the session on the server.

import { useId, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useApi } from "@/lib/api-client";
import { useAuthStore } from "@/stores/auth-store";
import { getISTDateString } from "@/lib/fantasy/time";
import { PACKET_TYPE_DOT, packetTypeLabel } from "@/lib/domain/packet-type";
import { SARIN_PACKET_TYPES } from "@/lib/sarin/domain";
import { cn } from "@/lib/utils";
import { Section } from "@/components/diamond/shared/page-header";
import { InfoBanner } from "@/components/diamond/shared/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SarinFileResult } from "./sarin-file-result";
import { MappingsNotConfigured } from "./sarin-mapping-links";
import {
  continueProcessing,
  processFile,
  STAGE_LABEL,
  uploadFailureMessage,
  type ProcessingResult,
  type ProcessingRights,
  type ProcessingStage,
  type UploadConstraints,
} from "./sarin-processing";

const STAGE_PROGRESS: Record<ProcessingStage, number> = { uploading: 20, checking: 55, preparing: 85 };

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** The file shown in the card's result area, and how it got there in this session. */
export interface OpenFile {
  batchId: string;
  failure: ProcessingResult["failure"];
}

interface Props {
  rights: ProcessingRights;
  open: OpenFile | null;
  stage: ProcessingStage | null;
  onRun: (run: (onStage: (stage: ProcessingStage) => void) => Promise<ProcessingResult>) => Promise<ProcessingResult | null>;
  onClose: () => void;
}

export function SarinProcessCard({ rights, open, stage, onRun, onClose }: Props) {
  const busy = stage !== null;
  return (
    <Section title="Prepare Sarin Output" bodyClassName="p-4">
      <div className="flex flex-col gap-3">
        {open ? (
          <SarinFileResult
            key={open.batchId}
            batchId={open.batchId}
            rights={rights}
            failure={open.failure}
            busy={busy}
            onProcessAgain={() => void onRun((onStage) => continueProcessing(fetch, open.batchId, true, rights, onStage))}
            onProcessAnother={onClose}
          />
        ) : rights.upload ? (
          <ProcessForm rights={rights} busy={busy} onRun={onRun} />
        ) : (
          <p className="text-[11px] text-muted-foreground">Open a file from Recent Files to see its output.</p>
        )}
        {stage && (
          <div role="status" aria-live="polite" className="flex flex-col gap-1">
            <Progress value={STAGE_PROGRESS[stage]} aria-label="Processing progress" className="h-1.5" />
            <span className="text-[11px] text-muted-foreground">{STAGE_LABEL[stage]}…</span>
          </div>
        )}
      </div>
    </Section>
  );
}

function ProcessForm({ rights, busy, onRun }: { rights: ProcessingRights; busy: boolean; onRun: Props["onRun"] }) {
  const ids = useId();
  // A user limited to particular labs must declare one; the server refuses an import without.
  const labRequired = useAuthStore((s) => (s.user?.accessScope?.labs ?? null) !== null);
  const settings = useApi<{ upload: UploadConstraints | null; mappingsConfigured: boolean }>("/api/planning/sarin/imports?pageSize=1");
  const constraints = settings.data?.upload ?? null;

  const fileInput = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [packetType, setPacketType] = useState("");
  const [lab, setLab] = useState("");
  const [planningDate, setPlanningDate] = useState(getISTDateString(new Date()));
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Assistance only: the server checks the extension, the size and the content again.
  const fileProblem = !file || !constraints
    ? null
    : !file.name.toLowerCase().endsWith(constraints.acceptedExtension)
      ? "The file format is not supported."
      : file.size === 0
        ? "The file is empty."
        : file.size > constraints.maxFileBytes
          ? "The file is too large."
          : null;
  // Processing uses the shape mappings in effect; with none configured it cannot check the file.
  const noMappings = rights.validate && settings.data?.mappingsConfigured === false;
  const labs = constraints?.labs ?? [];
  const labChosen = lab !== "" && labs.includes(lab);
  const ready = !!file && !!constraints && !fileProblem && !!packetType && (labChosen || !labRequired) && /^\d{4}-\d{2}-\d{2}$/.test(planningDate) && !noMappings;

  const submit = async () => {
    if (!ready || busy || !file) return;
    setUploadError(null);
    const result = await onRun((onStage) => processFile(fetch, file, { packetType, labId: labChosen ? lab : null, planningDate }, rights, onStage));
    if (result && result.batchId === null && result.failure) setUploadError(uploadFailureMessage(result.failure.error, constraints));
  };

  if (settings.isLoading) return <p className="text-[11px] text-muted-foreground" role="status">Loading…</p>;
  if (!constraints) return <InfoBanner variant="warning">File processing is not available right now. Reload the page to try again.</InfoBanner>;
  return (
    <form
      className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="flex flex-col gap-1 sm:col-span-2">
        <Label htmlFor={`${ids}-file`} className="text-xs">Sarin CSV file</Label>
        <Input
          id={`${ids}-file`}
          ref={fileInput}
          type="file"
          accept={constraints.acceptedExtension}
          disabled={busy}
          onChange={(e) => {
            setUploadError(null);
            setFile(e.target.files?.[0] ?? null);
          }}
          aria-invalid={!!fileProblem}
          aria-describedby={`${ids}-file-help`}
          className="h-9 text-xs"
        />
        <p id={`${ids}-file-help`} className="text-[11px] text-muted-foreground" aria-live="polite">
          {fileProblem ? <span className="text-rose-700 dark:text-rose-400">{fileProblem}</span> : `CSV without a header · Maximum ${formatBytes(constraints.maxFileBytes)}`}
        </p>
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor={`${ids}-type`} className="text-xs">Packet type</Label>
        <Select value={packetType} onValueChange={setPacketType} disabled={busy}>
          <SelectTrigger id={`${ids}-type`} className="h-9 text-xs" aria-label="Packet type"><SelectValue placeholder="Choose" /></SelectTrigger>
          <SelectContent>
            {SARIN_PACKET_TYPES.map((t) => (
              <SelectItem key={t} value={t} className="text-xs">
                <span className={cn("mr-1.5 inline-block h-2 w-2 shrink-0 rounded-full align-middle", PACKET_TYPE_DOT[t])} aria-hidden />
                {packetTypeLabel(t)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor={`${ids}-date`} className="text-xs">Planning date</Label>
        <Input id={`${ids}-date`} type="date" value={planningDate} disabled={busy} className="h-9 text-xs" onChange={(e) => setPlanningDate(e.target.value)} />
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor={`${ids}-lab`} className="text-xs">{labRequired ? "Lab" : "Lab (optional)"}</Label>
        <Select value={labChosen ? lab : labRequired ? "" : "__none"} onValueChange={(v) => setLab(v === "__none" ? "" : v)} disabled={busy}>
          <SelectTrigger id={`${ids}-lab`} className="h-9 text-xs" aria-label="Lab"><SelectValue placeholder="Choose" /></SelectTrigger>
          <SelectContent>
            {!labRequired && <SelectItem value="__none" className="text-xs">No lab</SelectItem>}
            {labs.map((l) => <SelectItem key={l} value={l} className="text-xs">{l}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {noMappings && (
        <div className="sm:col-span-2 lg:col-span-4">
          <MappingsNotConfigured />
        </div>
      )}

      <div className="flex flex-wrap items-end gap-3 sm:col-span-2 lg:col-span-4">
        <Button type="submit" className="h-9 px-5" disabled={!ready || busy} aria-busy={busy}>
          {busy ? "Processing…" : "Process File"}
        </Button>
        {uploadError && (
          <p role="alert" className="text-[11px] text-rose-700 dark:text-rose-400">{uploadError}</p>
        )}
      </div>
    </form>
  );
}

/** One processing run at a time; the result is always re-read from the server afterwards. */
export function useSarinProcessing() {
  const queryClient = useQueryClient();
  const [stage, setStage] = useState<ProcessingStage | null>(null);
  const [open, setOpen] = useState<OpenFile | null>(null);
  const running = useRef(false);

  const run: Props["onRun"] = async (task) => {
    // Guards against a double click before the disabled state renders.
    if (running.current) return null;
    running.current = true;
    try {
      const result = await task(setStage);
      if (result.failure?.error.status === 401) useAuthStore.getState().setUser(null);
      if (result.batchId) setOpen({ batchId: result.batchId, failure: result.failure });
      return result;
    } finally {
      running.current = false;
      setStage(null);
      await queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("/api/planning/sarin/") });
    }
  };
  return { stage, open, setOpen, run };
}
