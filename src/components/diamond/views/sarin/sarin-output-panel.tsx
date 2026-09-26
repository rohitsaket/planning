"use client";

// Sarin structured output inside the Workbook Import workflow: pick an import, see its
// validation state and findings, validate it against an approved mapping set, generate its
// structured output, and preview the stored plan options and pieces.
//
// Every value shown is the server's stored value (weights already at three decimals, the
// yield already rounded for display). Controls mirror the server permissions; the server
// enforces them regardless.

import { Fragment, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronDown, ChevronRight, Gem, Layers, ShieldCheck } from "lucide-react";
import { apiPost, useApi } from "@/lib/api-client";
import { useAuthStore } from "@/stores/auth-store";
import { Section } from "@/components/diamond/shared/page-header";
import { Badge, Pill } from "@/components/diamond/shared/badges";
import { EmptyState, InfoBanner } from "@/components/diamond/shared/empty-state";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

// ---- server contracts (the fields this panel reads) ------------------------------------------
interface Paged<T> { rows: T[]; total: number; hasMore: boolean }
interface ImportSummary {
  id: string;
  status: string;
  stoneType: string;
  planningDate: string;
  country: string;
  sourceFile: { fileName: string };
  counts: { records: number };
}
interface ValidationSummary {
  lastCompletedAttempt: null | { number: number; result: string | null; mappingSet: { version: number; status: string }; issues: { total: number | null; blocking: number | null } };
  latestAttempt: null | { status: string };
}
interface Finding { id: string; title: string; explanation: string; blocking: boolean; severity: string; sourceRowNumber: number | null; block: { sequence: number; stoneName: string } | null }
interface ApprovedSet { id: string; version: number }
interface OutputVersion { id: string; versionNumber: number; status: string; isCurrent: boolean; stoneType: string; validationAttempt: number; mappingSet: { version: number }; generatedAt: string; counts: { stones: number; options: number; pieces: number } }
interface OutputStone { sequence: number; stoneName: string; kapan: string | null; packet: string | null; signer: string | null; roughWeight: string | null; options: number; pieces: number }
interface OutputOption {
  id: string;
  optionSequence: number;
  kind: string;
  pieceCount: number;
  totalEstimatedWeight: string;
  yield: { display: string };
  pairWeightDifference: string | null;
  advisory: string | null;
}
interface OutputPiece { outputRow: number; option: { id: string }; pieceSequence: number; sourceRowNumber: number; rawShape: string; normalizedShape: string; estimatedWeight: string; clarity: string; color: string }

// ---- business labels --------------------------------------------------------------------------
const STATUS_LABEL: Record<string, { label: string; variant: "success" | "warning" | "critical" | "info" | "neutral" }> = {
  UPLOADED: { label: "Not validated yet", variant: "neutral" },
  VALIDATING: { label: "Validating", variant: "info" },
  NEEDS_REVIEW: { label: "Needs review", variant: "warning" },
  VALIDATED: { label: "Validated", variant: "success" },
  FAILED: { label: "Validation did not complete", variant: "critical" },
  ARCHIVED: { label: "Archived", variant: "neutral" },
};
const PLAN_LABEL: Record<string, string> = {
  MAIN: "Main plan",
  ADDITIONAL: "Additional group",
  MK: "MK · Makeable",
  SL: "SL · Solace",
  BP: "BP · Best Pair",
  BT: "BT · Best Twin",
};
const STONE_TYPE_VARIANT: Record<string, "info" | "default" | "advisory"> = { BLUE: "info", WHITE: "default", PINK: "advisory" };

const base = (batchId: string) => `/api/planning/sarin/imports/${encodeURIComponent(batchId)}`;

