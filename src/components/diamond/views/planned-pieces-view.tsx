"use client";

import { useMemo, useState } from "react";
import { useApi } from "@/lib/api-client";
import { PageHeader, Section } from "@/components/diamond/shared/page-header";
import { DataTable, type Column } from "@/components/diamond/shared/data-table";
import { StatusBadge, Badge } from "@/components/diamond/shared/badges";
import { KpiCard } from "@/components/diamond/shared/kpi-card";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { Filter, X, Package } from "lucide-react";

interface PieceRow {
  id: string;
  pieceCode: string;
  sequence: number;
  caseCode: string;
  caseStatus: string;
  optionCode: string;
  expectedShape: string | null;
  expectedWeight: number;
  expectedColor: string | null;
  expectedClarity: string | null;
  expectedCategory: string | null;
  certificationIntent: string | null;
  fantasyChildId: string | null;
  actualPolishedLotId: string | null;
  actualShape: string | null;
  actualWeight: number | null;
  actualCategory: string | null;
  fulfilled: boolean;
}

interface ApiResponse {
  rows: PieceRow[];
}

const COMMON_SHAPES = [
  "ROUND",
  "OVAL",
  "PEAR",
  "MARQUISE",
  "EMERALD",
  "PRINCESS",
  "CUSHION",
  "RADIANT",
  "ASSCHER",
  "HEART",
];

