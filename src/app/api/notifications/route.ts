import { z } from "zod";
import { db } from "@/lib/db";
import { ok } from "@/lib/api-utils";
import { withApi, idSchema } from "@/lib/api/with-api";

export const GET = withApi({ permission: "notification.read" }, async () => {
  const notifs = await db.notification.findMany({ orderBy: { createdAt: "desc" }, take: 50 });
  return ok({
    rows: notifs.map((n) => ({
      id: n.id,
      type: n.type,
      title: n.title,
      message: n.message,
      severity: n.severity,
      read: n.read,
      createdAt: n.createdAt.toISOString(),
    })),
  });
});

const bodySchema = z.object({ id: idSchema, read: z.boolean().optional() });

export const POST = withApi({ permission: "notification.read", body: bodySchema }, async (_req, _ctx, api) => {
  const n = await db.notification.update({ where: { id: api.body.id }, data: { read: !!api.body.read } });
  return ok({ id: n.id, read: n.read });
});
