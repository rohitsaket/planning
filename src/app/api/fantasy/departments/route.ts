import { db } from "@/lib/db";
import { ok } from "@/lib/api-utils";
import { withApi, SCAN_MAX, scanned } from "@/lib/api/with-api";

// Fantasy Departments
export const GET = withApi({ permission: "fantasy.read" }, async () => {
  const depts = await db.fantasyDepartment.findMany({ take: SCAN_MAX, include: { locations: true }, orderBy: { name: "asc" } }).then(scanned);
  return ok({
    rows: depts.map((d) => ({
      id: d.id,
      fantasyDeptId: d.fantasyDeptId,
      name: d.name,
      country: d.country,
      branch: d.branch,
      type: d.type,
      locations: d.locations.map((l) => ({
        id: l.id, fantasyLocId: l.fantasyLocId, name: l.name, country: l.country, branch: l.branch,
      })),
    })),
  });
});
