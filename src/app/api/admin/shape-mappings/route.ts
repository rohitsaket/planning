import { db } from "@/lib/db";
import { ok } from "@/lib/api-utils";
import { withApi, SCAN_MAX, scanned } from "@/lib/api/with-api";

export const GET = withApi({ permission: "config.read" }, async () => {
  const shapes = await db.shapeMapping.findMany({ take: SCAN_MAX, orderBy: { rawShape: "asc" } }).then(scanned);
  return ok({
    rows: shapes.map((s) => ({
      id: s.id,
      rawShape: s.rawShape,
      normalizedShape: s.normalizedShape,
      category: s.category,
      active: s.active,
    })),
  });
});
