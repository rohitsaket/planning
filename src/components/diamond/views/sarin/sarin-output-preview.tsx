"use client";

// A preview of one output version, one stone at a time. The stone's identity (Kapan,
// packet, signer, rough weight) is shown once above its plans; the table lists the plans'
// pieces, grouped the way the exported workbook groups them. Every value is the server's
// stored value, and so is each option's yield rank: nothing is recalculated or ranked
// here, and the export is always built on the server, never from this table.

import { useId, useState, type ReactNode } from "react";
import { AlertTriangle, ChevronLeft, ChevronRight } from "lucide-react";
import { useApi } from "@/lib/api-client";
import { Badge } from "@/components/diamond/shared/badges";
import { InfoBanner } from "@/components/diamond/shared/empty-state";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { SARIN_YIELD_RANK_STYLE, type SarinYieldRank } from "@/lib/sarin/yield-rank-style";
import { outputPath, type Paged } from "./sarin-processing";

interface PreviewStone {
  sequence: number;
  stoneName: string;
  kapan: string | null;
  packet: string | null;
  signer: string | null;
  roughWeight: string | null;
  options: number;
  pieces: number;
}
export interface PreviewOption {
  id: string;
  optionSequence: number;
  kind: string;
  additionalGroupOrdinal: number | null;
  pieceCount: number;
  yield: { display: string };
  /** The stone's three highest yields, ranked by the server over all its options. */
  yieldRank: SarinYieldRank | null;
  advisory: string | null;
}
export interface PreviewPiece {
  outputRow: number;
  option: { id: string };
  pieceSequence: number;
  /** The shape the output shows: canonical, or the raw Sarin shape where none is mapped. */
  shape: string;
  shapeResolution: string;
  estimatedWeight: string;
  clarity: string;
  color: string;
  depthPct: string;
  ratio: string;
  width: string;
  length: string;
  depthMm: string;
}

/** Stones hold at most a few dozen pieces; this bound is never reached by a valid stone. */
const PIECE_LIMIT = 500;

const COLUMNS: ReadonlyArray<{ label: string; numeric: boolean }> = [
  { label: "Plan", numeric: true },
  { label: "Plan Type", numeric: false },
  { label: "Piece", numeric: true },
  { label: "Shape", numeric: false },
  { label: "Est. Weight", numeric: true },
  { label: "Clarity", numeric: false },
  { label: "Color", numeric: false },
  { label: "Depth %", numeric: true },
  { label: "Ratio", numeric: true },
  { label: "Width", numeric: true },
  { label: "Length", numeric: true },
  { label: "MM", numeric: true },
  { label: "Yield %", numeric: true },
];

const PLAN_TYPE: Record<string, { short: string; name: string; variant: "default" | "neutral" | "low" | "success" | "advisory" }> = {
  MAIN: { short: "Main", name: "Main plan", variant: "default" },
  ADDITIONAL: { short: "Additional", name: "Additional group", variant: "neutral" },
  MK: { short: "MK", name: "Makeable", variant: "low" },
  SL: { short: "SL", name: "Solace", variant: "neutral" },
  BP: { short: "BP", name: "Best Pair", variant: "success" },
  BT: { short: "BT", name: "Best Twin", variant: "advisory" },
};

export interface PreviewOptionRows {
  option: PreviewOption;
  pieces: PreviewPiece[];
}
export interface PreviewGroup {
  key: string;
  /** Shown as the group's header row; null for rows that need none. */
  label: string | null;
  tint: "none" | "a" | "b";
  options: PreviewOptionRows[];
}

/**
 * The plans of one stone in display groups, in stored output order. Presentation only:
 * no value is derived. Blue and White main plans form one striped block and each
 * additional group its own tinted block; a Pink Makeable is shown together with the
 * Solace that follows it (the same candidate), and each Best Pair and Best Twin stands alone.
 */
