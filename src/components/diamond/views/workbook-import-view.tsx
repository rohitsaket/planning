"use client";

import { useMemo, useRef, useState } from "react";
import { useApi } from "@/lib/api-client";
import { PageHeader, Section } from "@/components/diamond/shared/page-header";
import { Badge, Pill, StatusBadge } from "@/components/diamond/shared/badges";
import { EmptyState, InfoBanner } from "@/components/diamond/shared/empty-state";
import { DataTable, type Column } from "@/components/diamond/shared/data-table";
import { KpiCard } from "@/components/diamond/shared/kpi-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import { formatEstWeight, formatYield } from "@/lib/domain/diamond-rules";
import { cn } from "@/lib/utils";
import {
  FileSpreadsheet,
  ShieldCheck,
  Upload,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Sparkles,
  Download,
  ListTree,
  Boxes,
  History,
  Columns,
  ChevronDown,
  ChevronRight,
  Trophy,
  Gem,
  Layers,
  ShieldAlert,
} from "lucide-react";

// ---------------------------------------------------------------------------
// TYPES — mirror the server-side workbook-parser contract
// ---------------------------------------------------------------------------
interface ShapeMappingRow {
  id: string;
  rawShape: string;
  normalizedShape: string;
  category: string;
  active: boolean;
}

interface ParsedStoneName {
  kapan: string;
  packet: string;
  signer: string;
  unresolved: string;
  stoneType: "BLUE" | "WHITE" | "UNKNOWN";
}

interface WorkbookRow {
  rowIndex: number;
  stoneName: string;
  roughCut: string;
  shapeRaw: string;
  shapeNormalized: string;
  shapeKnown: boolean;
  polishWeight: number;
  clarity: string;
  color: string;
  totalDepthPct: number | null;
  ratio: number | null;
  length: number | null;
  width: number | null;
  totalDepthMm: number | null;
  yieldPct: number;
  emeraldIssue?: string;
  extraColumns: number;
}

interface PlanGroup {
  groupIndex: number;
  planNumber: number;
  isAdditional: boolean;
  isMainPlan: boolean;
  rows: WorkbookRow[];
  combinedYieldPct: number;
  topRank: number | null;
}

interface StoneNameBlock {
  stoneName: string;
  parsed: ParsedStoneName;
  roughWeight: number;
  rows: WorkbookRow[];
  planGroups: PlanGroup[];
  blueMainLimit: number;
  whiteMainLimit: number;
  validationWarnings: string[];
}

interface ValidationIssue {
  severity: "INFO" | "WARNING" | "ERROR" | "BLOCKING";
  row: number;
  message: string;
}

interface TopYield {
  stoneName: string;
  planNumber: number;
  yieldPct: number;
  rank: number;
}

interface WorkbookParseResult {
  fileName: string;
  fileSize: number;
  parsedAt: string;
  totalRows: number;
  blocks: StoneNameBlock[];
  validationIssues: ValidationIssue[];
  stoneNameCount: number;
  unknownShapes: string[];
  topThreeYields: TopYield[];
  legacyHeaderDetected: boolean;
  extraColumnsCount: number;
  parseErrors: string[];
}

// ---------------------------------------------------------------------------
// CONSTANTS
// ---------------------------------------------------------------------------
const COLUMNS = [
  "STONE.Name",
  "RESULT.1.Rough Cut",
  "RESULT.1.ShapeName",
  "Result.1.PolishWeight",
  "RESULT.CUR.Clarity",
  "RESULT.CUR.COLOR",
  "RESULT.CUR.TotalDepth_%",
  "RESULT.CUR.Ratio",
  "RESULT.CUR.Length",
  "RESULT.CUR.Width",
  "RESULT.CUR.TotalDepth_mm",
];

// Spec §42: fixed sequence of 10 light pastel shades for additional plan group rows.
// Sequence restarts per stone name block.
const PASTEL_BG_SEQUENCE = [
  "bg-rose-50 dark:bg-rose-950/30",
  "bg-amber-50 dark:bg-amber-950/30",
  "bg-emerald-50 dark:bg-emerald-950/30",
  "bg-sky-50 dark:bg-sky-950/30",
  "bg-violet-50 dark:bg-violet-950/30",
  "bg-cyan-50 dark:bg-cyan-950/30",
  "bg-pink-50 dark:bg-pink-950/30",
  "bg-lime-50 dark:bg-lime-950/30",
  "bg-orange-50 dark:bg-orange-950/30",
  "bg-teal-50 dark:bg-teal-950/30",
];

