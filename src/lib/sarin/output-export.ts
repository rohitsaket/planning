/**
 * CSV export of one immutable Sarin output version: one line per plan piece, in output
 * order, with its option and stone. Every value is the stored value — weights at three
 * decimals, the yield as displayed at two — so the file cannot disagree with the preview.
 *
 * It is transformed Sarin candidate data, never an approved manufacturing plan, and the
 * file says so before its header. Text that a spreadsheet would run as a formula is
 * neutralised by the shared CSV policy. A version larger than the export limit is refused,
 * never cut short. Nothing here is recomputed or ranked.
 *
 * Server-only.
 */

import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/api/errors";
import { scopeWhere, type EffectiveScope } from "@/lib/auth/access-scope";
import { csvSafeCell } from "@/lib/csv-export";
import { formatIST } from "@/lib/fantasy/time";
import { SARIN_OUTPUT_EXPORT_MAX_ROWS } from "@/lib/sarin/output-config";
import { displayYield } from "@/lib/sarin/yield";

if (typeof window !== "undefined") {
  throw new Error("sarin/output-export is server-only and must not be imported by client code.");
}

/** Pieces read per query while the file is built. */
const EXPORT_READ_PAGE = 5000;

export const SARIN_PLAN_CODE_LABELS: Record<string, string> = {
  MAIN: "Main plan",
  ADDITIONAL: "Additional group",
  MK: "Makeable",
  SL: "Solace",
  BP: "Best Pair",
  BT: "Best Twin",
};

/** Column order is part of the file contract: it never depends on the data. */
const HEADER = [
  "Output Row", "Stone Name", "Kapan", "Packet", "Signer", "Packet Type", "Rough Weight (ct)",
  "Option", "Plan Code", "Plan", "Option Pieces", "Option Est. Weight (ct)", "Option Yield %", "Twin Weight Difference (ct)",
  "Piece", "Source Record", "Sarin Shape", "Normalized Shape", "Est. Weight (ct)", "Clarity", "Color",
  "Depth %", "Ratio", "Length", "Width", "Depth (mm)",
] as const;

const d3 = (v: Prisma.Decimal | null) => (v === null ? "" : v.toFixed(3));

export interface SarinOutputExport {
  readonly fileName: string;
  readonly csv: string;
  readonly rows: number;
  readonly versionId: string;
  readonly versionNumber: number;
}

export async function exportOutputVersion(scope: EffectiveScope, batchId: string, versionId: string, maxRows = SARIN_OUTPUT_EXPORT_MAX_ROWS): Promise<SarinOutputExport | null> {
  const version = await db.sarinOutputVersion.findFirst({
    where: { id: versionId, batchId, batch: scopeWhere(scope, { country: null, lab: "labScope" }) as Prisma.SarinImportBatchWhereInput },
    select: {
      id: true, versionNumber: true, status: true, packetType: true, pieceCount: true, generatedAt: true, validationProfileVersion: true, transformProfileVersion: true,
      batch: { select: { planningDate: true } },
    },
  });
  if (!version) return null;
  if (version.pieceCount > maxRows) {
    throw new ApiError(413, "EXPORT_TOO_LARGE", `This output has ${version.pieceCount} pieces, more than the ${maxRows} one export may contain.`);
  }

  // Notices come before the header, so a recipient who only opens the file still learns
  // what it is and which version it came from.
  const lines: string[] = [
    csvSafeCell("Sarin structured output: transformed Sarin candidate data. Not an approved manufacturing plan."),
    csvSafeCell(`Output version ${version.versionNumber} (${version.status === "GENERATED" ? "current" : "superseded"}) · packet type ${version.packetType} · planning date ${version.batch.planningDate.toISOString().slice(0, 10)}`),
    csvSafeCell(`Generated ${formatIST(version.generatedAt)} · ${version.validationProfileVersion} · ${version.transformProfileVersion}`),
    "",
    HEADER.map(csvSafeCell).join(","),
  ];

  let after = 0;
  let rows = 0;
  for (;;) {
    const pieces = await db.sarinPlanPiece.findMany({
      where: { outputVersionId: version.id, outputRowSequence: { gt: after } },
      orderBy: { outputRowSequence: "asc" },
      take: EXPORT_READ_PAGE,
      select: {
        outputRowSequence: true, pieceSequence: true, sourceRowNumber: true, rawShape: true, normalizedShape: true, estimatedWeight: true, clarity: true, color: true,
        depthPct: true, ratio: true, length: true, width: true, depthMm: true,
        planOption: {
          select: {
            optionSequence: true, optionKind: true, pieceCount: true, totalEstimatedWeight: true, yieldPercent: true, pairWeightDifference: true,
            stoneBlock: { select: { stoneNameRaw: true, kapan: true, packet: true, signer: true, roughWeight: true } },
          },
        },
      },
    });
    if (pieces.length === 0) break;
    for (const p of pieces) {
      const o = p.planOption;
      const k = o.stoneBlock;
      lines.push(
        [
          p.outputRowSequence, k.stoneNameRaw, k.kapan ?? "", k.packet ?? "", k.signer ?? "", version.packetType, d3(k.roughWeight),
          o.optionSequence, o.optionKind, SARIN_PLAN_CODE_LABELS[o.optionKind] ?? o.optionKind, o.pieceCount, d3(o.totalEstimatedWeight), displayYield(o.yieldPercent), d3(o.pairWeightDifference),
          p.pieceSequence, p.sourceRowNumber, p.rawShape, p.normalizedShape, d3(p.estimatedWeight), p.clarity, p.color,
          d3(p.depthPct), d3(p.ratio), d3(p.length), d3(p.width), d3(p.depthMm),
        ]
          .map((v) => csvSafeCell(v))
          .join(","),
      );
      rows++;
    }
    after = pieces[pieces.length - 1].outputRowSequence;
  }
  if (rows !== version.pieceCount) throw new Error("export row count does not match the output version");

  return {
    fileName: `sarin-output-v${version.versionNumber}-${version.packetType.toLowerCase()}-${version.batch.planningDate.toISOString().slice(0, 10)}.csv`,
    csv: lines.join("\r\n") + "\r\n",
    rows,
    versionId: version.id,
    versionNumber: version.versionNumber,
  };
}
