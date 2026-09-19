"use client";

import { useRef, useState } from "react";
import { useApi } from "@/lib/api-client";
import { PageHeader, Section } from "@/components/diamond/shared/page-header";
import { Badge, Pill } from "@/components/diamond/shared/badges";
import { InfoBanner } from "@/components/diamond/shared/empty-state";
import { DataTable, type Column } from "@/components/diamond/shared/data-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  FileSpreadsheet,
  ShieldCheck,
  Upload,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Sparkles,
} from "lucide-react";

interface ShapeMappingRow {
  id: string;
  rawShape: string;
  normalizedShape: string;
  category: string;
  active: boolean;
}

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

interface MockValidationResult {
  rowsParsed: number;
  blueStones: number;
  whiteStones: number;
  unresolvedNames: number;
  unmappedShapes: number;
  errors: string[];
  warnings: string[];
}

export function WorkbookImportView() {
  const [file, setFile] = useState<File | null>(null);
  const [validation, setValidation] = useState<MockValidationResult | null>(null);
  const [validating, setValidating] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const { data: shapeMappings, isLoading } = useApi<{ rows: ShapeMappingRow[] }>(
    "/api/admin/shape-mappings"
  );

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

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null;
    if (f) {
      // MIME + extension safety check
      const isXlsx = f.name.toLowerCase().endsWith(".xlsx") &&
        (f.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
          f.type === "application/octet-stream" ||
          f.type === "");
      if (!isXlsx) {
        setFile(null);
        setValidation({
          rowsParsed: 0,
          blueStones: 0,
          whiteStones: 0,
          unresolvedNames: 0,
          unmappedShapes: 0,
          errors: [`Rejected file "${f.name}". Only .xlsx files are accepted (got MIME: ${f.type || "unknown"}).`],
          warnings: [],
        });
        return;
      }
      if (f.size > 10 * 1024 * 1024) {
        setFile(null);
        setValidation({
          rowsParsed: 0,
          blueStones: 0,
          whiteStones: 0,
          unresolvedNames: 0,
          unmappedShapes: 0,
          errors: [`File too large: ${(f.size / 1024 / 1024).toFixed(2)} MB exceeds the 10 MB limit.`],
          warnings: [],
        });
        return;
      }
      setFile(f);
      setValidation(null);
    }
  };

  const runValidation = () => {
    if (!file) return;
    setValidating(true);
    // Mock validation — in a real system this would POST the file and get back parsed + validated results
    setTimeout(() => {
      const isBlue = file.name.toLowerCase().includes("blue");
      const rowsParsed = isBlue ? 48 : 64;
      const blueStones = isBlue ? 48 : 12;
      const whiteStones = isBlue ? 0 : 52;
      setValidation({
        rowsParsed,
        blueStones,
        whiteStones,
        unresolvedNames: 2,
        unmappedShapes: 1,
        errors: [],
        warnings: [
          "Row 12: signer segment empty in STONE.Name '670D-_E+pv' — packet unresolved.",
          "Row 27: shape 'OVAL' normalized to 'Oval'; verify against seed mapping.",
          "Row 41: RESULT.1.Rough Cut is blank — defaulted to 1 (main plan).",
        ],
      });
      setValidating(false);
    }, 700);
  };

  return (
    <div className="flex flex-col gap-3 p-3">
      <PageHeader
        title="Workbook Import"
        subtitle="Import planner workbooks (.xlsx) · first worksheet, fixed 11-column contract · parsed into planning cases & pieces"
        meta={<span className="text-[10px] text-muted-foreground">UI-only mock · no file is uploaded</span>}
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
        title="Upload Workbook"
        description="Pick a .xlsx file and run a mock validation pass"
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
              disabled={!file || validating}
              onClick={runValidation}
            >
              {validating ? (
                <>
                  <div className="h-3 w-3 border-2 border-white border-t-transparent rounded-full animate-spin mr-1" />
                  Validating…
                </>
              ) : (
                <>
                  <Upload className="h-3.5 w-3.5 mr-1" /> Validate
                </>
              )}
            </Button>
            {file && (
              <div className="text-[11px] text-muted-foreground">
                <Sparkles className="h-3 w-3 inline mr-1" />
                {file.name} · {(file.size / 1024).toFixed(1)} KB
              </div>
            )}
          </div>

          {validation && (
            <div className="rounded-md border border-border p-3 bg-card">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-1">
                <CheckCircle2 className="h-3.5 w-3.5" /> Mock Validation Result
              </div>
              {validation.errors.length > 0 ? (
                <div className="rounded border border-rose-300 dark:border-rose-900 bg-rose-50/60 dark:bg-rose-950/30 p-2 mb-2">
                  <div className="flex items-center gap-1 text-[11px] font-semibold text-rose-700 dark:text-rose-300 mb-1">
                    <XCircle className="h-3.5 w-3.5" /> Errors ({validation.errors.length})
                  </div>
                  <ul className="text-[11px] ml-4 list-disc space-y-0.5">
                    {validation.errors.map((e, i) => (
                      <li key={i}>{e}</li>
                    ))}
                  </ul>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-3">
                    <Stat label="Rows Parsed" value={validation.rowsParsed} intent="info" />
                    <Stat label="Blue Stones" value={validation.blueStones} intent="info" />
                    <Stat label="White Stones" value={validation.whiteStones} intent="default" />
                    <Stat label="Unresolved Names" value={validation.unresolvedNames} intent={validation.unresolvedNames > 0 ? "warning" : "success"} />
                    <Stat label="Unmapped Shapes" value={validation.unmappedShapes} intent={validation.unmappedShapes > 0 ? "warning" : "success"} />
                  </div>
                  {validation.warnings.length > 0 && (
                    <div className="rounded border border-amber-300 dark:border-amber-900 bg-amber-50/60 dark:bg-amber-950/30 p-2">
                      <div className="flex items-center gap-1 text-[11px] font-semibold text-amber-700 dark:text-amber-300 mb-1">
                        <AlertTriangle className="h-3.5 w-3.5" /> Warnings ({validation.warnings.length})
                      </div>
                      <ul className="text-[11px] ml-4 list-disc space-y-0.5">
                        {validation.warnings.map((w, i) => (
                          <li key={i}>{w}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <p className="text-[10px] text-muted-foreground mt-2">
                    This is a UI-only mock. The real implementation would POST the .xlsx file to <code className="font-mono">/api/planning/workbook</code> which parses & validates server-side.
                  </p>
                </>
              )}
            </div>
          )}
        </div>
      </Section>

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

function Stat({
  label,
  value,
  intent,
}: {
  label: string;
  value: number;
  intent: "default" | "info" | "warning" | "success" | "critical";
}) {
  const colors: Record<string, string> = {
    default: "text-foreground",
    info: "text-sky-600 dark:text-sky-400",
    warning: "text-amber-600 dark:text-amber-400",
    success: "text-emerald-600 dark:text-emerald-400",
    critical: "text-rose-600 dark:text-rose-400",
  };
  return (
    <div className="rounded-md border border-border bg-muted/30 px-2 py-1.5">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`text-base font-semibold tabular-nums ${colors[intent]}`}>{value}</div>
    </div>
  );
}
