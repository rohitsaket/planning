import { db } from "@/lib/db";
import { ok } from "@/lib/api-utils";

// Recent audit events for the live activity feed on the dashboard
export async function GET(req: Request) {
  const url = new URL(req.url);
  const limit = Math.min(50, parseInt(url.searchParams.get("limit") || "15", 10));
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
}
