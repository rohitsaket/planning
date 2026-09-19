import { db } from "@/lib/db";
import { ok } from "@/lib/api-utils";

// Fantasy Departments
export async function GET() {
  const depts = await db.fantasyDepartment.findMany({ include: { locations: true }, orderBy: { name: "asc" } });
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
}
