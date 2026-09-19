import { db } from "@/lib/db";
import { ok, num } from "@/lib/api-utils";
import { NextResponse } from "next/server";

// Approval Queue — plans awaiting approval. POST to approve/reject.
export async function GET() {
  const cases = await db.planningCase.findMany({
    where: { status: { in: ["READY_FOR_REVIEW", "SELECTED", "APPROVAL_PENDING", "REPLAN_REQUIRED"] } },
    include: { rough: true, versions: { include: { options: true } } },
    orderBy: { planningDate: "asc" },
  });
  const rows = cases.map((c) => {
    const opt = c.versions[0]?.options.find((o) => o.id === c.selectedOptionId) ?? c.versions[0]?.options[0] ?? null;
    return {
      id: c.id,
      caseCode: c.caseCode,
      stoneName: c.stoneName,
      stoneType: c.stoneType,
      originalRoughWeight: num(c.originalRoughWeight),
      planner: c.planner,
      planningDate: c.planningDate.toISOString(),
      status: c.status,
      selectedOptionCode: opt?.optionCode ?? null,
      expectedPieces: opt?.expectedPieces ?? 0,
      yieldPct: opt ? num(opt.yieldPct) : 0,
      coveragePct: opt ? num(opt.coveragePct) : 0,
      matchingRequiredPieces: opt?.matchingRequiredPieces ?? 0,
      potentialExcess: opt?.potentialExcess ?? 0,
      validationWarnings: opt?.validationWarnings ?? null,
      approvalComment: c.approvalComment,
    };
  });
  return ok({ rows });
}

// POST body: { caseId, action: "approve"|"reject", approver, comment }
export async function POST(req: Request) {
  const body = await req.json();
  const { caseId, action, approver, comment } = body;
  if (!caseId || !action || !approver) {
    return NextResponse.json({ error: "caseId, action, approver required" }, { status: 400 });
  }
  const c = await db.planningCase.findUnique({
    where: { id: caseId },
    include: { versions: { include: { options: true } } },
  });
  if (!c) return NextResponse.json({ error: "Case not found" }, { status: 404 });
  const opt = c.versions[0]?.options.find((o) => o.id === c.selectedOptionId) ?? c.versions[0]?.options[0];
  if (action === "approve") {
    const updated = await db.planningCase.update({
      where: { id: caseId },
      data: {
        status: "APPROVED",
        approvedBy: approver,
        approvedAt: new Date(),
        approvalComment: comment ?? "Approved",
      },
    });
    if (opt) {
      await db.planOption.update({
        where: { id: opt.id },
        data: { approvalStatus: "APPROVED", approvedBy: approver, approvedAt: new Date() },
      });
    }
    await db.auditLog.create({
      data: { actor: approver, action: "PLAN_APPROVED", entity: "PlanningCase", entityId: caseId, reason: comment ?? "Approved" },
    });
    return ok({ status: "APPROVED", caseId });
  } else if (action === "reject") {
    const updated = await db.planningCase.update({
      where: { id: caseId },
      data: { status: "REJECTED", approvalComment: comment ?? "Rejected" },
    });
    if (opt) {
      await db.planOption.update({
        where: { id: opt.id },
        data: { approvalStatus: "REJECTED", approvedBy: approver, approvedAt: new Date() },
      });
    }
    await db.auditLog.create({
      data: { actor: approver, action: "PLAN_REJECTED", entity: "PlanningCase", entityId: caseId, reason: comment ?? "Rejected" },
    });
    return ok({ status: "REJECTED", caseId });
  }
  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
