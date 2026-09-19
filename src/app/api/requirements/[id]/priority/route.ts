import { z } from "zod";
import { db } from "@/lib/db";
import { ok } from "@/lib/api-utils";
import { withApi, idSchema, reasonSchema } from "@/lib/api/with-api";
import { notFound } from "@/lib/api/errors";

const bodySchema = z.object({
  priority: z.enum(["CRITICAL", "HIGH", "NORMAL", "LOW", "WATCH"]),
  reason: reasonSchema,
});

// Override a requirement's priority (manual business-owned classification).
// Body: { priority, reason }. Audit logged with the authenticated user as actor.
export const POST = withApi<{ id: string }, z.infer<typeof bodySchema>>({ permission: "requirement.override", body: bodySchema }, async (_req, { params }, api) => {
  const id = idSchema.parse((await params).id);
  const { priority, reason } = api.body;
  const me = api.principal;

  const updated = await db.$transaction(async (tx) => {
    const before = await tx.requirement.findUnique({ where: { id } });
    if (!before) throw notFound("Requirement");
    const row = await tx.requirement.update({
      where: { id },
      data: { requirementPriority: priority, priorityReason: `[MANUAL OVERRIDE by ${me.username}] ${reason}`, updatedBy: me.username },
    });
    await api.audit(tx, {
      action: "REQUIREMENT_PRIORITY_OVERRIDE",
      entity: "Requirement",
      entityId: id,
      before: { priority: before.requirementPriority, reason: before.priorityReason },
      after: { priority, reason },
      reason,
    });
    return row;
  });

  return ok({
    id: updated.id,
    requirementCode: updated.requirementCode,
    requirementPriority: updated.requirementPriority,
    priorityReason: updated.priorityReason,
    auditLogged: true,
  });
});
