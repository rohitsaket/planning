import { db } from "@/lib/db";
import { ok, num } from "@/lib/api-utils";

// Rough Availability — Fantasy rough stock filtered to planning-eligible
export async function GET(req: Request) {
  const url = new URL(req.url);
  const planningStatus = url.searchParams.get("planningStatus");
  const stoneType = url.searchParams.get("stoneType");
  const country = url.searchParams.get("country");
  const eligibleOnly = url.searchParams.get("eligibleOnly") === "true";

  const where: Record<string, unknown> = {};
  if (planningStatus) where.planningStatus = planningStatus;
  if (stoneType) where.stoneType = stoneType;
  if (country) where.country = country;
  if (eligibleOnly) where.planningEligible = true;

  const roughs = await db.roughStone.findMany({
    where,
    orderBy: { lastUpdated: "desc" },
  });

  return ok({
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
      lastMovement: r.lastMovement?.toISOString() ?? null,
      lastUpdated: r.lastUpdated.toISOString(),
    })),
  });
}
