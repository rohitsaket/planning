import { db } from "@/lib/db";
import { ok, num } from "@/lib/api-utils";
import { withApi, qStr } from "@/lib/api/with-api";

// Fantasy Polished Stock — read from authoritative Fantasy source (synced locally)
export const GET = withApi({ permission: "fantasy.read" }, async (req: Request) => {
  const url = new URL(req.url);
  const planningClass = qStr(url, "planningClass");
  const lab = qStr(url, "lab");
  const shape = qStr(url, "shape");
  const country = qStr(url, "country");
  const q = qStr(url, "q", 100);

  const where: Record<string, unknown> = {};
  if (planningClass) where.planningClass = planningClass;
  if (lab) where.labNormalized = lab;
  if (shape) where.shape = shape;
  if (country) where.country = country;

  if (q) {
    const escaped = q.replace(/[\\%_]/g, "\\$&");
    where.OR = [
      { fantasyLotId: { contains: escaped, mode: "insensitive" } },
      { shape: { contains: escaped, mode: "insensitive" } },
      { shapeNormalized: { contains: escaped, mode: "insensitive" } },
      { color: { contains: escaped, mode: "insensitive" } },
      { clarity: { contains: escaped, mode: "insensitive" } },
      { certificate: { contains: escaped, mode: "insensitive" } },
      { country: { contains: escaped, mode: "insensitive" } },
      { branch: { contains: escaped, mode: "insensitive" } },
      { labRaw: { contains: escaped, mode: "insensitive" } },
      { labNormalized: { contains: escaped, mode: "insensitive" } },
    ];
  }

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
});
