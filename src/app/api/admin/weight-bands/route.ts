import { db } from "@/lib/db";
import { ok, num } from "@/lib/api-utils";
import { withApi, SCAN_MAX, scanned } from "@/lib/api/with-api";

export const GET = withApi({ permission: "config.read" }, async () => {
  const bands = await db.weightBand.findMany({ take: SCAN_MAX, orderBy: { sortOrder: "asc" } }).then(scanned);
  return ok({
    rows: bands.map((b) => ({
      id: b.id,
      code: b.code,
      label: b.label,
      minCt: num(b.minCt),
      maxCt: num(b.maxCt),
      sortOrder: b.sortOrder,
      active: b.active,
    })),
  });
});
