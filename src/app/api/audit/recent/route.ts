import { db } from "@/lib/db";
import { ok } from "@/lib/api-utils";
import { withApi, qInt } from "@/lib/api/with-api";

// Recent audit events for the live activity feed on the dashboard
export const GET = withApi({ permission: "audit.read" }, async (req: Request) => {
  const url = new URL(req.url);
  const limit = qInt(url, "limit", { def: 15, min: 1, max: 50 });
  const logs = await db.auditLog.findMany({
    orderBy: { timestamp: "desc" },
    take: limit,
  });
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