export function groupPreviewRows(options: readonly PreviewOption[], pieces: readonly PreviewPiece[]): PreviewGroup[] {
  const piecesOf = new Map<string, PreviewPiece[]>();
  for (const p of pieces) piecesOf.set(p.option.id, [...(piecesOf.get(p.option.id) ?? []), p]);
  const rows = options.map((option) => ({ option, pieces: piecesOf.get(option.id) ?? [] })).filter((r) => r.pieces.length > 0);

  const groups: PreviewGroup[] = [];
  let tinted = 0;
  const nextTint = (): "a" | "b" => (tinted++ % 2 === 0 ? "a" : "b");
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const kind = row.option.kind;
    if (kind === "MAIN") {
      const last = groups[groups.length - 1];
      if (last?.key === "main") last.options.push(row);
      else groups.push({ key: "main", label: null, tint: "none", options: [row] });
      continue;
    }
    if (kind === "ADDITIONAL") {
      const n = row.option.pieceCount;
      const ordinal = row.option.additionalGroupOrdinal;
      groups.push({ key: row.option.id, label: `Additional group${ordinal ? ` ${ordinal}` : ""} · ${n} ${n === 1 ? "piece" : "pieces"}`, tint: nextTint(), options: [row] });
      continue;
    }
    if (kind === "MK" && rows[i + 1]?.option.kind === "SL") {
      groups.push({ key: row.option.id, label: `Makeable + Solace · ${row.pieces[0].shape}`, tint: nextTint(), options: [row, rows[i + 1]] });
      i++;
      continue;
    }
    const name = PLAN_TYPE[kind]?.name ?? kind;
    groups.push({ key: row.option.id, label: kind === "BP" ? `${name} · ${row.pieces.map((p) => p.shape).join(" + ")}` : kind === "BT" ? `${name} · ${row.pieces[0].shape}` : name, tint: nextTint(), options: [row] });
  }
  return groups;
}

export function SarinOutputPreview({ batchId, versionId }: { batchId: string; versionId: string }) {
  const [page, setPage] = useState(1);
  const stones = useApi<Paged<PreviewStone>>(`${outputPath(batchId, versionId)}/stones?pageSize=1&page=${page}`);
  const stone = stones.data?.rows[0] ?? null;
  const total = stones.data?.total ?? 0;

  if (stones.isLoading) return <p className="text-[11px] text-muted-foreground" role="status">Loading preview…</p>;
  if (stones.error) return <InfoBanner variant="critical">The preview could not be loaded.</InfoBanner>;
  if (!stone) return <p className="text-[11px] text-muted-foreground">This output has no stones.</p>;
  return <StonePanel key={stone.sequence} batchId={batchId} versionId={versionId} stone={stone} position={page} total={total} onMove={setPage} />;
}

interface StonePanelProps {
  batchId: string;
  versionId: string;
  stone: PreviewStone;
  position: number;
  total: number;
  onMove: (page: number) => void;
}

