import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ok } from "@/lib/api-utils";
import { withApi, log } from "@/lib/api/with-api";

const ACCEPTED = "If the details provided are eligible, an administrator will review the request and contact you.";

const bodySchema = z.object({
  username: z.string().trim().toLowerCase().min(3).max(50).regex(/^[a-z0-9._-]+$/, "Use letters, numbers, dot, underscore or hyphen."),
  displayName: z.string().trim().min(1).max(100),
  email: z.string().trim().email().max(200).optional().or(z.literal("").transform(() => undefined)),
  department: z.string().trim().max(100).optional().or(z.literal("").transform(() => undefined)),
  justification: z.string().trim().min(20, "Describe why access is needed (at least 20 characters).").max(1000),
});

const rateLimit = { limit: 20, windowMs: 60 * 60_000 };

export const POST = withApi({ public: true, body: bodySchema, rateLimit }, async (_req, _ctx, api) => {
  const b = api.body;

  const taken = await db.user.findUnique({ where: { username: b.username }, select: { id: true } });
  if (taken) {
    log("warn", "access_request.username_exists", { requestId: api.requestId, sourceIp: api.sourceIp });
    return ok({ status: "RECEIVED", message: ACCEPTED });
  }

  try {
    const created = await db.accessRequest.create({
      data: {
        username: b.username,
        displayName: b.displayName,
        email: b.email ?? null,
        department: b.department ?? null,
        justification: b.justification,
        status: "PENDING",
        pendingKey: b.username,
        sourceIp: api.sourceIp,
      },
      select: { id: true },
    });
    log("info", "access_request.created", { requestId: api.requestId, accessRequestId: created.id, sourceIp: api.sourceIp });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      log("warn", "access_request.duplicate_pending", { requestId: api.requestId, sourceIp: api.sourceIp });
    } else {
      throw e;
    }
  }

  return ok({ status: "RECEIVED", message: ACCEPTED });
});
