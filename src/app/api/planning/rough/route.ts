import { db } from "@/lib/db";
import { ok, num } from "@/lib/api-utils";
import { withApi, qStr, paging, paged } from "@/lib/api/with-api";

// Rough Availability — Fantasy rough stock filtered to planning-eligible
export const GET = withApi({ permission: "rough.read" }, async (req: Request) => {
  const url = new URL(req.url);
  const p = paging(url);
  const planningStatus = qStr(url, "planningStatus");
  const stoneType = qStr(url, "stoneType");
  const country = qStr(url, "country");
  const eligibleOnly = qStr(url, "eligibleOnly") === "true";

  const where: Record<string, unknown> = {};
  if (planningStatus) where.planningStatus = planningStatus;
  if (stoneType) where.stoneType = stoneType;
  if (country) where.country = country;
  if (eligibleOnly) where.planningEligible = true;

  const roughs = await db.roughStone.findMany({ skip: p.skip, take: p.take,
    where,
    orderBy: { lastUpdated: "desc" },
  });

  const pg = paged(roughs, p);
  return ok({
    page: pg.page,
    pageSize: pg.pageSize,
    hasMore: pg.hasMore,
    rows: pg.rows.map((r) => ({
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
});