function StonePanel({ batchId, versionId, stone, position, total, onMove }: StonePanelProps) {
  const headingId = useId();
  const base = outputPath(batchId, versionId);
  const options = useApi<Paged<PreviewOption>>(`${base}/options?stone=${stone.sequence}&pageSize=${PIECE_LIMIT}`);
  const pieces = useApi<Paged<PreviewPiece>>(`${base}/pieces?stone=${stone.sequence}&pageSize=${PIECE_LIMIT}`);
  const loaded = !!options.data && !!pieces.data;
  const unmapped = pieces.data?.rows.filter((p) => p.shapeResolution === "RAW_PASSTHROUGH").length ?? 0;
  const toReview = options.data?.rows.filter((o) => o.advisory !== null).length ?? 0;

  return (
    <section aria-labelledby={headingId} className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
      <header className="flex flex-col gap-3 border-b border-border px-4 py-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h4 id={headingId} className="text-sm font-semibold tabular-nums" aria-live="polite">
              Stone {position.toLocaleString("en-IN")} of {total.toLocaleString("en-IN")}
            </h4>
            <span className="font-mono text-xs text-muted-foreground">{stone.stoneName}</span>
            {loaded && (unmapped > 0 || toReview > 0) && (
              <span className="flex flex-wrap gap-1.5">
                {unmapped > 0 && (
                  <Badge variant="warning">
                    <AlertTriangle className="mr-0.5 inline h-3 w-3 align-[-2px]" aria-hidden />
                    {unmapped} {unmapped === 1 ? "shape" : "shapes"} not mapped
                  </Badge>
                )}
                {toReview > 0 && <Badge variant="advisory">{toReview} {toReview === 1 ? "item" : "items"} to review</Badge>}
              </span>
            )}
          </div>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-[11px] sm:grid-cols-3 xl:grid-cols-6">
            <StoneFact label="Kapan">{stone.kapan ?? "—"}</StoneFact>
            <StoneFact label="Packet" mono>{stone.packet ?? "—"}</StoneFact>
            <StoneFact label="Signer">{stone.signer ?? "—"}</StoneFact>
            <StoneFact label="Rough weight" numeric>{stone.roughWeight ?? "—"}</StoneFact>
            <StoneFact label="Plans" numeric>{stone.options.toLocaleString("en-IN")}</StoneFact>
            <StoneFact label="Output pieces" numeric>{stone.pieces.toLocaleString("en-IN")}</StoneFact>
          </dl>
        </div>
        <nav className="flex shrink-0 items-center gap-2" aria-label="Preview stones">
          <Button size="sm" variant="outline" className="h-8" disabled={position <= 1} onClick={() => onMove(position - 1)}>
            <ChevronLeft className="mr-0.5 h-3.5 w-3.5" aria-hidden /> Previous Stone
          </Button>
          <Button size="sm" variant="outline" className="h-8" disabled={position >= total} onClick={() => onMove(position + 1)}>
            Next Stone <ChevronRight className="ml-0.5 h-3.5 w-3.5" aria-hidden />
          </Button>
        </nav>
      </header>
      {options.isLoading || pieces.isLoading ? (
        <p className="px-4 py-3 text-[11px] text-muted-foreground" role="status">Loading plans…</p>
      ) : options.error || pieces.error || !options.data || !pieces.data ? (
        <div className="p-3"><InfoBanner variant="critical">The plans of this stone could not be loaded.</InfoBanner></div>
      ) : (
        <>
          {(options.data.hasMore || pieces.data.hasMore) && (
            <div className="p-3"><InfoBanner variant="info">Only part of this stone is shown. The export includes all of it.</InfoBanner></div>
          )}
          <PlanTable stoneName={stone.stoneName} groups={groupPreviewRows(options.data.rows, pieces.data.rows)} />
        </>
      )}
    </section>
  );
}

function StoneFact({ label, children, mono, numeric }: { label: string; children: ReactNode; mono?: boolean; numeric?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn("truncate font-medium text-foreground", mono && "font-mono", numeric && "tabular-nums")}>{children}</dd>
    </div>
  );
}

const TINT = { none: "", a: "bg-sky-50/70 dark:bg-sky-950/20", b: "bg-slate-50 dark:bg-slate-900/40" } as const;
// Vertical rules separate the columns; the first cell of a row (and a full-width group label) has none.
const cellPad = "px-3 py-1.5 border-l border-border/70 first:border-l-0";

/**
 * The only scroll region of the preview is this table's horizontal overflow, used when the
 * page is narrower than the table. The page itself scrolls vertically; nothing nests. The
 * region is positioned so screen-reader-only text in the far columns stays inside it
 * rather than widening the page.
 */
