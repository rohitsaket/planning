import { z } from "zod";
import { db } from "@/lib/db";
import { ok } from "@/lib/api-utils";
import { withApi } from "@/lib/api/with-api";
import { ApiError } from "@/lib/api/errors";
import { LIMITS } from "@/lib/api/rate-limit";

const bodySchema = z.object({
  type: z.string().regex(/^[A-Z0-9_]{1,50}$/),
  title: z.string().trim().min(1).max(120),
  message: z.string().max(500).default(""),
  severity: z.enum(["info", "success", "warning", "error"]).default("info"),
});

// The only way a user can broadcast. The realtime service itself accepts service-token calls only.
export const POST = withApi({ permission: "notification.broadcast", body: bodySchema, rateLimit: LIMITS.broadcast }, async (_req, _ctx, api) => {
  const token = process.env.NOTIFY_SERVICE_TOKEN || "";
  if (token.length < 32) throw new ApiError(503, "BROADCAST_UNAVAILABLE", "Realtime broadcast is not configured.");
  let delivered = 0;
  try {
    const r = await fetch(`${process.env.NOTIFY_INTERNAL_URL || "http://127.0.0.1:3001"}/broadcast`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify(api.body),
      signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) throw new Error(`status ${r.status}`);
    delivered = ((await r.json()) as { delivered?: number }).delivered ?? 0;
  } catch {
    throw new ApiError(502, "BROADCAST_FAILED", "The realtime service did not accept the broadcast.");
  }
  await api.audit(db, { action: "NOTIFICATION_BROADCAST", entity: "Notification", after: { type: api.body.type, title: api.body.title, severity: api.body.severity } });
  return ok({ ok: true, delivered });
});
