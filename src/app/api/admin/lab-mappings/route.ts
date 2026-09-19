import { db } from "@/lib/db";
import { ok } from "@/lib/api-utils";
import { withApi, SCAN_MAX, scanned } from "@/lib/api/with-api";

export const GET = withApi({ permission: "config.read" }, async () => {
  const labs = await db.labMapping.findMany({ take: SCAN_MAX, orderBy: { rawLab: "asc" } }).then(scanned);
  return ok({
    rows: labs.map((l) => ({
      id: l.id,
      rawLab: l.rawLab,
      normalizedLab: l.normalizedLab,
      active: l.active,
    })),
  });
});
