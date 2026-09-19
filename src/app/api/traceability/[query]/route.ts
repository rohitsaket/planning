import { db } from "@/lib/db";
import { ok, num } from "@/lib/api-utils";
import { NextResponse } from "next/server";
import { notFound, badRequest } from "@/lib/api/errors";
import { withApi } from "@/lib/api/with-api";

// Traceability — search by any of: Fantasy Rough ID, Kapan, Packet, Stone Name, Planning Case, Plan, Planned Piece, Fantasy Child, Fantasy Polished Lot, Requirement, Order, Customer, Certificate
export const GET = withApi({ permission: "plan.read" }, async (req: Request, { params }: { params: Promise<{ query: string }> }) => {
  const { query: raw } = await params;
  // Next.js has already URL-decoded the segment; decoding again would throw on a literal "%".
  const q = raw.trim();
  if (q.length === 0 || q.length > 100) throw badRequest("Search text must be 1 to 100 characters.");
  // LIKE treats % and _ as wildcards and Prisma does not escape them: make them literals.
  const like = q.replace(/[\\%_]/g, "\\$&");

  // Build tree from any match
  // 1. Try rough by Fantasy Rough ID, Kapan, Packet, Stone Name
  const rough = await db.roughStone.findFirst({
    where: {
      OR: [
        { fantasyRoughId: { contains: like } },
        { kapan: { contains: like } },
        { packet: { contains: like } },
        { stoneName: { contains: like } },
      ],
    },
    include: {
      planningCases: { include: { versions: { include: { options: { include: { pieces: true } } } } } },
      reservations: true,
    },
  });

  let tree: unknown = null;
  if (rough) {
    tree = {
      kind: "ROUGH",
      id: rough.id,
      label: `Rough ${rough.fantasyRoughId} — ${rough.stoneName}`,
      attributes: {
        fantasyRoughId: rough.fantasyRoughId,
        kapan: rough.kapan,
        packet: rough.packet,
        signer: rough.signer,
        stoneType: rough.stoneType,
        roughWeight: num(rough.roughWeight),
        country: rough.country,
        branch: rough.branch,
        fantasyStatus: rough.fantasyStatus,
        planningEligible: rough.planningEligible,
        planningStatus: rough.planningStatus,
      },
      children: rough.planningCases.map((c) => ({
        kind: "PLAN",
        id: c.id,
        label: `Planning Case ${c.caseCode} — v${c.currentVersion} (${c.status})`,
        attributes: {
          caseCode: c.caseCode,
          planner: c.planner,
          planningDate: c.planningDate.toISOString(),
          status: c.status,
          approvedBy: c.approvedBy,
          approvedAt: c.approvedAt?.toISOString() ?? null,
          approvalComment: c.approvalComment,
        },
        children: (c.versions[0]?.options ?? []).map((o) => ({
          kind: "PIECE",
          id: o.id,
          label: `Option ${o.optionNumber} — ${o.expectedPieces} pcs @ ${num(o.yieldPct)}% yield`,
          attributes: {
            optionCode: o.optionCode,
            expectedPieces: o.expectedPieces,
            expectedTotalWeight: num(o.expectedTotalWeight),
            yieldPct: num(o.yieldPct),
            requirementCoverage: o.requirementCoverage,
            coveragePct: num(o.coveragePct),
            approvalStatus: o.approvalStatus,
            selected: o.selected,
          },
          children: o.pieces.map((p) => ({
            kind: "PIECE",
            id: p.id,
            label: `${p.pieceCode} — ${p.expectedShape} ${num(p.expectedWeight)}ct`,
            attributes: {
              pieceCode: p.pieceCode,
              sequence: p.sequence,
              expectedShape: p.expectedShape,
              expectedWeight: num(p.expectedWeight),
              expectedColor: p.expectedColor,
              expectedClarity: p.expectedClarity,
              certificationIntent: p.certificationIntent,
              fantasyChildId: p.fantasyChildId,
              actualPolishedLotId: p.actualPolishedLotId,
              fulfilled: p.fulfilled,
            },
          })),
        })),
      })),
    };
  }

  if (!tree) {
    // Try polished stone
    const polished = await db.polishedStone.findFirst({
      where: {
        OR: [
          { fantasyLotId: { contains: like } },
          { certificate: { contains: like } },
        ],
      },
    });
    if (polished) {
      tree = {
        kind: "POLISHED",
        id: polished.id,
        label: `Polished Lot ${polished.fantasyLotId}`,
        attributes: {
          fantasyLotId: polished.fantasyLotId,
          lab: polished.labNormalized,
          shape: polished.shape,
          weight: num(polished.weight),
          color: polished.color,
          clarity: polished.clarity,
          certificate: polished.certificate,
          planningClass: polished.planningClass,
          country: polished.country,
          branch: polished.branch,
        },
      };
    }
  }

  if (!tree) {
    // Try requirement
    const req = await db.requirement.findFirst({
      where: {
        OR: [
          { requirementCode: { contains: like } },
          { orderNumber: { contains: like } },
          { customerName: { contains: like } },
        ],
      },
      include: { weightBand: true },
    });
    if (req) {
      tree = {
        kind: "REQUIREMENT",
        id: req.id,
        label: `Requirement ${req.requirementCode}`,
        attributes: {
          type: req.type,
          status: req.status,
          customer: req.customerName,
          order: req.orderNumber,
          country: req.country,
          branch: req.branch,
          lab: req.labNormalized,
          shape: req.shape,
          weightBand: req.weightBand?.label,
          requiredQty: req.requiredQty,
          remainingUnplanned: req.remainingUnplanned,
          requirementPriority: req.requirementPriority,
          priorityReason: req.priorityReason,
        },
      };
    }
  }

  if (!tree) {
    throw notFound("Matching entity");
  }

  return ok({ query: q, tree });
});
