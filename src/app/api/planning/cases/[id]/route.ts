import { db } from "@/lib/db";
import { ok, num } from "@/lib/api-utils";
import { NextResponse } from "next/server";
import { notFound } from "@/lib/api/errors";
import { withApi, idSchema } from "@/lib/api/with-api";

export const GET = withApi({ permission: "plan.read" }, async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const id = idSchema.parse((await params).id);
  const c = await db.planningCase.findUnique({
    where: { id },
    include: {
      rough: true,
      reservations: true,
      versions: {
        include: {
          options: {
            include: { pieces: true },
          },
        },
      },
    },
  });
  if (!c) throw notFound("Planning case");

  const versions = c.versions.map((v) => ({
    id: v.id,
    versionNumber: v.versionNumber,
    status: v.status,
    reason: v.reason,
    createdBy: v.createdBy,
    createdAt: v.createdAt.toISOString(),
    supersededAt: v.supersededAt?.toISOString() ?? null,
    options: v.options.map((o) => ({
      id: o.id,
      optionCode: o.optionCode,
      optionNumber: o.optionNumber,
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
  }));

  return ok({
    id: c.id,
    caseCode: c.caseCode,
    rough: c.rough ? {
      id: c.rough.id,
      fantasyRoughId: c.rough.fantasyRoughId,
      kapan: c.rough.kapan,
      packet: c.rough.packet,
      stoneName: c.rough.stoneName,
      signer: c.rough.signer,
      stoneType: c.rough.stoneType,
      roughWeight: num(c.rough.roughWeight),
      country: c.rough.country,
      branch: c.rough.branch,
      fantasyStatus: c.rough.fantasyStatus,
      planningEligible: c.rough.planningEligible,
      planningStatus: c.rough.planningStatus,
    } : null,
    stoneName: c.stoneName,
    kapan: c.kapan,
    packet: c.packet,
    originalRoughWeight: num(c.originalRoughWeight),
    stoneType: c.stoneType,
    planner: c.planner,
    planningDate: c.planningDate.toISOString(),
    status: c.status,
    currentVersion: c.currentVersion,
    selectedOptionId: c.selectedOptionId,
    sourceFile: c.sourceFile,
    approvedBy: c.approvedBy,
    approvedAt: c.approvedAt?.toISOString() ?? null,
    approvalComment: c.approvalComment,
    requirementContext: c.requirementContext,
    reservations: c.reservations.map((r) => ({
      id: r.id, status: r.status, reservedBy: r.reservedBy,
      reservedAt: r.reservedAt.toISOString(), releasedAt: r.releasedAt?.toISOString() ?? null,
    })),
    versions,
  });
});
