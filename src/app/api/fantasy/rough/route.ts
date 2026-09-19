import { db } from "@/lib/db";
import { ok, num } from "@/lib/api-utils";

// Fantasy Rough Stock — read from authoritative Fantasy source (synced locally)
export async function GET(req: Request) {
  const url = new URL(req.url);
  const planningStatus = url.searchParams.get("planningStatus");
  const stoneType = url.searchParams.get("stoneType");
  const country = url.searchParams.get("country");

  const where: Record<string, unknown> = {};
  if (planningStatus) where.planningStatus = planningStatus;
  if (stoneType) where.stoneType = stoneType;
  if (country) where.country = country;

  const roughs = await db.roughStone.findMany({ where, orderBy: { lastUpdated: "desc" } });

  return ok({
    total: roughs.length,
    rows: roughs.map((r) => ({
      id: r.id,
      fantasyRoughId: r.fantasyRoughId,
      kapan: r.kapan,
      packet: r.packet,
      stoneName: r.stoneName,
      signer: r.signer,
      stoneType: r.stoneType,
      roughWeight: num(r.roughWeight),
      country: r.country,
      branch: r.branch,
      fantasyDepartmentId: r.fantasyDepartmentId,
      fantasyLocationId: r.fantasyLocationId,
      fantasyStatus: r.fantasyStatus,
      planningEligible: r.planningEligible,
      planningStatus: r.planningStatus,
      parentRoughId: r.parentRoughId,
      lastMovement: r.lastMovement?.toISOString() ?? null,
      lastUpdated: r.lastUpdated.toISOString(),
    })),
  });
}
