"use client";

// The result of processing one file, read back from the server: Output Ready, the issues
// that need correcting, or the one action that continues it. Continuing always resumes
// from what the server has stored (see sarin-processing.ts); nothing is repeated here.
// Each control mirrors its permission and the server enforces it again.

import { useState } from "react";
import { toast } from "sonner";
import { ChevronDown, Download, FileSpreadsheet, RefreshCw } from "lucide-react";
import { useApi } from "@/lib/api-client";
import { useAuthStore } from "@/stores/auth-store";
import { formatIST } from "@/lib/fantasy/time";
import { Badge } from "@/components/diamond/shared/badges";
import { InfoBanner } from "@/components/diamond/shared/empty-state";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { packetTypeLabel, packetTypeName } from "@/lib/domain/packet-type";
import { SarinLoadError } from "./sarin-load-error";
import { MappingsNotConfigured, MapShape, OpenMappings } from "./sarin-mapping-links";
import { SarinOutputPreview } from "./sarin-output-preview";
import {
  exportFailureMessage,
  importPath,
  outputPath,
  processingFailureMessage,
  resultView,
  sendRequest,
  SarinRequestError,
  type Finding,
  type ImportDetail,
  type OutputVersion,
  type Paged,
  type ProcessingRights,
  type ProcessingStage,
} from "./sarin-processing";

/** Downloads a file built on the server from one immutable output version. */
export function useOutputExport() {
  const [exporting, setExporting] = useState<"xlsx" | "csv" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async (batchId: string, versionId: string, format: "xlsx" | "csv") => {
    if (exporting) return;
    setExporting(format);
    setError(null);
    try {
      const res = await sendRequest(fetch, `${outputPath(batchId, versionId)}/${format === "xlsx" ? "workbook" : "export"}`);
      const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? `sarin-output.${format}`;
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(format === "xlsx" ? "Output exported" : "CSV exported");
    } catch (e) {
      const failure = e instanceof SarinRequestError ? e : new SarinRequestError(0, "UNEXPECTED", null);
      if (failure.status === 401) useAuthStore.getState().setUser(null);
      setError(exportFailureMessage(failure));
    } finally {
      setExporting(null);
    }
  };
  return { exporting, error, run };
}

interface Props {
  batchId: string;
  rights: ProcessingRights;
  /** The in-session failure that stopped processing this file, if any. */
  failure: { stage: ProcessingStage; error: SarinRequestError } | null;
  busy: boolean;
  /** Processes the file again against the shape mappings in effect now. */
  onProcessAgain: () => void;
  onProcessAnother: () => void;
}

export function SarinFileResult({ batchId, rights, failure, busy, onProcessAgain, onProcessAnother }: Props) {
  const detail = useApi<ImportDetail>(importPath(batchId));
  if (detail.isLoading) return <p className="text-[11px] text-muted-foreground" role="status">Loading file…</p>;
  if (detail.error || !detail.data) return <SarinLoadError what="This file" error={detail.error} retrying={detail.isFetching} onRetry={() => void detail.refetch()} />;
  const view = resultView(detail.data, rights);
  const { batch } = detail.data;
  const failureText = failure ? processingFailureMessage(failure.error) : null;
  const notConfigured = failure?.error.code === "MAPPINGS_NOT_CONFIGURED";
  const canContinue = batch.status === "VALIDATED" ? rights.generate : rights.validate;

  return (
    <div className="flex flex-col gap-3">
      {view.kind !== "ready" && (
        <p className="text-[11px] text-muted-foreground">
          <span className="font-medium text-foreground">{batch.sourceFile.fileName}</span> · {packetTypeLabel(batch.packetType)} · {batch.planningDate}
        </p>
      )}

      {view.kind === "ready" && <OutputReady batchId={batchId} outputId={view.outputId} advisories={view.advisories} fileName={batch.sourceFile.fileName} planningDate={batch.planningDate} rights={rights} busy={busy} onProcessAgain={onProcessAgain} onProcessAnother={onProcessAnother} />}

      {view.kind === "attention" && (
        <NeedsAttention batchId={batchId} blocking={view.blocking} rights={rights} busy={busy} onProcessAgain={onProcessAgain} onProcessAnother={onProcessAnother} />
      )}

      {view.kind === "reprocess" && (
        <Outcome title="This file needs to be processed again." onProcessAnother={onProcessAnother}>
          {rights.validate ? <ContinueButton label="Process Again" busy={busy} onClick={onProcessAgain} /> : <p className="text-[11px] text-muted-foreground">An authorized user needs to process it again.</p>}
        </Outcome>
      )}

      {(view.kind === "retry" || view.kind === "submitted") && (
        <Outcome title={view.kind === "retry" ? "The file was uploaded, but output could not be prepared." : "File submitted for processing"} detail={notConfigured ? null : failureText} onProcessAnother={onProcessAnother}>
          {notConfigured && <MappingsNotConfigured />}
          {canContinue ? (
            <ContinueButton label={view.kind === "retry" ? "Try Again" : "Process File"} busy={busy} onClick={onProcessAgain} />
          ) : (
            <p className="text-[11px] text-muted-foreground">An authorized user needs to process it.</p>
          )}
        </Outcome>
      )}

      {view.kind === "awaiting-output" && (
        <Outcome title="File checked" onProcessAnother={onProcessAnother}>
          <p className="text-[11px] text-muted-foreground">The output will be prepared by an authorized user.</p>
        </Outcome>
      )}

      {view.kind === "checking" && (
        <Outcome title="This file is being checked." onProcessAnother={onProcessAnother}>
          <Button size="sm" variant="outline" className="h-8 w-fit" onClick={() => void detail.refetch()} disabled={detail.isFetching}>
            <RefreshCw className="mr-1 h-3.5 w-3.5" aria-hidden /> Refresh
          </Button>
        </Outcome>
      )}

      {view.kind === "archived" && <Outcome title="This file is archived." onProcessAnother={onProcessAnother} />}
    </div>
  );
}

