import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ok } from "@/lib/api-utils";
import { withApi, log } from "@/lib/api/with-api";

// Self-service registration intake. Public by necessity — the person asking for
// access has no session yet.
//
// This endpoint NEVER creates an account, a password or a role. It only queues a
// request for an administrator, who provisions the User with an explicitly chosen
// role via /api/admin/access-requests. Nobody self-grants permissions.
//
// It is also deliberately uninformative: the response is identical whether the
// username is free, already taken by a real account, or already has a request
// open. An anonymous caller must not be able to probe who exists.

const ACCEPTED = "If the details provided are eligible, an administrator will review the request and contact you.";

// Same username rules the admin create path and scripts/create-user.ts enforce.
const bodySchema = z.object({
  username: z.string().trim().toLowerCase().min(3).max(50).regex(/^[a-z0-9._-]+$/, "Use letters, numbers, dot, underscore or hyphen."),
  displayName: z.string().trim().min(1).max(100),
  email: z.string().trim().email().max(200).optional().or(z.literal("").transform(() => undefined)),
  department: z.string().trim().max(100).optional().or(z.literal("").transform(() => undefined)),
  justification: z.string().trim().min(20, "Describe why access is needed (at least 20 characters).").max(1000),
});

// Tighter than the default write limit, because this is unauthenticated and
// writes rows — but not so tight that it becomes a denial of service on
// registration itself. Without TRUST_PROXY=true, clientIp() returns null and
// every anonymous caller shares ONE bucket, so this ceiling is org-wide: it has
// to clear a realistic burst of genuine sign-ups. Behind the bundled Caddy with
// TRUST_PROXY=true it becomes per-IP and is far stricter in practice.
// The unique pendingKey already blocks repeat spam for a single username.
const rateLimit = { limit: 20, windowMs: 60 * 60_000 };

export const POST = withApi({ public: true, body: bodySchema, rateLimit }, async (_req, _ctx, api) => {
  const b = api.body;

  // Existing account, or an open request, or a fresh one — the caller cannot tell
  // the difference from the outside. Only the server log records which happened.
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
        pendingKey: b.username, // unique while open; cleared on decision
        sourceIp: api.sourceIp,
      },
      select: { id: true },
    });
    log("info", "access_request.created", { requestId: api.requestId, accessRequestId: created.id, sourceIp: api.sourceIp });
  } catch (e) {
    // P2002 = a PENDING request already exists for this username. Same answer.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      log("warn", "access_request.duplicate_pending", { requestId: api.requestId, sourceIp: api.sourceIp });
    } else {
      throw e;
    }
  }

  return ok({ status: "RECEIVED", message: ACCEPTED });
});
