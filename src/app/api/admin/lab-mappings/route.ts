import { db } from "@/lib/db";
import { ok } from "@/lib/api-utils";

export async function GET() {
  const labs = await db.labMapping.findMany({ orderBy: { rawLab: "asc" } });
  return ok({
    rows: labs.map((l) => ({
      id: l.id,
      rawLab: l.rawLab,
      normalizedLab: l.normalizedLab,
      active: l.active,
    })),
  });
}
