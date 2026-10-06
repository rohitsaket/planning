import { db } from "@/lib/db";
import { ok } from "@/lib/api-utils";
import { withApi, SCAN_MAX, scanned } from "@/lib/api/with-api";

export const GET = withApi({ permission: "config.read" }, async () => {
  const rows = await db.fantasyStatusMapping.findMany({ take: SCAN_MAX, orderBy: { fantasyStatus: "asc" } }).then(scanned);
  return ok({
    rows: rows.map((r) => ({ id: r.id, fantasyStatus: r.fantasyStatus, planningClass: r.planningClass, countsAvailable: r.countsAvailable, updatedAt: r.updatedAt.toISOString() })),
  });
});
