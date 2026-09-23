import { db } from "@/lib/db";
import { ok } from "@/lib/api-utils";
import { withApi, qStr } from "@/lib/api/with-api";
import { ApiError } from "@/lib/api/errors";
import { isAuditableEntity } from "@/lib/domain/entity-labels";

export const GET = withApi({ permission: "audit.read" }, async (req: Request) => {
  const url = new URL(req.url);
  // Only a key this build knows reaches the query.
  const entity = qStr(url, "entity", 60);
  if (entity && !isAuditableEntity(entity)) {
    throw new ApiError(400, "BAD_REQUEST", "Query parameter 'entity' is not a recognized record type.");
  }
  const action = qStr(url, "action");
  const actor = qStr(url, "actor");

  const where: Record<string, unknown> = {};
  if (entity) where.entity = entity;
  if (action) where.action = action;
  if (actor) where.actor = actor;

  const logs = await db.auditLog.findMany({ where, orderBy: { timestamp: "desc" }, take: 200 });

  return ok({
    rows: logs.map((l) => ({
      id: l.id,
      actor: l.actor,
      action: l.action,
      entity: l.entity,
      entityId: l.entityId,
      reason: l.reason,
      timestamp: l.timestamp.toISOString(),
      correlationId: l.correlationId,
    })),
  });
});
