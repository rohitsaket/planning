import { z } from "zod";
import { db } from "@/lib/db";
import { ok } from "@/lib/api-utils";
import { withApi, idSchema, reasonSchema } from "@/lib/api/with-api";
import { conflict, notFound } from "@/lib/api/errors";

// Statuses from which a replan cannot start. REPLAN_REQUIRED is included so a double
// submit does not burn a second version number.
const NOT_REPLANNABLE = ["CANCELLED", "SUPERSEDED", "REPLAN_REQUIRED"];

const bodySchema = z.object({ reason: reasonSchema });

// Mark a planning case as REPLAN_REQUIRED (e.g., actual output missed requirement category).
// Body: { reason }. The actor is the authenticated user.
export const POST = withApi<{ id: string }, z.infer<typeof bodySchema>>({ permission: "plan.replan", body: bodySchema }, async (_req, { params }, api) => {
  const id = idSchema.parse((await params).id);
  const { reason } = api.body;
  const me = api.principal;

  const updated = await db.$transaction(async (tx) => {
    const before = await tx.planningCase.findUnique({ where: { id } });
    if (!before) throw notFound("Planning case");
    if (NOT_REPLANNABLE.includes(before.status)) {
      throw conflict("INVALID_CASE_STATE", `A case in status ${before.status} cannot be sent for replan.`);
    }
    const newVersionNumber = before.currentVersion + 1;

    // Compare-and-set on the parent row: of two concurrent replans only one can move
    // currentVersion from N to N+1. The unique index on (planningCaseId, versionNumber)
    // is the database-level backstop.
    const claimed = await tx.planningCase.updateMany({
      where: { id, currentVersion: before.currentVersion, status: before.status },
      data: { status: "REPLAN_REQUIRED", currentVersion: newVersionNumber, approvalComment: `[REPLAN by ${me.username}] ${reason}` },
    });
    if (claimed.count !== 1) throw conflict("CONCURRENT_MODIFICATION", "The case changed before the replan completed. Reload and try again.");

    const previous = await tx.planVersion.findUnique({
      where: { planningCaseId_versionNumber: { planningCaseId: id, versionNumber: before.currentVersion } },
    });
    if (previous) {
      await tx.planVersion.update({ where: { id: previous.id }, data: { status: "SUPERSEDED", supersededAt: new Date() } });
    }
    await tx.planVersion.create({
      data: { planningCaseId: id, versionNumber: newVersionNumber, previousVersionId: previous?.id ?? null, reason, status: "DRAFT", createdBy: me.username },
    });
    await api.audit(tx, {
      action: "PLAN_REPLAN",
      entity: "PlanningCase",
      entityId: id,
      before: { status: before.status, version: before.currentVersion },
      after: { status: "REPLAN_REQUIRED", version: newVersionNumber },
      reason,
    });
    return { ...before, status: "REPLAN_REQUIRED", currentVersion: newVersionNumber };
  });

  return ok({ id: updated.id, caseCode: updated.caseCode, status: updated.status, currentVersion: updated.currentVersion, auditLogged: true });
});
