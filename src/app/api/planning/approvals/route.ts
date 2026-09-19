import { db } from "@/lib/db";
import { ok, num } from "@/lib/api-utils";
import { z } from "zod";
import { withApi, idSchema, log } from "@/lib/api/with-api";
import { conflict, forbidden, notFound } from "@/lib/api/errors";

// Approval Queue — plans awaiting approval. POST to approve/reject.
export const GET = withApi({ permission: "plan.read" }, async () => {
  const cases = await db.planningCase.findMany({
    where: { status: { in: ["READY_FOR_REVIEW", "SELECTED", "APPROVAL_PENDING", "REPLAN_REQUIRED"] } },
    include: { rough: true, versions: { include: { options: true } } },
    orderBy: { planningDate: "asc" },
    take: 500,
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
      // True only when the case has an explicitly selected option in its current version.
      hasSelection: !!c.selectedOptionId,
    };
  });
  return ok({ rows });
});

// Statuses from which a case may be approved or rejected. REJECTED, CANCELLED, SUPERSEDED,
// APPROVED, RELEASED and REPLAN_REQUIRED are deliberately absent: a rejected or superseded plan
// can only come back through the explicit replan workflow.
const DECIDABLE = ["READY_FOR_REVIEW", "SELECTED", "APPROVAL_PENDING"];
const SOD_FLAG = "SOD_PLANNER_APPROVER";

const bodySchema = z.object({
  caseId: idSchema,
  action: z.enum(["approve", "reject"]),
  comment: z.string().trim().max(500).optional(),
  // Business reference (not identity): option to approve when the case has no recorded selection.
  optionId: idSchema.optional(),
});

const same = (a: string | null | undefined, b: string) => !!a && a.trim().toLowerCase() === b.trim().toLowerCase();

// POST body: { caseId, action: "approve"|"reject", comment?, optionId? }
// The approver is always the authenticated user; any approver/actor field in the body is ignored.
export const POST = withApi({ permission: "plan.approve", body: bodySchema }, async (_req, _ctx, api) => {
  const { caseId, action, comment, optionId } = api.body;
  const me = api.principal;

  const result = await db.$transaction(async (tx) => {
    const c = await tx.planningCase.findUnique({ where: { id: caseId } });
    if (!c) throw notFound("Planning case");
    if (!DECIDABLE.includes(c.status)) {
      throw conflict("INVALID_CASE_STATE", `A case in status ${c.status} cannot be ${action === "approve" ? "approved" : "rejected"}.`);
    }

    const version = await tx.planVersion.findUnique({
      where: { planningCaseId_versionNumber: { planningCaseId: c.id, versionNumber: c.currentVersion } },
      include: { options: true },
    });
    if (!version || version.status === "SUPERSEDED" || version.supersededAt) {
      throw conflict("VERSION_NOT_CURRENT", "The current plan version is missing or superseded.");
    }

    // Separation of duties — enforced unless the feature flag exists and is switched off.
    const sod = await tx.featureFlag.findUnique({ where: { code: SOD_FLAG } });
    if (sod?.enabled !== false) {
      const authors = [c.planner, version.createdBy];
      if (authors.some((a) => same(a, me.username) || same(a, me.displayName))) {
        throw forbidden("Separation of duties: the planner of a case cannot approve or reject it.");
      }
    }

    const targetId = c.selectedOptionId ?? optionId ?? null;
    const opt = targetId ? version.options.find((o) => o.id === targetId) ?? null : null;
    if (targetId && !opt) throw conflict("OPTION_NOT_IN_CURRENT_VERSION", "The selected option does not belong to the current plan version.");

    if (action === "approve") {
      if (!opt) throw conflict("OPTION_NOT_SELECTED", "Select a plan option before approving this case.");
      if (opt.approvalStatus === "REJECTED") throw conflict("OPTION_REJECTED", "A rejected option cannot be approved. Start a replan instead.");

      const rough = await tx.roughStone.findUnique({ where: { id: c.roughId } });
      if (!rough) throw conflict("ROUGH_MISSING", "The rough stone for this case no longer exists.");
      if (rough.planningStatus === "CANCELLED") throw conflict("ROUGH_UNAVAILABLE", "The rough stone is cancelled.");
      const held = await tx.roughReservation.findUnique({ where: { activeRoughKey: c.roughId } });
      if (held && held.planningCaseId && held.planningCaseId !== c.id) {
        throw conflict("ROUGH_RESERVED_ELSEWHERE", "The rough stone is actively reserved for another planning case.");
      }
      const otherApproved = await tx.planningCase.count({
        where: { roughId: c.roughId, id: { not: c.id }, status: { in: ["APPROVED", "RELEASED", "RELEASED_TO_MANUFACTURING"] } },
      });
      if (otherApproved > 0) throw conflict("ROUGH_ALREADY_PLANNED", "Another approved plan already exists for this rough stone.");
    }

    const now = new Date();
    const newStatus = action === "approve" ? "APPROVED" : "REJECTED";
    // Compare-and-set on status + version: a concurrent decision or replan makes this a no-op.
    const claimed = await tx.planningCase.updateMany({
      where: { id: c.id, status: c.status, currentVersion: c.currentVersion },
      data:
        action === "approve"
          ? { status: newStatus, approvedBy: me.username, approvedAt: now, approvalComment: comment || "Approved", selectedOptionId: opt!.id }
          : { status: newStatus, approvalComment: comment || "Rejected" },
    });
    if (claimed.count !== 1) throw conflict("CONCURRENT_MODIFICATION", "The case changed before this decision completed. Reload and try again.");

    if (opt) {
      await tx.planOption.update({
        where: { id: opt.id },
        data: { approvalStatus: newStatus, approvedBy: me.username, approvedAt: now },
      });
    }
    await api.audit(tx, {
      action: action === "approve" ? "PLAN_APPROVED" : "PLAN_REJECTED",
      entity: "PlanningCase",
      entityId: c.id,
      before: { status: c.status, version: c.currentVersion, selectedOptionId: c.selectedOptionId },
      after: { status: newStatus, version: c.currentVersion, optionId: opt?.id ?? null },
      reason: comment || (action === "approve" ? "Approved" : "Rejected"),
    });
    return newStatus;
  });

  log("info", "plan.decision", { requestId: api.requestId, userId: me.userId, caseId, status: result });
  return ok({ status: result, caseId });
});
