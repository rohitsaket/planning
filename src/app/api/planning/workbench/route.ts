import { db } from "@/lib/db";
import { ok, num } from "@/lib/api-utils";
import { NextResponse } from "next/server";
import { withApi, qStr, SCAN_MAX, scanned } from "@/lib/api/with-api";

// Planning Workbench — left: priority requirement queue, center: available rough, right: plan possibilities for selected rough
export const GET = withApi({ permission: "plan.read" }, async (req: Request) => {
  const url = new URL(req.url);
  const roughId = qStr(url, "roughId");

  // LEFT — priority requirement queue (top 25 by priority + remainingUnplanned)
  const queue = await db.requirement.findMany({
    where: { remainingUnplanned: { gt: 0 } },
    include: { weightBand: true },
    orderBy: [{ requirementPriority: "asc" }, { remainingUnplanned: "desc" }],
    take: 25,
  });
  const leftQueue = queue.map((r) => ({
    id: r.id,
    requirementCode: r.requirementCode,
    type: r.type,
    customerName: r.customerName,
    country: r.country,
    branch: r.branch,
    lab: r.labNormalized,
    shape: r.shape,
    weightBand: r.weightBand?.label ?? null,
    requiredQty: r.requiredQty,
    remainingUnplanned: r.remainingUnplanned,
    requiredBy: r.requiredBy?.toISOString() ?? null,
    requirementPriority: r.requirementPriority,
    priorityReason: r.priorityReason,
  }));

  // CENTER — available rough (top 20)
  const roughs = await db.roughStone.findMany({
    where: { planningStatus: "AVAILABLE", planningEligible: true },
    take: 20,
    orderBy: { lastUpdated: "desc" },
  });
  const centerRough = roughs.map((r) => ({
    id: r.id,
    fantasyRoughId: r.fantasyRoughId,
    kapan: r.kapan,
    packet: r.packet,
    stoneName: r.stoneName,
    signer: r.signer,
    stoneType: r.stoneType,
    roughWeight: num(r.roughWeight),
    country: r.country,
    branch: r.branch,
    fantasyStatus: r.fantasyStatus,
    planningEligible: r.planningEligible,
  }));

  // RIGHT — plan possibilities for the selected rough
  let rightPlan: unknown = null;
  if (roughId) {
    const cases = await db.planningCase.findMany({ take: SCAN_MAX,
      where: { roughId, status: { in: ["DRAFT", "READY_FOR_REVIEW", "SELECTED", "APPROVAL_PENDING", "APPROVED"] } },
      include: { versions: { include: { options: { include: { pieces: true } } } }, rough: true },
    }).then(scanned);
    rightPlan = cases.map((c) => ({
      id: c.id,
      caseCode: c.caseCode,
      status: c.status,
      planner: c.planner,
      planningDate: c.planningDate.toISOString(),
      options: (c.versions[0]?.options ?? []).map((o) => ({
        id: o.id,
        optionCode: o.optionCode,
        optionNumber: o.optionNumber,
        expectedPieces: o.expectedPieces,
        expectedTotalWeight: num(o.expectedTotalWeight),
        yieldPct: num(o.yieldPct),
        matchingRequiredPieces: o.matchingRequiredPieces,
        requirementCoverage: o.requirementCoverage,
        coveragePct: num(o.coveragePct),
        potentialExcess: o.potentialExcess,
        validationWarnings: o.validationWarnings,
        selected: o.selected,
        approvalStatus: o.approvalStatus,
        pieces: o.pieces.map((p) => ({
          pieceCode: p.pieceCode,
          expectedShape: p.expectedShape,
          expectedWeight: num(p.expectedWeight),
          expectedCategory: p.expectedCategory,
        })),
      })),
    }));
  }

  return ok({ leftQueue, centerRough, rightPlan });
});
