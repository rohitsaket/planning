import { db } from "@/lib/db";
import { ok } from "@/lib/api-utils";

export async function GET() {
  const shapes = await db.shapeMapping.findMany({ orderBy: { rawShape: "asc" } });
  return ok({
    rows: shapes.map((s) => ({
      id: s.id,
      rawShape: s.rawShape,
      normalizedShape: s.normalizedShape,
      category: s.category,
      active: s.active,
    })),
  });
}
