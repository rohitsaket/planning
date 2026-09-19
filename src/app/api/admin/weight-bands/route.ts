import { db } from "@/lib/db";
import { ok, num } from "@/lib/api-utils";

export async function GET() {
  const bands = await db.weightBand.findMany({ orderBy: { sortOrder: "asc" } });
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
}