function PlanTable({ stoneName, groups }: { stoneName: string; groups: PreviewGroup[] }) {
  let stripe = 0;
  return (
    <div className="relative overflow-x-auto" role="region" aria-label={`Plans of stone ${stoneName}`} tabIndex={0}>
      <table className="w-full min-w-[880px] border-collapse text-xs tabular-nums">
        <caption className="sr-only">Plans and output pieces of stone {stoneName}</caption>
        <thead className="border-b border-border bg-muted/70 text-[10px] uppercase tracking-wide text-muted-foreground">
          <tr>
            {COLUMNS.map((c) => (
              <th key={c.label} scope="col" className={cn(cellPad, "whitespace-nowrap py-2 font-semibold", c.numeric ? "text-right" : "text-left")}>{c.label}</th>
            ))}
          </tr>
        </thead>
        {groups.map((g) => (
          <tbody key={g.key} className={cn("border-t border-border", TINT[g.tint])}>
            {g.label && (
              <tr>
                <th scope="rowgroup" colSpan={COLUMNS.length} className={cn(cellPad, "pt-2 pb-1 text-left text-[11px] font-semibold text-foreground")}>{g.label}</th>
              </tr>
            )}
            {g.options.flatMap(({ option, pieces }) => {
              const zebra = g.tint === "none" && stripe++ % 2 === 1;
              const type = PLAN_TYPE[option.kind];
              const rank = option.yieldRank ? SARIN_YIELD_RANK_STYLE[option.yieldRank] : null;
              return pieces.map((p, i) => {
                const first = i === 0;
                return (
                  <tr
                    key={p.outputRow}
                    // A ranked option's rows all carry its rank colour; text stays dark on the pastel in either theme.
                    style={rank ? { backgroundColor: `#${rank.fill}` } : undefined}
                    data-yield-rank={option.yieldRank ?? undefined}
                    className={cn("transition-[background-color,filter]", rank ? "text-zinc-900 hover:brightness-95" : "hover:bg-muted/60", !rank && zebra && "bg-muted/30", first && option.id !== g.options[0].option.id && "border-t border-border/50")}
                  >
                    <td className={cn(cellPad, "text-right font-medium")}>{first ? option.optionSequence : ""}</td>
                    <td className={cellPad}>
                      {first && (
                        <Badge variant={type?.variant ?? "default"} className="px-2 shadow-none">
                          <span aria-hidden>{option.kind === "ADDITIONAL" ? `${option.pieceCount} Pcs` : type?.short ?? option.kind}</span>
                          <span className="sr-only">{type?.name ?? option.kind}{option.kind === "ADDITIONAL" ? `, ${option.pieceCount} pieces` : ""}</span>
                        </Badge>
                      )}
                    </td>
                    <td className={cn(cellPad, "whitespace-nowrap text-right text-muted-foreground")}>{option.pieceCount > 1 ? `${p.pieceSequence} of ${option.pieceCount}` : p.pieceSequence}</td>
                    <td className={cn(cellPad, "whitespace-nowrap")}>
                      {p.shape}
                      {p.shapeResolution === "RAW_PASSTHROUGH" && (
                        <span className="ml-1.5 inline-flex items-center text-amber-700 dark:text-amber-400" title="Sarin shape, not mapped">
                          <AlertTriangle className="h-3 w-3" aria-hidden />
                          <span className="sr-only">(Sarin shape, not mapped)</span>
                        </span>
                      )}
                    </td>
                    <td className={cn(cellPad, "text-right")}>{p.estimatedWeight}</td>
                    <td className={cellPad}>{p.clarity}</td>
                    <td className={cellPad}>{p.color}</td>
                    <td className={cn(cellPad, "text-right")}>{p.depthPct}</td>
                    <td className={cn(cellPad, "text-right")}>{p.ratio}</td>
                    <td className={cn(cellPad, "text-right")}>{p.width}</td>
                    <td className={cn(cellPad, "text-right")}>{p.length}</td>
                    <td className={cn(cellPad, "text-right")}>{p.depthMm}</td>
                    <td className={cn(cellPad, "whitespace-nowrap text-right font-semibold")}>
                      {first && (
                        <>
                          {rank && (
                            <span className="mr-1.5 rounded border border-zinc-900/20 bg-white/70 px-1 py-px text-[10px] font-semibold text-zinc-900" title={rank.label}>
                              <span aria-hidden>{rank.short}</span>
                              <span className="sr-only">{rank.label}, </span>
                            </span>
                          )}
                          {`${option.yield.display}%`}
                        </>
                      )}
                    </td>
                  </tr>
                );
              });
            })}
          </tbody>
        ))}
      </table>
    </div>
  );
}