export function SarinOutputPanel() {
  const permissions = useAuthStore((s) => s.user?.permissions ?? []);
  const canRead = permissions.includes("sarin.import.read");
  const [batchId, setBatchId] = useState<string | null>(null);
  const imports = useApi<Paged<ImportSummary>>(canRead ? "/api/planning/sarin/imports?pageSize=25" : null);
  if (!canRead) return null;

  return (
    <Section title="Sarin Structured Output" description="Validated Sarin imports and the plan options they produce" bodyClassName="p-3">
      <div className="flex flex-col gap-3">
        {imports.isLoading ? (
          <p className="text-[11px] text-muted-foreground">Loading imports…</p>
        ) : imports.error ? (
          <InfoBanner variant="critical">Imports could not be loaded. {(imports.error as Error).message}</InfoBanner>
        ) : !imports.data?.rows.length ? (
          <EmptyState title="No Sarin imports yet" message="Imports you are allowed to see will appear here." />
        ) : (
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full text-xs border-collapse">
              <thead className="bg-muted/60 border-b border-border text-[10px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-2 py-1.5 text-left">File</th>
                  <th className="px-2 py-1.5 text-left">Stone type</th>
                  <th className="px-2 py-1.5 text-left">Planning date</th>
                  <th className="px-2 py-1.5 text-left">Country</th>
                  <th className="px-2 py-1.5 text-right">Records</th>
                  <th className="px-2 py-1.5 text-left">Status</th>
                </tr>
              </thead>
              <tbody>
                {imports.data.rows.map((b) => (
                  <tr
                    key={b.id}
                    onClick={() => setBatchId(b.id)}
                    className={cn("border-b border-border/40 last:border-0 cursor-pointer hover:bg-muted/40", batchId === b.id && "bg-muted/60")}
                  >
                    <td className="px-2 py-1.5">{b.sourceFile.fileName}</td>
                    <td className="px-2 py-1.5"><Badge variant={STONE_TYPE_VARIANT[b.stoneType] ?? "default"}>{b.stoneType}</Badge></td>
                    <td className="px-2 py-1.5 tabular-nums">{b.planningDate}</td>
                    <td className="px-2 py-1.5">{b.country}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{b.counts.records}</td>
                    <td className="px-2 py-1.5"><StatusPill status={b.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {batchId && <ImportDetail key={batchId} batchId={batchId} />}
      </div>
    </Section>
  );
}

function StatusPill({ status }: { status: string }) {
  const s = STATUS_LABEL[status] ?? { label: status, variant: "neutral" as const };
  return <Badge variant={s.variant}>{s.label}</Badge>;
}

function ImportDetail({ batchId }: { batchId: string }) {
  const permissions = useAuthStore((s) => s.user?.permissions ?? []);
  const canValidate = permissions.includes("sarin.import.validate");
  const canGenerate = permissions.includes("sarin.output.generate");
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("/api/planning/sarin/") });

  const detail = useApi<{ batch: ImportSummary; validation: ValidationSummary }>(base(batchId));
  const findings = useApi<Paged<Finding>>(`${base(batchId)}/issues?pageSize=100`);
  const outputs = useApi<Paged<OutputVersion>>(`${base(batchId)}/outputs?pageSize=10`);
  const sets = useApi<Paged<ApprovedSet>>(canValidate ? "/api/planning/sarin/mapping-sets/approved?pageSize=100" : null);
  const [setId, setSetId] = useState<string>("");
  const [busy, setBusy] = useState(false);

  const act = async (label: string, run: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await run();
      toast.success(label);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
      await refresh();
    }
  };

  if (detail.isLoading) return <p className="text-[11px] text-muted-foreground">Loading import…</p>;
  if (!detail.data) return <InfoBanner variant="critical">This import could not be loaded.</InfoBanner>;
  const { batch, validation } = detail.data;
  const last = validation.lastCompletedAttempt;
  const blocking = last?.issues.blocking ?? 0;
  const advisories = (last?.issues.total ?? 0) - blocking;
  const current = outputs.data?.rows.find((v) => v.isCurrent) ?? null;

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border p-3">
      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        <span className="font-medium">{batch.sourceFile.fileName}</span>
        <Badge variant={STONE_TYPE_VARIANT[batch.stoneType] ?? "default"}>{batch.stoneType}</Badge>
        <StatusPill status={batch.status} />
        {last ? (
          <>
            <Pill>Validation {last.number} · mapping set v{last.mappingSet.version}</Pill>
            <Badge variant={blocking ? "warning" : "success"}>{blocking ? `${blocking} blocking finding${blocking === 1 ? "" : "s"}` : "No blocking findings"}</Badge>
            {advisories > 0 && <Badge variant="advisory">{advisories} advisor{advisories === 1 ? "y" : "ies"}</Badge>}
          </>
        ) : (
          <Pill>Not validated yet</Pill>
        )}
      </div>

      {(canValidate || canGenerate) && (
        <div className="flex flex-wrap items-center gap-2">
          {canValidate && (
            <>
              <Select value={setId} onValueChange={setSetId}>
                <SelectTrigger className="h-8 w-[220px] text-xs"><SelectValue placeholder="Approved mapping set" /></SelectTrigger>
                <SelectContent>
                  {(sets.data?.rows ?? []).map((s) => (
                    <SelectItem key={s.id} value={s.id} className="text-xs">Mapping set v{s.version}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button size="sm" variant="outline" className="h-8" disabled={!setId || busy || batch.status === "ARCHIVED"} onClick={() => act("Validation finished", () => apiPost(`${base(batchId)}/validate`, { mappingSetId: setId }))}>
                <ShieldCheck className="h-3.5 w-3.5 mr-1" /> Validate
              </Button>
            </>
          )}
          {canGenerate && (
            <Button size="sm" className="h-8" disabled={busy || batch.status !== "VALIDATED"} onClick={() => act("Structured output ready", () => apiPost(`${base(batchId)}/outputs`, {}))}>
              <Layers className="h-3.5 w-3.5 mr-1" /> Generate structured output
            </Button>
          )}
          {canGenerate && batch.status !== "VALIDATED" && <span className="text-[10px] text-muted-foreground">Output can be generated once the import is validated without blocking findings.</span>}
        </div>
      )}

      {!!findings.data?.rows.length && (
        <div className="flex flex-col gap-1">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Findings {findings.data.hasMore ? `(first ${findings.data.rows.length} of ${findings.data.total})` : `(${findings.data.total})`}
          </div>
          <div className="flex max-h-[260px] flex-col gap-1 overflow-y-auto">
            {findings.data.rows.map((f) => (
              <div key={f.id} className="flex items-start gap-2 rounded border border-border bg-card px-2 py-1.5 text-[11px]">
                <Badge variant={f.blocking ? "critical" : "advisory"}>{f.blocking ? "Blocking" : "Advisory"}</Badge>
                <span className="shrink-0 text-muted-foreground tabular-nums">
                  {f.block ? `Stone ${f.block.sequence}` : "Import"}
                  {f.sourceRowNumber !== null ? ` · record ${f.sourceRowNumber}` : ""}
                </span>
                <span><span className="font-medium">{f.title}.</span> {f.explanation}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {current ? (
        <OutputPreview batchId={batchId} version={current} />
      ) : (
        <EmptyState title="No structured output yet" message={batch.status === "VALIDATED" ? "Generate the structured output to preview its plans." : "The import must be validated first."} />
      )}
    </div>
  );
}

function OutputPreview({ batchId, version }: { batchId: string; version: OutputVersion }) {
  const stones = useApi<Paged<OutputStone>>(`${base(batchId)}/outputs/${version.id}/stones?pageSize=100`);
  const [stoneSequence, setStoneSequence] = useState<number | null>(null);
  const selected = stoneSequence ?? stones.data?.rows[0]?.sequence ?? null;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        <span className="font-semibold">Output version {version.versionNumber}</span>
        <Pill>{version.counts.stones} stone{version.counts.stones === 1 ? "" : "s"}</Pill>
        <Pill>{version.counts.options} plan options</Pill>
        <Pill>{version.counts.pieces} pieces</Pill>
        <Pill>From validation {version.validationAttempt} · mapping set v{version.mappingSet.version}</Pill>
        <span className="text-muted-foreground">Generated {new Date(version.generatedAt).toLocaleString()}</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {(stones.data?.rows ?? []).map((s) => (
          <button
            key={s.sequence}
            type="button"
            onClick={() => setStoneSequence(s.sequence)}
            className={cn("rounded-md border px-2 py-1 text-[11px] text-left", selected === s.sequence ? "border-primary bg-primary/10" : "border-border hover:bg-muted/40")}
          >
            <div className="font-mono">{s.stoneName}</div>
            <div className="text-[10px] text-muted-foreground">
              Kapan {s.kapan ?? "—"} · Packet {s.packet ?? "—"} · Signer {s.signer ?? "—"} · <Gem className="inline h-2.5 w-2.5" /> {s.roughWeight ?? "—"} ct · {s.options} options
            </div>
          </button>
        ))}
        {stones.data?.hasMore && <span className="text-[10px] text-muted-foreground self-center">Showing the first {stones.data.rows.length} of {stones.data.total} stones.</span>}
      </div>
      {selected !== null && <StoneOptions batchId={batchId} versionId={version.id} stoneSequence={selected} />}
    </div>
  );
}

function StoneOptions({ batchId, versionId, stoneSequence }: { batchId: string; versionId: string; stoneSequence: number }) {
  const options = useApi<Paged<OutputOption>>(`${base(batchId)}/outputs/${versionId}/options?stone=${stoneSequence}&pageSize=500`);
  const pieces = useApi<Paged<OutputPiece>>(`${base(batchId)}/outputs/${versionId}/pieces?stone=${stoneSequence}&pageSize=500`);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (id: string) => setOpen((s) => {
    const next = new Set(s);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });

  if (options.isLoading) return <p className="text-[11px] text-muted-foreground">Loading plans…</p>;
  const rows = options.data?.rows ?? [];
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full text-xs border-collapse min-w-[720px]">
        <thead className="bg-muted/60 border-b border-border text-[10px] uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-2 py-1.5 w-6" />
            <th className="px-2 py-1.5 text-right">#</th>
            <th className="px-2 py-1.5 text-left">Plan</th>
            <th className="px-2 py-1.5 text-right">Pieces</th>
            <th className="px-2 py-1.5 text-right">Total est. weight (ct)</th>
            <th className="px-2 py-1.5 text-right">Yield</th>
            <th className="px-2 py-1.5 text-left">Notes</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((o) => (
            <Fragment key={o.id}>
              <tr className="border-b border-border/40 cursor-pointer hover:bg-muted/40" onClick={() => toggle(o.id)}>
                <td className="px-2 py-1.5">{open.has(o.id) ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{o.optionSequence}</td>
                <td className="px-2 py-1.5"><Badge variant={o.kind === "MAIN" || o.kind === "MK" ? "success" : "info"}>{PLAN_LABEL[o.kind] ?? o.kind}</Badge></td>
                <td className="px-2 py-1.5 text-right tabular-nums">{o.pieceCount}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{o.totalEstimatedWeight}</td>
                <td className="px-2 py-1.5 text-right tabular-nums font-medium">{o.yield.display}%</td>
                <td className="px-2 py-1.5 text-[11px]">
                  {o.advisory === "BT_WEIGHT_VARIANCE_UNCONFIRMED" ? (
                    <Badge variant="advisory">Twin weights differ by {o.pairWeightDifference} ct · no tolerance confirmed</Badge>
                  ) : o.kind === "BT" ? (
                    <span className="text-muted-foreground">Twin weights equal</span>
                  ) : null}
                </td>
              </tr>
              {open.has(o.id) &&
                (pieces.data?.rows ?? [])
                  .filter((p) => p.option.id === o.id)
                  .map((p) => (
                    <tr key={p.outputRow} className="border-b border-border/30 bg-muted/20 text-[11px]">
                      <td />
                      <td className="px-2 py-1 text-right text-muted-foreground tabular-nums">{p.pieceSequence}</td>
                      <td className="px-2 py-1">
                        <span className="font-mono text-[10px]">{p.rawShape}</span>
                        <ChevronRight className="inline h-2.5 w-2.5 mx-1 text-muted-foreground/60" />
                        <Badge variant="info">{p.normalizedShape}</Badge>
                      </td>
                      <td className="px-2 py-1 text-right text-muted-foreground tabular-nums">record {p.sourceRowNumber}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{p.estimatedWeight}</td>
                      <td className="px-2 py-1 text-right text-muted-foreground" colSpan={2}>{p.clarity} · {p.color}</td>
                    </tr>
                  ))}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