function Outcome({ title, detail, children, onProcessAnother }: { title: string; detail?: string | null; children?: React.ReactNode; onProcessAnother: () => void }) {
  return (
    <div className="flex flex-col gap-2" role="status">
      <h3 className="text-sm font-semibold">{title}</h3>
      {detail && <p className="text-[11px] text-rose-700 dark:text-rose-400">{detail}</p>}
      {children}
      <Button size="sm" variant="ghost" className="h-8 w-fit px-2 text-xs" onClick={onProcessAnother}>Process Another File</Button>
    </div>
  );
}

function ContinueButton({ label, busy, onClick }: { label: string; busy: boolean; onClick: () => void }) {
  return (
    <Button size="sm" className="h-8 w-fit" onClick={onClick} disabled={busy} aria-busy={busy}>
      <RefreshCw className="mr-1 h-3.5 w-3.5" aria-hidden /> {label}
    </Button>
  );
}

// ---------------------------------------------------------------------------------------
// Output Ready
// ---------------------------------------------------------------------------------------

function OutputReady(props: { batchId: string; outputId: string; advisories: number; fileName: string; planningDate: string; rights: ProcessingRights; busy: boolean; onProcessAgain: () => void; onProcessAnother: () => void }) {
  const { batchId, outputId, advisories, rights } = props;
  const output = useApi<{ version: OutputVersion; unmappedShapes: UnmappedShapes }>(outputPath(batchId, outputId));
  const exporter = useOutputExport();
  // The stored output is shown at once; the preview pages through it on the server.
  const [panel, setPanel] = useState<"preview" | "advisories" | null>("preview");
  const toggle = (p: "preview" | "advisories") => setPanel((cur) => (cur === p ? null : p));

  if (output.isLoading) return <p className="text-[11px] text-muted-foreground" role="status">Loading output…</p>;
  if (output.error || !output.data) return <SarinLoadError what="The output" error={output.error} retrying={output.isFetching} onRetry={() => void output.refetch()} />;
  const v = output.data.version;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2" role="status">
        <h3 className="text-sm font-semibold">{output.data.unmappedShapes.records > 0 ? "Output Ready with Warnings" : "Output Ready"}</h3>
        {advisories > 0 && (
          <button type="button" onClick={() => toggle("advisories")} aria-expanded={panel === "advisories"} className="rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <Badge variant="advisory">Output ready with {advisories} item{advisories === 1 ? "" : "s"} to review</Badge>
          </button>
        )}
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11px] sm:grid-cols-4">
        <Fact label="Source file">{props.fileName}</Fact>
        <Fact label="Packet type">{packetTypeName(v.packetType)}</Fact>
        <Fact label="Planning date">{props.planningDate}</Fact>
        <Fact label="Generated">{formatIST(v.generatedAt, false)}</Fact>
        <Fact label="Stones">{v.counts.stones.toLocaleString("en-IN")}</Fact>
        <Fact label="Options">{v.counts.options.toLocaleString("en-IN")}</Fact>
        <Fact label="Output rows">{v.counts.pieces.toLocaleString("en-IN")}</Fact>
        {advisories > 0 && <Fact label="Items to review">{advisories}</Fact>}
      </dl>
      <div className="flex flex-wrap items-center gap-2">
        {rights.export && (
          <Button size="sm" className="h-9" onClick={() => void exporter.run(batchId, v.id, "xlsx")} disabled={exporter.exporting !== null} aria-busy={exporter.exporting === "xlsx"}>
            <FileSpreadsheet className="mr-1 h-3.5 w-3.5" aria-hidden /> {exporter.exporting === "xlsx" ? "Exporting…" : "Export XLSX"}
          </Button>
        )}
        <Button size="sm" variant="outline" className="h-9" onClick={() => toggle("preview")} aria-expanded={panel === "preview"}>
          {panel === "preview" ? "Hide Preview" : "Preview Output"}
        </Button>
        <Button size="sm" variant="outline" className="h-9" onClick={props.onProcessAnother}>Process Another File</Button>
        {rights.export && (
          <Popover>
            <PopoverTrigger asChild>
              <Button size="sm" variant="ghost" className="h-9 px-2 text-xs" aria-label="More export options">
                More <ChevronDown className="ml-1 h-3 w-3" aria-hidden />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-44 p-1">
              <Button size="sm" variant="ghost" className="h-8 w-full justify-start text-xs" onClick={() => void exporter.run(batchId, v.id, "csv")} disabled={exporter.exporting !== null}>
                <Download className="mr-1 h-3.5 w-3.5" aria-hidden /> Export CSV
              </Button>
            </PopoverContent>
          </Popover>
        )}
      </div>
      {exporter.error && <div role="alert"><InfoBanner variant="critical">{exporter.error}</InfoBanner></div>}
      {output.data.unmappedShapes.records > 0 && <UnmappedShapesWarning batchId={batchId} outputId={v.id} warning={output.data.unmappedShapes} rights={rights} busy={props.busy} onProcessAgain={props.onProcessAgain} />}
      {panel === "advisories" && <AdvisoryList batchId={batchId} />}
      {panel === "preview" && <SarinOutputPreview batchId={batchId} versionId={v.id} />}
    </div>
  );
}

