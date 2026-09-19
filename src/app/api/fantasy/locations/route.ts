import { db } from "@/lib/db";
import { ok } from "@/lib/api-utils";
import { withApi, SCAN_MAX, scanned } from "@/lib/api/with-api";

// Fantasy Locations
export const GET = withApi({ permission: "fantasy.read" }, async () => {
  const locs = await db.fantasyLocation.findMany({ take: SCAN_MAX, include: { department: true }, orderBy: { name: "asc" } }).then(scanned);
  return ok({
    rows: locs.map((l) => ({
      id: l.id,
      fantasyLocId: l.fantasyLocId,
      name: l.name,
      department: l.department ? { id: l.department.id, fantasyDeptId: l.department.fantasyDeptId, name: l.department.name } : null,
      country: l.country,
      branch: l.branch,
    })),
  });
});