export function PlannedPiecesView() {
  const [fulfilled, setFulfilled] = useState<"all" | "yes" | "no">("all");
  const [shape, setShape] = useState("");

  const qs = useMemo(() => {
    const parts: string[] = [];
    if (fulfilled === "yes") parts.push("fulfilled=true");
    if (shape) parts.push(`shape=${encodeURIComponent(shape)}`);
    return parts.length ? `?${parts.join("&")}` : "";
  }, [fulfilled, shape]);

  const { data, isLoading } = useApi<ApiResponse>(`/api/planning/pieces${qs}`);
  const rows = data?.rows ?? [];

  const totalFulfilled = rows.filter((r) => r.fulfilled).length;
  const totalPieces = rows.length;
  const totalExpectedWeight = rows.reduce((s, r) => s + r.expectedWeight, 0);
  const totalActualWeight = rows.reduce((s, r) => s + (r.actualWeight ?? 0), 0);

  const activeFilters = (fulfilled !== "all" ? 1 : 0) + (shape ? 1 : 0);
  const clearFilters = () => {
    setFulfilled("all");
    setShape("");
  };

  const columns: Column<PieceRow>[] = [
    {
      key: "pieceCode",
      header: "Piece Code",
      width: "140px",
      sticky: "left",
      sortable: true,
      sortValue: (r) => r.pieceCode,
      cell: (r) => <span className="font-mono font-medium">{r.pieceCode}</span>,
    },
    {
      key: "sequence",
      header: "Seq",
      width: "50px",
      align: "right",
      cell: (r) => <span className="tabular-nums">{r.sequence}</span>,
    },
    {
      key: "caseCode",
      header: "Case",
      width: "120px",
      cell: (r) => <span className="text-muted-foreground">{r.caseCode}</span>,
    },
    {
      key: "caseStatus",
      header: "Case Status",
      align: "center",
      width: "120px",
      cell: (r) => <StatusBadge status={r.caseStatus} />,
    },
    {
      key: "optionCode",
      header: "Opt",
      width: "80px",
      cell: (r) => r.optionCode,
    },
    {
      key: "expectedShape",
      header: "Exp Shape",
      width: "100px",
      cell: (r) => r.expectedShape ?? "—",
    },
    {
      key: "expectedWeight",
      header: "Exp Wt",
      width: "80px",
      align: "right",
      sortable: true,
      sortValue: (r) => r.expectedWeight,
      cell: (r) => <span className="tabular-nums">{r.expectedWeight.toFixed(3)}</span>,
    },
    {
      key: "expectedColor",
      header: "Exp Color",
      width: "80px",
      cell: (r) => r.expectedColor ?? "—",
    },
    {
      key: "expectedClarity",
      header: "Exp Clar",
      width: "80px",
      cell: (r) => r.expectedClarity ?? "—",
    },
    {
      key: "expectedCategory",
      header: "Exp Cat",
      align: "center",
      width: "110px",
      cell: (r) => <Badge variant="neutral">{r.expectedCategory ?? "—"}</Badge>,
    },
    {
      key: "certificationIntent",
      header: "Cert",
      align: "center",
      width: "90px",
      cell: (r) =>
        r.certificationIntent ? (
          <Badge variant={r.certificationIntent.includes("GIA") ? "info" : "default"}>
            {r.certificationIntent}
          </Badge>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      key: "fantasyChildId",
      header: "Fantasy Child",
      width: "130px",
      cell: (r) => r.fantasyChildId ?? "—",
    },
    {
      key: "actualPolishedLotId",
      header: "Actual Lot",
      width: "130px",
      cell: (r) => r.actualPolishedLotId ?? "—",
    },
    {
      key: "actualShape",
      header: "Act Shape",
      width: "100px",
      cell: (r) => r.actualShape ?? "—",
    },
    {
      key: "actualWeight",
      header: "Act Wt",
      width: "80px",
      align: "right",
      cell: (r) =>
        r.actualWeight !== null ? (
          <span className="tabular-nums">{r.actualWeight.toFixed(3)}</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      key: "actualCategory",
      header: "Act Cat",
      align: "center",
      width: "110px",
      cell: (r) =>
        r.actualCategory ? (
          <Badge variant="neutral">{r.actualCategory}</Badge>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      key: "fulfilled",
      header: "Fulfilled",
      width: "90px",
      align: "center",
      cell: (r) =>
        r.fulfilled ? (
          <Badge variant="success">YES</Badge>
        ) : (
          <Badge variant="default">NO</Badge>
        ),
    },
  ];

  return (
    <div className="flex flex-col gap-3 p-3">
      <PageHeader
        title="Planned Pieces"
        subtitle="All planned pieces across cases & options · expected vs actual · fulfilled flag"
        meta={
          <span className="text-[10px] text-muted-foreground">
            {totalPieces} pieces · {totalFulfilled} fulfilled · {totalExpectedWeight.toFixed(3)} ct expected
          </span>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <KpiCard label="Total Pieces" value={totalPieces} unit="pcs" intent="default" />
        <KpiCard label="Fulfilled" value={totalFulfilled} unit="pcs" intent="success" hint="Linked to actual polished lot" />
        <KpiCard label="Expected Weight" value={totalExpectedWeight.toFixed(3)} unit="ct" intent="info" />
        <KpiCard
          label="Actual Weight"
          value={totalActualWeight.toFixed(3)}
          unit="ct"
          intent={totalActualWeight > 0 ? "success" : "default"}
          hint="Sum of fulfilled actual weights"
        />
      </div>

      <Section
        title="Filters"
        description="fulfilled toggle · expected shape"
        bodyClassName="p-2"
        actions={
          activeFilters > 0 ? (
            <button onClick={clearFilters} className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
              <X className="h-3 w-3" /> Clear ({activeFilters})
            </button>
          ) : null
        }
      >
        <div className="flex items-center gap-4 flex-wrap">
          <Filter className="h-3.5 w-3.5 text-muted-foreground" />
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-muted-foreground">Fulfilled:</span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setFulfilled("all")}
                className={`h-7 px-2 text-[11px] rounded border ${fulfilled === "all" ? "bg-primary text-primary-foreground border-primary" : "border-border"}`}
              >
                All
              </button>
              <button
                onClick={() => setFulfilled("yes")}
                className={`h-7 px-2 text-[11px] rounded border ${fulfilled === "yes" ? "bg-emerald-600 text-white border-emerald-600" : "border-border"}`}
              >
                Yes
              </button>
              <button
                onClick={() => setFulfilled("no")}
                className={`h-7 px-2 text-[11px] rounded border ${fulfilled === "no" ? "bg-amber-600 text-white border-amber-600" : "border-border"}`}
              >
                No
              </button>
            </div>
          </div>

          <Select value={shape || "ALL"} onValueChange={(v) => setShape(v === "ALL" ? "" : v)}>
            <SelectTrigger size="sm" className="h-8 w-[160px] text-xs">
              <SelectValue placeholder="All Shapes" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Shapes</SelectItem>
              {COMMON_SHAPES.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </Section>

      <DataTable<PieceRow>
        columns={columns}
        rows={rows}
        loading={isLoading}
        emptyMessage="No planned pieces match the current filters."
        maxHeight="600px"
        searchable
        searchPlaceholder="Search piece code, case code, lot ID…"
        searchFn={(r, q) => {
          const s = q.toLowerCase();
          return (
            r.pieceCode.toLowerCase().includes(s) ||
            r.caseCode.toLowerCase().includes(s) ||
            (r.optionCode ?? "").toLowerCase().includes(s) ||
            (r.fantasyChildId ?? "").toLowerCase().includes(s) ||
            (r.actualPolishedLotId ?? "").toLowerCase().includes(s)
          );
        }}
        exportable
        exportPermission="plan.export"
        exportFilename="planned-pieces.csv"
        excelExportable
        excelExportFilename="planned-pieces.xlsx"
        pagination
        pageSize={50}
        initialSortKey="pieceCode"
        initialSortDir="asc"
        rowClassName={(r) => (r.fulfilled ? "bg-emerald-50/40 dark:bg-emerald-950/10" : "")}
      />

      <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
        <Package className="h-3 w-3" />
        Pieces highlighted green are fulfilled — linked to an actual polished lot. Use the search box to find a piece by code, case, or lot.
      </div>
    </div>
  );
}
