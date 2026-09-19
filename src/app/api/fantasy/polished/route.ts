import { db } from "@/lib/db";
import { ok, num } from "@/lib/api-utils";

// Fantasy Polished Stock — read from authoritative Fantasy source (synced locally)
export async function GET(req: Request) {
  const url = new URL(req.url);
  const planningClass = url.searchParams.get("planningClass");
  const lab = url.searchParams.get("lab");
  const shape = url.searchParams.get("shape");
  const country = url.searchParams.get("country");

  const where: Record<string, unknown> = {};
  if (planningClass) where.planningClass = planningClass;
  if (lab) where.labNormalized = lab;
  if (shape) where.shape = shape;
  if (country) where.country = country;

  const stones = await db.polishedStone.findMany({
    where,
    include: { weightBand: true },
    orderBy: { lastUpdated: "desc" },
    take: 500,
  });

  return ok({
    total: stones.length,
    rows: stones.map((s) => ({
      id: s.id,
      fantasyLotId: s.fantasyLotId,
      fantasyDepartmentId: s.fantasyDepartmentId,
      fantasyLocationId: s.fantasyLocationId,
      country: s.country,
      branch: s.branch,
      fantasyStatus: s.fantasyStatus,
      labRaw: s.labRaw,
      labNormalized: s.labNormalized,
      shape: s.shape,
      shapeNormalized: s.shapeNormalized,
      weight: num(s.weight),
      weightBand: s.weightBand?.label ?? null,
      color: s.color,
      clarity: s.clarity,
      certificate: s.certificate,
      treatment: s.treatment,
      planningClass: s.planningClass,
      lastUpdated: s.lastUpdated.toISOString(),
    })),
  });
}
