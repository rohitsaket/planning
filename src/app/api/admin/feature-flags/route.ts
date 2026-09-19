import { z } from "zod";
import { db } from "@/lib/db";
import { ok } from "@/lib/api-utils";
import { withApi, idSchema } from "@/lib/api/with-api";
import { notFound } from "@/lib/api/errors";

export const GET = withApi({ permission: "feature_flag.read" }, async () => {
  const flags = await db.featureFlag.findMany({ orderBy: { code: "asc" }, take: 1000 });
  return ok({
    rows: flags.map((f) => ({
      id: f.id,
      code: f.code,
      name: f.name,
      enabled: f.enabled,
      description: f.description,
    })),
  });
});

const bodySchema = z.object({ id: idSchema, enabled: z.boolean() });

export const POST = withApi({ permission: "feature_flag.manage", body: bodySchema }, async (_req, _ctx, api) => {
  const { id, enabled } = api.body;
  const f = await db.$transaction(async (tx) => {
    const before = await tx.featureFlag.findUnique({ where: { id } });
    if (!before) throw notFound("Feature flag");
    const row = await tx.featureFlag.update({ where: { id }, data: { enabled } });
    await api.audit(tx, {
      action: "FEATURE_FLAG_TOGGLE",
      entity: "FeatureFlag",
      entityId: id,
      before: { code: before.code, enabled: before.enabled },
      after: { code: row.code, enabled: row.enabled },
      reason: `Flag set to ${enabled}`,
    });
    return row;
  });
  return ok({ id: f.id, enabled: f.enabled });
});
