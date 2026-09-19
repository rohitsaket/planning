import { db } from "@/lib/db";
import { ok } from "@/lib/api-utils";

export async function GET() {
  const flags = await db.featureFlag.findMany({ orderBy: { code: "asc" } });
  return ok({
    rows: flags.map((f) => ({
      id: f.id,
      code: f.code,
      name: f.name,
      enabled: f.enabled,
      description: f.description,
    })),
  });
}

export async function POST(req: Request) {
  const body = await req.json();
  const { id, enabled, actor } = body;
  if (!id) return Response.json({ error: "id required" }, { status: 400 });
  const f = await db.featureFlag.update({ where: { id }, data: { enabled: !!enabled } });
  await db.auditLog.create({
    data: { actor: actor ?? "system", action: "FEATURE_FLAG_TOGGLE", entity: "FeatureFlag", entityId: id, reason: `Flag set to ${enabled}` },
  });
  return ok({ id: f.id, enabled: f.enabled });
}