// Sample workbook for download — covers BLUE/WHITE/unresolved/unknown-shape/EMERALD
const SAMPLE_WORKBOOK_ROWS: (string | number)[][] = [
  // Legacy header row (parser detects + skips)
  [
    "STONE.Name", "RESULT.1.Rough Cut", "RESULT.1.ShapeName", "Result.1.PolishWeight",
    "RESULT.CUR.Clarity", "RESULT.CUR.COLOR", "RESULT.CUR.TotalDepth_%", "RESULT.CUR.Ratio",
    "RESULT.CUR.Length", "RESULT.CUR.Width", "RESULT.CUR.TotalDepth_mm",
  ],
  // BLUE stone block 1 — 4 rows, various shapes (incl. EMERALD 5STEP)
  ["670D-764_E+pv", "15.500", "ROUND", "1.5", "VS1", "F", "61.2", "1.05", "5.10", "4.90", "3.10"],
  ["670D-764_E+pv", "15.500", "OVAL", "1.4", "VS2", "G", "62.0", "1.30", "5.80", "4.50", "3.60"],
  ["670D-764_E+pv", "15.500", "PEAR", "1.2", "SI1", "H", "61.5", "1.50", "5.50", "3.70", "2.30"],
  ["670D-764_E+pv", "15.500", "EMERALD 5STEP", "1.0", "VS1", "E", "68.5", "1.45", "5.20", "3.60", "2.50"],
  // WHITE stone block 2 — 3 rows, ROUND
  ["2501-001 HA", "12.200", "ROUND", "1.1", "VVS1", "F", "60.5", "1.02", "4.80", "4.70", "2.85"],
  ["2501-001 HA", "12.200", "ROUND", "1.0", "VS1", "G", "61.0", "1.05", "4.70", "4.50", "2.75"],
  ["2501-001 HA", "12.200", "ROUND", "0.9", "VS2", "H", "59.8", "1.00", "4.50", "4.50", "2.70"],
  // BLUE stone block 3 — with unresolved segment + unknown shape
  ["670D-_E+xq", "8.300", "ROUND", "0.6", "SI1", "I", "60.0", "1.10", "3.50", "3.20", "1.95"],
  ["670D-_E+xq", "8.300", "TREGAL", "0.55", "SI2", "J", "62.0", "1.20", "3.80", "3.20", "2.00"],
];

// ---------------------------------------------------------------------------
// HELPERS
// ---------------------------------------------------------------------------
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function generateSampleWorkbook(): void {
  const ws = XLSX.utils.aoa_to_sheet(SAMPLE_WORKBOOK_ROWS);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Plan");
  XLSX.writeFile(wb, "sample-workbook.xlsx");
}

// Returns the pastel background class for an additional-group row, or "" for main-plan rows.
// Sequence restarts per stone name block (spec §42).
function rowPastelForBlock(block: StoneNameBlock, row: WorkbookRow): string {
  let additionalIdx = -1;
  for (const group of block.planGroups) {
    if (group.isAdditional) {
      additionalIdx++;
      if (group.rows.some((r) => r.rowIndex === row.rowIndex)) {
        return PASTEL_BG_SEQUENCE[additionalIdx % PASTEL_BG_SEQUENCE.length];
      }
    }
  }
  return "";
}

