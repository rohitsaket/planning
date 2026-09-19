import { db } from "@/lib/db";
import { ok, num } from "@/lib/api-utils";
import { NextResponse } from "next/server";

// Plan Comparison — flatten all options (across all versions) of a planning case
// into a single options array for side-by-side comparison.
// Spec §47 — do not make the planner inspect Excel manually to compare.
export async function GET(_req: Request, { params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;

  const c = await db.planningCase.findUnique({
    where: { id: caseId },
    include: {
      rough: true,
      versions: {
        orderBy: { versionNumber: "asc" },
        include: {
          options: {
            orderBy: { optionNumber: "asc" },
            include: { pieces: { orderBy: { sequence: "asc" } } },
          },
        },
      },
    },
  });

  if (!c) {
    return NextResponse.json({ error: "Planning case not found" }, { status: 404 });
  }

  // Flatten options across all versions. Each option retains a back-reference to
  // the version it came from so the UI can render the version label alongside
  // the optionCode (e.g., "v2 · OPT-000003").
  const options = c.versions.flatMap((v) =>
    v.options.map((o) => ({
      id: o.id,
      optionCode: o.optionCode,
      optionNumber: o.optionNumber,
      versionNumber: v.versionNumber,
      versionStatus: v.status,
      versionReason: v.reason,
      expectedPieces: o.expectedPieces,
      expectedTotalWeight: num(o.expectedTotalWeight),
      yieldPct: num(o.yieldPct),
      matchingRequiredPieces: o.matchingRequiredPieces,
      requirementCoverage: o.requirementCoverage,
      coveragePct: num(o.coveragePct),
      nonRequiredPieces: o.nonRequiredPieces,
      expectedColor: o.expectedColor,
      expectedClarity: o.expectedClarity,
      certificationIntent: o.certificationIntent,
      potentialExcess: o.potentialExcess,
      validationWarnings: o.validationWarnings,
      selected: o.selected,
      selectedBy: o.selectedBy,
      selectedAt: o.selectedAt?.toISOString() ?? null,
      approvalStatus: o.approvalStatus,
      approvedBy: o.approvedBy,
      approvedAt: o.approvedAt?.toISOString() ?? null,
      pieces: o.pieces.map((p) => ({
        id: p.id,
        pieceCode: p.pieceCode,
        sequence: p.sequence,
        expectedShape: p.expectedShape,
        expectedWeight: num(p.expectedWeight),
        expectedColor: p.expectedColor,
        expectedClarity: p.expectedClarity,
        expectedCategory: p.expectedCategory,
        certificationIntent: p.certificationIntent,
        fulfilled: p.fulfilled,
        actualPolishedLotId: p.actualPolishedLotId,
        fantasyChildId: p.fantasyChildId,
      })),
    })),
  );

  // Summary KPIs across the option set
  const totalOptions = options.length;
  const totalVersions = c.versions.length;
  const selectedOption = options.find((o) => o.id === c.selectedOptionId) ?? options.find((o) => o.selected) ?? null;
  const bestYield = options.length > 0 ? Math.max(...options.map((o) => o.yieldPct)) : 0;
  const bestCoverage = options.length > 0 ? Math.max(...options.map((o) => o.coveragePct)) : 0;
  const avgYield = options.length > 0 ? num(options.reduce((s, o) => s + o.yieldPct, 0) / options.length) : 0;
  const avgCoverage = options.length > 0 ? num(options.reduce((s, o) => s + o.coveragePct, 0) / options.length) : 0;
  const totalExpectedPieces = options.reduce((s, o) => s + o.expectedPieces, 0);
  const totalExcessPieces = options.reduce((s, o) => s + o.potentialExcess, 0);
  const withWarnings = options.filter((o) => !!o.validationWarnings).length;

  return ok({
    caseId: c.id,
    caseCode: c.caseCode,
    stoneName: c.stoneName,
    kapan: c.kapan,
    packet: c.packet,
    stoneType: c.stoneType,
    roughWeight: num(c.originalRoughWeight),
    planner: c.planner,
    planningDate: c.planningDate.toISOString(),
    status: c.status,
    currentVersion: c.currentVersion,
    selectedOptionId: c.selectedOptionId,
    approvedBy: c.approvedBy,
    approvedAt: c.approvedAt?.toISOString() ?? null,
    versions: c.versions.map((v) => ({
      id: v.id,
      versionNumber: v.versionNumber,
      status: v.status,
      reason: v.reason,
      createdBy: v.createdBy,
      createdAt: v.createdAt.toISOString(),
      supersededAt: v.supersededAt?.toISOString() ?? null,
      optionCount: v.options.length,
    })),
    options,
    summary: {
      totalOptions,
      totalVersions,
      bestYield,
      bestCoverage,
      avgYield,
      avgCoverage,
      totalExpectedPieces,
      totalExcessPieces,
      withWarnings,
      selectedOptionCode: selectedOption?.optionCode ?? null,
    },
  });
}