interface UnmappedShapes {
  shapes: Array<{ shape: string; records: number }>;
  records: number;
  partial: boolean;
}
interface AffectedRecord {
  outputRow: number;
  stoneName: string;
  sourceRowNumber: number;
  rawShape: string;
  option: { kind: string; mainOrdinal: number | null; additionalGroupOrdinal: number | null };
}
const AFFECTED_PAGE = 20;
const planLabel = (o: AffectedRecord["option"]) =>
  o.kind === "MAIN" ? `Main plan ${o.mainOrdinal ?? ""}`.trim() : o.kind === "ADDITIONAL" ? `Group ${o.additionalGroupOrdinal ?? ""}`.trim() : o.kind;

/**
 * Shapes the output shows as they appear in the Sarin file because no mapping is confirmed
 * for them: one line per shape with its record count, and the records behind an expander.
 */
function UnmappedShapesWarning({ batchId, outputId, warning, rights, busy, onProcessAgain }: { batchId: string; outputId: string; warning: UnmappedShapes; rights: ProcessingRights; busy: boolean; onProcessAgain: () => void }) {
  const [open, setOpen] = useState(false);
  const count = warning.shapes.length;
  return (
    <section aria-label="Shapes not mapped" className="flex flex-col gap-1.5 rounded-md border border-amber-300 bg-amber-50/60 p-2 text-[11px] dark:border-amber-900 dark:bg-amber-950/30">
      <p className="font-medium">{count === 1 ? "1 shape is not mapped" : `${count.toLocaleString("en-IN")} shapes are not mapped`}{warning.partial ? " (first shapes shown)" : ""}</p>
      <p className="text-muted-foreground">These records show the shape as it appears in the Sarin file.</p>
      <ul className="flex flex-wrap gap-2" aria-label="Unmapped shapes">
        {warning.shapes.map((s) => (
          <li key={s.shape} className="flex items-center gap-1.5 rounded border border-border bg-card px-2 py-1">
            <span className="font-mono">{s.shape}</span>
            <span className="text-muted-foreground">— {s.records.toLocaleString("en-IN")} {s.records === 1 ? "record" : "records"}</span>
            <MapShape shape={s.shape} />
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="ghost" className="h-7 w-fit px-2 text-xs" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {open ? "Hide affected records" : "View affected records"}
        </Button>
        <OpenMappings />
        {/* After a shape is mapped, processing again makes a new output version with it. */}
        {rights.validate && <ContinueButton label="Process Again" busy={busy} onClick={onProcessAgain} />}
      </div>
      {open && <AffectedRecords batchId={batchId} outputId={outputId} />}
    </section>
  );
}

function AffectedRecords({ batchId, outputId }: { batchId: string; outputId: string }) {
  const [page, setPage] = useState(1);
  const rows = useApi<Paged<AffectedRecord>>(`${outputPath(batchId, outputId)}/pieces?unmapped=true&pageSize=${AFFECTED_PAGE}&page=${page}`);
  if (rows.isLoading) return <p className="text-muted-foreground" role="status">Loading records…</p>;
  if (rows.error || !rows.data) return <InfoBanner variant="critical">The affected records could not be loaded.</InfoBanner>;
  const pages = Math.max(1, Math.ceil(rows.data.total / AFFECTED_PAGE));
  return (
    <div className="flex flex-col gap-1.5">
      <div className="overflow-x-auto rounded-md border border-border bg-card">
        <table className="w-full min-w-[520px] border-collapse text-xs" aria-label="Affected records">
          <thead className="border-b border-border bg-muted/60 text-[10px] uppercase tracking-wide text-muted-foreground">
            <tr>
              {["Stone", "CSV row", "Plan", "Sarin shape"].map((h) => (
                <th key={h} scope="col" className="px-2 py-1.5 text-left">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.data.rows.map((r) => (
              <tr key={r.outputRow} className="border-b border-border/40 tabular-nums last:border-0">
                <td className="px-2 py-1 font-mono">{r.stoneName}</td>
                <td className="px-2 py-1">{r.sourceRowNumber}</td>
                <td className="px-2 py-1">{planLabel(r.option)}</td>
                <td className="px-2 py-1 font-mono">{r.rawShape.trim()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <nav className="flex items-center gap-2" aria-label="Affected record pages">
          <Button size="sm" variant="outline" className="h-7" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
          <span className="tabular-nums">Page {page} of {pages}</span>
          <Button size="sm" variant="outline" className="h-7" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Next</Button>
        </nav>
      )}
    </div>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="break-words tabular-nums">{children}</dd>
    </div>
  );
}

const text = (v: unknown) => (typeof v === "string" || typeof v === "number" ? String(v) : "—");
const FINDING_PAGE = 20;

/** Non-blocking items of the current check, e.g. a Best Twin weight difference. */
export function AdvisoryList({ batchId }: { batchId: string }) {
  const [page, setPage] = useState(1);
  // Unmapped-shape warnings are summarised by shape in the result, not listed here row by row.
  const items = useApi<Paged<Finding>>(`${importPath(batchId)}/issues?blocking=false&exclude=SHAPE_NOT_MAPPED&pageSize=${FINDING_PAGE}&page=${page}`);
  if (items.isLoading) return <p className="text-[11px] text-muted-foreground" role="status">Loading items to review…</p>;
  if (items.error || !items.data) return <InfoBanner variant="critical">The items to review could not be loaded.</InfoBanner>;
  const pages = Math.max(1, Math.ceil(items.data.total / FINDING_PAGE));
  return (
    <section aria-label="Items to review" className="flex flex-col gap-1.5">
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full min-w-[560px] border-collapse text-xs">
          <thead className="border-b border-border bg-muted/60 text-[10px] uppercase tracking-wide text-muted-foreground">
            <tr>
              {["Stone", "Option", "First weight", "Second weight", "Difference", "Review"].map((h) => (
                <th key={h} scope="col" className="px-2 py-1.5 text-left">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.data.rows.map((f) => (
              <tr key={f.id} className="border-b border-border/40 tabular-nums last:border-0">
                <td className="px-2 py-1 font-mono">{f.block?.stoneName ?? "—"}</td>
                <td className="px-2 py-1">{f.details?.firstPosition !== undefined ? `Plans ${text(f.details.firstPosition)}–${text(f.details?.secondPosition)}` : f.title}</td>
                <td className="px-2 py-1">{text(f.details?.firstWeight)}</td>
                <td className="px-2 py-1">{text(f.details?.secondWeight)}</td>
                <td className="px-2 py-1">{text(f.details?.difference)}</td>
                <td className="px-2 py-1">{f.nextStep}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pager label="Items to review pages" page={page} pages={pages} onPage={setPage} />
    </section>
  );
}

// ---------------------------------------------------------------------------------------
// Output needs attention
// ---------------------------------------------------------------------------------------

function NeedsAttention(props: { batchId: string; blocking: number; rights: ProcessingRights; busy: boolean; onProcessAgain: () => void; onProcessAnother: () => void }) {
  const { rights } = props;
  return (
    <div className="flex flex-col gap-2" role="status">
      <h3 className="text-sm font-semibold">Output needs attention</h3>
      <p className="text-[11px] text-muted-foreground">
        {props.blocking === 1 ? "1 issue needs" : `${props.blocking.toLocaleString("en-IN")} issues need`} correcting before output can be prepared.
      </p>
      <FindingList batchId={props.batchId} />
      <div className="flex flex-wrap items-center gap-2">
        {rights.validate && <ContinueButton label="Process Again" busy={props.busy} onClick={props.onProcessAgain} />}
        <Button size="sm" variant="ghost" className="h-8 px-2 text-xs" onClick={props.onProcessAnother}>Process Another File</Button>
      </div>
    </div>
  );
}

function FindingList({ batchId }: { batchId: string }) {
  const [page, setPage] = useState(1);
  const findings = useApi<Paged<Finding>>(`${importPath(batchId)}/issues?blocking=true&pageSize=${FINDING_PAGE}&page=${page}`);
  if (findings.isLoading) return <p className="text-[11px] text-muted-foreground" role="status">Loading issues…</p>;
  if (findings.error || !findings.data) return <InfoBanner variant="critical">The issues could not be loaded.</InfoBanner>;
  const pages = Math.max(1, Math.ceil(findings.data.total / FINDING_PAGE));
  const unmappedShapes = [...new Set(findings.data.rows.map((f) => f.details?.rawShapeKey).filter((v): v is string => typeof v === "string"))];
  return (
    <section aria-label="Issues to correct" className="flex flex-col gap-1.5">
      {unmappedShapes.length > 0 && (
        <div className="flex flex-col gap-1.5 rounded-md border border-amber-300 bg-amber-50/60 p-2 text-[11px] dark:border-amber-900 dark:bg-amber-950/30" role="status">
          <p className="font-medium">Some shapes need mapping before output can be prepared.</p>
          <ul className="flex flex-wrap gap-2" aria-label="Shapes needing mapping">
            {unmappedShapes.map((shape) => (
              <li key={shape} className="flex items-center gap-1.5 rounded border border-border bg-card px-2 py-1">
                <span className="font-mono">{shape}</span>
                <MapShape shape={shape} />
              </li>
            ))}
          </ul>
          <div><OpenMappings /></div>
        </div>
      )}
      <ul className="flex max-h-[420px] flex-col gap-1 overflow-y-auto">
        {findings.data.rows.map((f) => {
          const shape = typeof f.details?.rawShapeKey === "string" ? f.details.rawShapeKey : null;
          return (
            <li key={f.id} className="rounded border border-border bg-card px-2 py-1.5 text-[11px]">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-medium">{f.title}</span>
                <span className="text-muted-foreground">
                  {f.block ? <span className="font-mono">{f.block.stoneName}</span> : "Whole file"}
                  {f.sourceRowNumber !== null ? ` · row ${f.sourceRowNumber}` : ""}
                  {shape ? ` · shape ${shape}` : ""}
                </span>
              </div>
              <p className="mt-0.5">{f.explanation}</p>
              <p className="mt-0.5 text-muted-foreground">
                <span className="font-medium text-foreground">What to do:</span> {f.nextStep}
              </p>
            </li>
          );
        })}
      </ul>
      <Pager label="Issue pages" page={page} pages={pages} onPage={setPage} />
    </section>
  );
}

function Pager({ label, page, pages, onPage }: { label: string; page: number; pages: number; onPage: (p: number) => void }) {
  if (pages <= 1) return null;
  return (
    <nav className="flex items-center gap-2 text-[11px]" aria-label={label}>
      <Button size="sm" variant="outline" className="h-7" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</Button>
      <span className="tabular-nums">Page {page} of {pages}</span>
      <Button size="sm" variant="outline" className="h-7" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</Button>
    </nav>
  );
}
