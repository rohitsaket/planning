import { db } from "@/lib/db";
import { ok } from "@/lib/api-utils";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const entity = url.searchParams.get("entity");
  const action = url.searchParams.get("action");
  const actor = url.searchParams.get("actor");

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
}
