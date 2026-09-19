import { db } from "@/lib/db";
import { ok } from "@/lib/api-utils";

// Fantasy Locations
export async function GET() {
  const locs = await db.fantasyLocation.findMany({ include: { department: true }, orderBy: { name: "asc" } });
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
}