// ---------------------------------------------------------------------------
// MAIN COMPONENT
// ---------------------------------------------------------------------------
export function WorkbookImportView() {
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [parseResult, setParseResult] = useState<WorkbookParseResult | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const { data: shapeMappings, isLoading } = useApi<{ rows: ShapeMappingRow[] }>(
    "/api/admin/shape-mappings"
  );

  const parseMutation = useMutation<WorkbookParseResult, Error, File>({
    mutationFn: async (uploadFile: File) => {
      const formData = new FormData();
      formData.append("file", uploadFile);
      // NOTE: use raw fetch (not apiPost) — apiPost sets JSON content-type which is wrong for multipart
      const res = await fetch("/api/planning/workbook/parse", {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try {
          const err = await res.json();
          msg = err?.error || msg;
        } catch {
          // ignore JSON parse failure — fallback to status text
          msg = res.statusText || msg;
        }
        throw new Error(msg);
      }
      return (await res.json()) as WorkbookParseResult;
    },
    onSuccess: (data) => {
      setError(null);
      setParseResult(data);
      toast.success(`Parsed ${data.totalRows} rows in ${data.stoneNameCount} block(s)`);
    },
    onError: (e) => {
      setError((e as Error).message);
      setParseResult(null);
      toast.error(`Parse failed: ${(e as Error).message}`);
    },
  });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null;
    if (!f) return;
    // Client-side safety: MIME + extension + size — server also enforces these
    const isXlsx =
      f.name.toLowerCase().endsWith(".xlsx") &&
      (f.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
        f.type === "application/octet-stream" ||
        f.type === "");
    if (!isXlsx) {
      setFile(null);
      setParseResult(null);
      setError(
        `Rejected file "${f.name}". Only .xlsx files are accepted (got MIME: ${f.type || "unknown"}).`
      );
      return;
    }
    if (f.size > 10 * 1024 * 1024) {
      setFile(null);
      setParseResult(null);
      setError(
        `File too large: ${(f.size / 1024 / 1024).toFixed(2)} MB exceeds the 10 MB limit.`
      );
      return;
    }
    setFile(f);
    setError(null);
    setParseResult(null);
  };

  const handleParse = () => {
    if (!file) return;
    parseMutation.mutate(file);
  };

  const shapeCols: Column<ShapeMappingRow>[] = [
    {
      key: "rawShape",
      header: "Raw Shape",
      width: "180px",
      cell: (r) => <span className="font-mono">{r.rawShape}</span>,
    },
    {
      key: "normalizedShape",
      header: "Normalized",
      width: "140px",
      cell: (r) => <Badge variant="info">{r.normalizedShape}</Badge>,
    },
    {
      key: "category",
      header: "Category",
      width: "140px",
      cell: (r) => <Pill>{r.category}</Pill>,
    },
    {
      key: "active",
      header: "Active",
      width: "80px",
      align: "center",
      cell: (r) =>
        r.active ? <Badge variant="success">YES</Badge> : <Badge variant="neutral">NO</Badge>,
    },
  ];

  // Derived summary KPI intents
  const issuesCount = parseResult?.validationIssues.length ?? 0;
  const hasBlocking =
    parseResult?.validationIssues.some(
      (i) => i.severity === "BLOCKING" || i.severity === "ERROR"
    ) ?? false;
  const hasWarning =
    parseResult?.validationIssues.some((i) => i.severity === "WARNING") ?? false;
  const issuesIntent: "default" | "critical" | "warning" | "success" | "info" =
    issuesCount === 0 ? "success" : hasBlocking ? "critical" : hasWarning ? "warning" : "info";

  const sparkRows = useMemo(
    () => parseResult?.blocks.map((b) => b.rows.length).slice(0, 7) ?? [],
    [parseResult]
  );

  return (
    <div className="flex flex-col gap-3 p-3">
      <PageHeader
        title="Workbook Import"
        subtitle="Import planner workbooks (.xlsx) · first worksheet, fixed 11-column contract · parsed server-side into planning cases & pieces"
        meta={
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 text-[11px] gap-1.5"
            onClick={generateSampleWorkbook}
          >
            <Download className="h-3 w-3" /> Sample Workbook
          </Button>
        }
      />

      {/* Workbook contract */}
      <Section
        title="Workbook Contract"
        description="The importer only accepts .xlsx files. The first worksheet is read; subsequent sheets are ignored."
        bodyClassName="p-3"
      >
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 text-[11px] font-medium text-foreground">
            <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-600" />
            Required columns (in order, row 1 = headers):
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-1">
            {COLUMNS.map((c, i) => (
              <div
                key={c}
                className="flex items-center gap-2 rounded-md border border-border bg-muted/30 px-2 py-1 text-[11px]"
              >
                <span className="text-[10px] font-semibold text-muted-foreground tabular-nums">{i + 1}</span>
                <code className="font-mono text-[11px] text-foreground">{c}</code>
              </div>
            ))}
          </div>
        </div>
      </Section>

      {/* Stone name parsing rules */}
      <Section
        title="Stone Name Parsing Rules"
        description="STONE.Name is parsed into kapan, packet, signer; unresolved segments are surfaced."
        bodyClassName="p-3"
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="rounded-md border border-sky-200 dark:border-sky-900 bg-sky-50/50 dark:bg-sky-950/30 p-3">
            <div className="flex items-center gap-2 mb-2">
              <Badge variant="info">BLUE</Badge>
              <span className="text-[11px] font-medium">Format: <code className="font-mono">[kapan]-[packet]_[signer]</code> or with extra segments</span>
            </div>
            <div className="text-[11px] space-y-1">
              <div>Input: <code className="font-mono">670D-764_E+pv</code></div>
              <ul className="ml-3 list-disc space-y-0.5 text-muted-foreground">
                <li><span className="text-foreground font-medium">kapan</span> = <code className="font-mono">670D</code> (segment 1)</li>
                <li><span className="text-foreground font-medium">packet</span> = <code className="font-mono">764</code> (segment 2 after <code>-</code>)</li>
                <li><span className="text-foreground font-medium">signer</span> = <code className="font-mono">pv</code> (after <code>+</code>, last segment)</li>
                <li><span className="text-rose-600 dark:text-rose-400 font-medium">unresolved</span> = <code className="font-mono">_E</code> (extra segment)</li>
              </ul>
            </div>
          </div>

          <div className="rounded-md border border-gray-300 dark:border-gray-700 bg-gray-50/60 dark:bg-gray-950/30 p-3">
            <div className="flex items-center gap-2 mb-2">
              <Badge variant="default">WHITE</Badge>
              <span className="text-[11px] font-medium">Format: <code className="font-mono">[kapan]-[packet] [signer]</code></span>
            </div>
            <div className="text-[11px] space-y-1">
              <div>Input: <code className="font-mono">2501-001 HA</code></div>
              <ul className="ml-3 list-disc space-y-0.5 text-muted-foreground">
                <li><span className="text-foreground font-medium">kapan</span> = <code className="font-mono">2501</code> (segment 1)</li>
                <li><span className="text-foreground font-medium">packet</span> = <code className="font-mono">001</code> (segment 2 after <code>-</code>, leading zeros preserved)</li>
                <li><span className="text-foreground font-medium">signer</span> = <code className="font-mono">HA</code> (after space)</li>
                <li><span className="text-muted-foreground font-medium">unresolved</span> = — (none)</li>
              </ul>
            </div>
          </div>
        </div>
      </Section>

      {/* Main / Additional plan limits */}
      <Section
        title="Plan Slot Limits"
        description="Each stone has a fixed number of main and additional plan slots"
        bodyClassName="p-3"
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="rounded-md border border-sky-200 dark:border-sky-900 p-3">
            <div className="flex items-center gap-2 mb-2">
              <Badge variant="info">BLUE</Badge>
              <span className="text-[11px] font-medium">Stone type limits</span>
            </div>
            <ul className="text-[11px] space-y-1">
              <li><span className="text-emerald-600 dark:text-emerald-400 font-medium">Main plan: 1–17</span> · slots 1 to 17 inclusive</li>
              <li><span className="text-amber-600 dark:text-amber-400 font-medium">Additional plan: 18+</span> · slots ≥ 18</li>
            </ul>
          </div>
          <div className="rounded-md border border-gray-300 dark:border-gray-700 p-3">
            <div className="flex items-center gap-2 mb-2">
              <Badge variant="default">WHITE</Badge>
              <span className="text-[11px] font-medium">Stone type limits</span>
            </div>
            <ul className="text-[11px] space-y-1">
              <li><span className="text-emerald-600 dark:text-emerald-400 font-medium">Main plan: 1–32</span> · slots 1 to 32 inclusive</li>
              <li><span className="text-amber-600 dark:text-amber-400 font-medium">Additional plan: 33+</span> · slots ≥ 33</li>
            </ul>
          </div>
        </div>
      </Section>

      {/* Security banner */}
      <InfoBanner variant="warning">
        <div className="flex items-start gap-2">
          <ShieldCheck className="h-4 w-4 mt-0.5 flex-shrink-0" />
          <div>
            <p className="font-semibold">XLSX security — read before importing</p>
            <ul className="ml-4 list-disc space-y-0.5 mt-1">
              <li>Only <code className="font-mono">.xlsx</code> files are accepted (reject .xls, .xlsm with macros, .csv, .xml).</li>
              <li>Validate MIME type: <code className="font-mono">application/vnd.openxmlformats-officedocument.spreadsheetml.sheet</code>.</li>
              <li>Hard limit file size to 10 MB to prevent memory exhaustion attacks.</li>
              <li>Files are scanned for macro/OLE-embedded scripts; workbooks with macros are rejected.</li>
              <li>Worksheets are read in strict read-only mode; no formulas, no auto-recalc, no remote refs.</li>
              <li>Workbook processing happens in a sandboxed, isolated process.</li>
            </ul>
          </div>
        </div>
      </InfoBanner>

      {/* Upload form */}
      <Section
        title="Upload & Parse Workbook"
        description="Pick a .xlsx file (≤10MB, first sheet, 11-column contract) — file is sent server-side for parsing"
        bodyClassName="p-3"
      >
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex-1 min-w-[240px]">
              <Label htmlFor="wb-file" className="sr-only">Workbook file</Label>
              <Input
                id="wb-file"
                ref={inputRef}
                type="file"
                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                onChange={handleFileChange}
                className="h-9 text-xs"
              />
            </div>
            <Button
              type="button"
              size="sm"
              className="h-9"
              disabled={!file || parseMutation.isPending}
              onClick={handleParse}
            >
              {parseMutation.isPending ? (
                <>
                  <div className="h-3 w-3 border-2 border-white border-t-transparent rounded-full animate-spin mr-1" />
                  Parsing…
                </>
              ) : (
                <>
                  <Upload className="h-3.5 w-3.5 mr-1" /> Parse Workbook
                </>
              )}
            </Button>
            {file && (
              <div className="text-[11px] text-muted-foreground">
                <Sparkles className="h-3 w-3 inline mr-1" />
                {file.name} · {formatFileSize(file.size)}
              </div>
            )}
          </div>

          {error && (
            <InfoBanner variant="critical">
              <div className="flex items-start gap-2">
                <XCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="font-semibold">Parse error</p>
                  <p className="mt-0.5">{error}</p>
                </div>
              </div>
            </InfoBanner>
          )}

          {parseMutation.isPending && (
            <InfoBanner variant="info">
              <div className="flex items-center gap-2">
                <div className="h-3 w-3 border-2 border-sky-600 border-t-transparent rounded-full animate-spin" />
                Parsing workbook server-side — reading first sheet, parsing 11 columns, computing yields, plan groups, and top-3 rankings…
              </div>
            </InfoBanner>
          )}

          {!file && !error && !parseResult && (
            <p className="text-[10px] text-muted-foreground">
              Need a sample? Click <span className="font-medium">Sample Workbook</span> in the page header to download a small <code className="font-mono">.xlsx</code> with three example stone name blocks (BLUE / WHITE / unresolved + unknown shape + EMERALD 5STEP).
            </p>
          )}
        </div>
      </Section>

      {/* ============ PARSE RESULT (only when available) ============ */}
      {parseResult && (
        <>
          {/* Summary KPIs */}
          <div>
            <div className="flex items-center gap-2 mb-2 px-1">
              <div className="h-4 w-1 rounded-full bg-emerald-500" />
              <h2 className="text-[11px] font-bold uppercase tracking-wide text-foreground">Parse Summary</h2>
              <span className="text-[10px] text-muted-foreground">
                — {parseResult.fileName} · {formatFileSize(parseResult.fileSize)} · parsed {new Date(parseResult.parsedAt).toLocaleString()}
              </span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
              <KpiCard label="Total Rows" value={parseResult.totalRows} icon={ListTree} intent="info" sparkline={sparkRows} />
              <KpiCard label="Stone Name Blocks" value={parseResult.stoneNameCount} icon={Boxes} intent="default" />
              <KpiCard
                label="Unknown Shapes"
                value={parseResult.unknownShapes.length}
                icon={AlertTriangle}
                intent={parseResult.unknownShapes.length > 0 ? "warning" : "success"}
              />
              <KpiCard
                label="Validation Issues"
                value={issuesCount}
                icon={ShieldAlert}
                intent={issuesIntent}
                hint={
                  issuesCount === 0
                    ? "No issues surfaced"
                    : hasBlocking
                    ? "Has BLOCKING/ERROR issues"
                    : hasWarning
                    ? "Has WARNING issues"
                    : "INFO only"
                }
              />
              <KpiCard
                label="Legacy Header"
                value={parseResult.legacyHeaderDetected ? "Detected" : "None"}
                icon={History}
                intent={parseResult.legacyHeaderDetected ? "warning" : "success"}
              />
              <KpiCard
                label="Extra Columns"
                value={parseResult.extraColumnsCount}
                icon={Columns}
                intent={parseResult.extraColumnsCount > 0 ? "warning" : "success"}
                hint={parseResult.extraColumnsCount > 0 ? "Beyond the 11-col contract — ignored" : "Within 11-col contract"}
              />
            </div>
          </div>

          {/* Parse errors (fatal) */}
          {parseResult.parseErrors.length > 0 && (
            <Section title="Parse Errors" description="Fatal errors that prevented a clean parse" bodyClassName="p-3">
              <InfoBanner variant="critical">
                <ul className="ml-4 list-disc space-y-0.5">
                  {parseResult.parseErrors.map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              </InfoBanner>
            </Section>
          )}

          {/* Validation Issues */}
          <Section
            title="Validation Issues"
            description="All surfaced issues across blocks (BLOCKING/ERROR/WARNING/INFO)"
            bodyClassName="p-2"
          >
            {parseResult.validationIssues.length === 0 ? (
              <EmptyState
                icon={<CheckCircle2 className="h-8 w-8" />}
                title="No validation issues"
                message="All blocks parsed cleanly."
              />
            ) : (
              <div className="flex flex-col gap-1.5">
                {parseResult.validationIssues.map((issue, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-2 rounded border border-border bg-card px-2 py-1.5"
                  >
                    <StatusBadge status={issue.severity} />
                    <span className="text-[10px] text-muted-foreground tabular-nums flex-shrink-0 mt-0.5">
                      row {issue.row}
                    </span>
                    <span className="text-[11px] mt-0.5">{issue.message}</span>
                  </div>
                ))}
              </div>
            )}
          </Section>

          {/* Unknown Shapes */}
          <Section
            title="Unknown Shapes"
            description="Raw shape names not matched by the normalizeShape seed mapping"
            bodyClassName="p-2"
          >
            {parseResult.unknownShapes.length === 0 ? (
              <EmptyState
                icon={<CheckCircle2 className="h-8 w-8" />}
                title="All shapes recognized"
                message="Every raw shape in the workbook matched the seed mapping."
              />
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {parseResult.unknownShapes.map((s) => (
                  <Badge key={s} variant="critical" className="gap-1">
                    <AlertTriangle className="h-2.5 w-2.5" />
                    <code className="font-mono">{s}</code>
                  </Badge>
                ))}
              </div>
            )}
          </Section>

          {/* Top-3 Yields */}
          <Section
            title="Top-3 Yields"
            description="Highest combined yields across all blocks — main plan yields compete with additional group combined yields"
            bodyClassName="p-2"
          >
            {parseResult.topThreeYields.length === 0 ? (
              <EmptyState
                icon={<Trophy className="h-8 w-8" />}
                title="No yields ranked"
                message="No plan groups available to rank."
              />
            ) : (
              <div className="overflow-x-auto rounded-md border border-border">
                <table className="w-full text-xs border-collapse">
                  <thead className="bg-muted/60 border-b border-border">
                    <tr>
                      <th className="px-2 py-1.5 text-left font-semibold text-muted-foreground uppercase tracking-wide text-[10px]">Rank</th>
                      <th className="px-2 py-1.5 text-left font-semibold text-muted-foreground uppercase tracking-wide text-[10px]">Stone Name</th>
                      <th className="px-2 py-1.5 text-left font-semibold text-muted-foreground uppercase tracking-wide text-[10px]">Plan #</th>
                      <th className="px-2 py-1.5 text-right font-semibold text-muted-foreground uppercase tracking-wide text-[10px]">Yield %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parseResult.topThreeYields.map((t) => (
                      <tr
                        key={`${t.stoneName}-${t.planNumber}-${t.rank}`}
                        className="border-b border-border/40 last:border-0 hover:bg-muted/40"
                      >
                        <td className="px-2 py-1.5">
                          <Badge
                            variant={
                              t.rank === 1 ? "critical" : t.rank === 2 ? "warning" : "info"
                            }
                            className="gap-1"
                          >
                            <Trophy className="h-2.5 w-2.5" /> #{t.rank}
                          </Badge>
                        </td>
                        <td className="px-2 py-1.5">
                          <code className="font-mono text-[11px]">{t.stoneName}</code>
                        </td>
                        <td className="px-2 py-1.5 tabular-nums">{t.planNumber}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums font-medium">
                          {formatYield(t.yieldPct)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          {/* Stone Name Blocks */}
          <Section
            title="Stone Name Blocks"
            description={`${parseResult.blocks.length} block(s) · click a block to expand/collapse · main-plan rows uncolored, additional plan groups colored in pastel sequence (restarts per stone name — spec §42)`}
            bodyClassName="p-2"
          >
            <div className="flex flex-col gap-2">
              {parseResult.blocks.map((block, idx) => (
                <BlockCard key={block.stoneName} block={block} idx={idx} />
              ))}
            </div>
          </Section>
        </>
      )}

      {/* Shape normalization seed */}
      <Section
        title="Shape Normalization Seed Mapping"
        description="Loaded from /api/admin/shape-mappings · drives the workbook shape normalization step"
        bodyClassName="p-2"
      >
        <DataTable<ShapeMappingRow>
          columns={shapeCols}
          rows={shapeMappings?.rows ?? []}
          loading={isLoading}
          emptyMessage="No shape mappings defined."
          maxHeight="320px"
          searchable
          searchPlaceholder="Search raw or normalized shape…"
          searchFn={(r, q) => {
            const s = q.toLowerCase();
            return (
              r.rawShape.toLowerCase().includes(s) ||
              r.normalizedShape.toLowerCase().includes(s) ||
              r.category.toLowerCase().includes(s)
            );
          }}
          pagination
          pageSize={20}
        />
      </Section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// BLOCK CARD — collapsible per-stone-name block with rows + plan groups
// ---------------------------------------------------------------------------
function BlockCard({ block, idx }: { block: StoneNameBlock; idx: number }) {
  const [open, setOpen] = useState(true);
  const mainLimit =
    block.parsed.stoneType === "BLUE" ? block.blueMainLimit : block.whiteMainLimit;

  return (
    <div className="rounded-md border border-border overflow-hidden bg-card">
      {/* Trigger header */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center justify-between gap-3 w-full px-3 py-2 bg-muted/30 hover:bg-muted/50 text-left transition-colors"
        aria-expanded={open}
      >
        <div className="flex items-center gap-2 flex-wrap text-[11px]">
          <span className="text-[10px] font-mono text-muted-foreground tabular-nums">#{idx + 1}</span>
          <code className="font-mono text-xs text-foreground">{block.stoneName}</code>
          {block.parsed.stoneType === "BLUE" ? (
            <Badge variant="info">BLUE</Badge>
          ) : block.parsed.stoneType === "WHITE" ? (
            <Badge variant="default">WHITE</Badge>
          ) : (
            <Badge variant="neutral">UNKNOWN</Badge>
          )}
          <span className="text-muted-foreground flex items-center gap-1 flex-wrap">
            <span className="text-[10px]">kapan:</span>
            <code className="font-mono">{block.parsed.kapan || "—"}</code>
            <span className="text-muted-foreground/40">·</span>
            <span className="text-[10px]">packet:</span>
            <code className="font-mono">{block.parsed.packet || "—"}</code>
            <span className="text-muted-foreground/40">·</span>
            <span className="text-[10px]">signer:</span>
            <code className="font-mono">{block.parsed.signer || "—"}</code>
            {block.parsed.unresolved && (
              <>
                <span className="text-muted-foreground/40">·</span>
                <span className="text-rose-600 dark:text-rose-400 text-[10px]">unresolved:</span>
                <code className="font-mono text-rose-600 dark:text-rose-400">{block.parsed.unresolved}</code>
              </>
            )}
          </span>
          <Pill className="gap-1">
            <Gem className="h-2.5 w-2.5" />
            rough {formatEstWeight(block.roughWeight)} ct
          </Pill>
          <Pill className="gap-1">
            <ListTree className="h-2.5 w-2.5" />
            {block.rows.length} row{block.rows.length !== 1 ? "s" : ""}
          </Pill>
          <Pill className="gap-1">
            <Layers className="h-2.5 w-2.5" />
            {block.planGroups.length} group{block.planGroups.length !== 1 ? "s" : ""}
          </Pill>
          {block.validationWarnings.length > 0 && (
            <Badge variant="warning" className="gap-1">
              <AlertTriangle className="h-2.5 w-2.5" />
              {block.validationWarnings.length} warning{block.validationWarnings.length !== 1 ? "s" : ""}
            </Badge>
          )}
        </div>
        <ChevronDown
          className={cn(
            "h-4 w-4 text-muted-foreground flex-shrink-0 transition-transform duration-200",
            open && "rotate-180"
          )}
        />
      </button>

      {/* Body */}
      {open && (
        <div className="px-3 pb-3 pt-2">
          {/* Block validation warnings */}
          {block.validationWarnings.length > 0 && (
            <div className="rounded border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 p-2 mb-3">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300 mb-1 flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" /> Block Warnings
              </div>
              <ul className="text-[10px] ml-4 list-disc space-y-0.5">
                {block.validationWarnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Plan Groups subsection */}
          <div className="mb-3">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5 flex items-center gap-1">
              <Layers className="h-3 w-3" /> Plan Groups ({block.planGroups.length})
              <span className="text-muted-foreground/70 font-normal normal-case tracking-normal">
                · main ≤ {mainLimit} · additional &gt; {mainLimit}
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {block.planGroups.map((pg) => (
                <div
                  key={pg.groupIndex}
                  className={cn(
                    "rounded-md border border-border bg-card px-2 py-1 text-[10px] flex items-center gap-1.5",
                    pg.isAdditional &&
                      PASTEL_BG_SEQUENCE[
                        (() => {
                          let ai = -1;
                          for (const g of block.planGroups) {
                            if (g.isAdditional) {
                              ai++;
                              if (g.groupIndex === pg.groupIndex) break;
                            }
                          }
                          return Math.max(0, ai);
                        })() % PASTEL_BG_SEQUENCE.length
                      ]
                  )}
                >
                  <span className="font-mono text-muted-foreground">#{pg.planNumber}</span>
                  {pg.isMainPlan ? (
                    <Badge variant="success">MAIN</Badge>
                  ) : (
                    <Badge variant="warning">ADD</Badge>
                  )}
                  <span className="text-muted-foreground">
                    {pg.rows.length} row{pg.rows.length !== 1 ? "s" : ""}
                  </span>
                  <span className="font-medium tabular-nums">yield {formatYield(pg.combinedYieldPct)}</span>
                  {pg.topRank && (
                    <Badge
                      variant={pg.topRank === 1 ? "critical" : pg.topRank === 2 ? "warning" : "info"}
                      className="gap-1"
                    >
                      <Trophy className="h-2.5 w-2.5" /> #{pg.topRank}
                    </Badge>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Rows table */}
          <div className="rounded-md border border-border overflow-x-auto bg-card">
            <table className="w-full text-xs border-collapse min-w-[920px]">
              <thead className="bg-muted border-b border-border">
                <tr>
                  <th className="px-2 py-1.5 text-center font-semibold text-muted-foreground uppercase tracking-wide text-[10px] whitespace-nowrap border-r border-border/40">Row#</th>
                  <th className="px-2 py-1.5 text-left font-semibold text-muted-foreground uppercase tracking-wide text-[10px] whitespace-nowrap border-r border-border/40">Stone Name</th>
                  <th className="px-2 py-1.5 text-left font-semibold text-muted-foreground uppercase tracking-wide text-[10px] whitespace-nowrap border-r border-border/40">Rough Cut</th>
                  <th className="px-2 py-1.5 text-left font-semibold text-muted-foreground uppercase tracking-wide text-[10px] whitespace-nowrap border-r border-border/40">Shape</th>
                  <th className="px-2 py-1.5 text-right font-semibold text-muted-foreground uppercase tracking-wide text-[10px] whitespace-nowrap border-r border-border/40">Polish Wt</th>
                  <th className="px-2 py-1.5 text-left font-semibold text-muted-foreground uppercase tracking-wide text-[10px] whitespace-nowrap border-r border-border/40">Clarity</th>
                  <th className="px-2 py-1.5 text-left font-semibold text-muted-foreground uppercase tracking-wide text-[10px] whitespace-nowrap border-r border-border/40">Color</th>
                  <th className="px-2 py-1.5 text-right font-semibold text-muted-foreground uppercase tracking-wide text-[10px] whitespace-nowrap border-r border-border/40">Depth %</th>
                  <th className="px-2 py-1.5 text-right font-semibold text-muted-foreground uppercase tracking-wide text-[10px] whitespace-nowrap border-r border-border/40">Ratio</th>
                  <th className="px-2 py-1.5 text-right font-semibold text-muted-foreground uppercase tracking-wide text-[10px] whitespace-nowrap border-r border-border/40">Length</th>
                  <th className="px-2 py-1.5 text-right font-semibold text-muted-foreground uppercase tracking-wide text-[10px] whitespace-nowrap border-r border-border/40">Width</th>
                  <th className="px-2 py-1.5 text-right font-semibold text-muted-foreground uppercase tracking-wide text-[10px] whitespace-nowrap border-r border-border/40">Depth mm</th>
                  <th className="px-2 py-1.5 text-right font-semibold text-muted-foreground uppercase tracking-wide text-[10px] whitespace-nowrap">Yield %</th>
                </tr>
              </thead>
              <tbody>
                {block.rows.map((r) => {
                  const pastel = rowPastelForBlock(block, r);
                  return (
                    <tr
                      key={r.rowIndex}
                      className={cn(
                        "border-b border-border/50 last:border-b-0 transition-colors",
                        pastel || "hover:bg-muted/30"
                      )}
                    >
                      <td className="px-2 py-1.5 text-center text-muted-foreground tabular-nums border-r border-border/40">{r.rowIndex}</td>
                      <td className="px-2 py-1.5 border-r border-border/40">
                        <code className="font-mono text-[11px]">{r.stoneName}</code>
                      </td>
                      <td className="px-2 py-1.5 text-muted-foreground border-r border-border/40">{r.roughCut || "—"}</td>
                      <td className="px-2 py-1.5 border-r border-border/40">
                        <div className="flex items-center gap-1">
                          <code className="font-mono text-[10px]">{r.shapeRaw || "—"}</code>
                          <ChevronRight className="h-2.5 w-2.5 text-muted-foreground/50" />
                          {r.shapeKnown ? (
                            <Badge variant="info">{r.shapeNormalized}</Badge>
                          ) : (
                            <Badge variant="critical">unknown</Badge>
                          )}
                        </div>
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums border-r border-border/40">{formatEstWeight(r.polishWeight)}</td>
                      <td className="px-2 py-1.5 border-r border-border/40">{r.clarity || "—"}</td>
                      <td className="px-2 py-1.5 border-r border-border/40">{r.color || "—"}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums border-r border-border/40">
                        {r.totalDepthPct != null ? r.totalDepthPct.toFixed(2) : "—"}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums border-r border-border/40">
                        {r.ratio != null ? r.ratio.toFixed(2) : "—"}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums border-r border-border/40">
                        {r.length != null ? r.length.toFixed(2) : "—"}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums border-r border-border/40">
                        {r.width != null ? r.width.toFixed(2) : "—"}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums border-r border-border/40">
                        {r.totalDepthMm != null ? r.totalDepthMm.toFixed(2) : "—"}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums font-medium">
                        {formatYield(r.yieldPct)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {block.rows.length === 0 && (
            <div className="py-4">
              <EmptyState title="No rows in this block" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
