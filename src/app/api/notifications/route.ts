import { z } from "zod";
import { db } from "@/lib/db";
import { ok } from "@/lib/api-utils";
import { withApi, idSchema } from "@/lib/api/with-api";
import { notFound } from "@/lib/api/errors";

/**
 * Notification types of the retired legacy planning workflow (plan approval and replanning).
 * Their stored rows are kept as history but are never offered as current, actionable work.
 * Filtered by type only: the type is the one reliable marker of what a row was about.
 */
const RETIRED_NOTIFICATION_TYPES = ["PLAN_APPROVAL_PENDING", "REPLAN_REQUIRED"];
const LIVE = { type: { notIn: RETIRED_NOTIFICATION_TYPES } };

export const GET = withApi({ permission: "notification.read" }, async () => {
  const notifs = await db.notification.findMany({ where: LIVE, orderBy: { createdAt: "desc" }, take: 50 });
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

export const POST = withApi({ permission: "notification.manage", body: bodySchema }, async (_req, _ctx, api) => {
  const read = !!api.body.read;
  const { count } = await db.notification.updateMany({ where: { id: api.body.id, ...LIVE }, data: { read } });
  if (count === 0) throw notFound("Notification");
  return ok({ id: api.body.id, read });
});
