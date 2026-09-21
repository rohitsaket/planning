import { randomBytes } from "node:crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { ok } from "@/lib/api-utils";
import { withApi, paging, paged, idSchema, qEnum, reasonSchema } from "@/lib/api/with-api";
import { badRequest, conflict, notFound } from "@/lib/api/errors";
import { ROLES } from "@/lib/auth/permissions";
import { hashPassword } from "@/lib/auth/password";

// Review queue for self-service registration requests. `user.manage` only — the
// same permission that governs every other account operation.

export const GET = withApi({ permission: "user.manage" }, async (_req, _ctx, api) => {
  const p = paging(api.url);
  const status = qEnum(api.url, "status", ["PENDING", "APPROVED", "REJECTED", "ALL"] as const, "PENDING");
  const rows = await db.accessRequest.findMany({
    where: status === "ALL" ? {} : { status },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    skip: p.skip,
    take: p.take,
  });
  const pendingCount = await db.accessRequest.count({ where: { status: "PENDING" } });
  return ok({
    ...paged(
      rows.map((r) => ({
        id: r.id,
        username: r.username,
        displayName: r.displayName,
        email: r.email,
        department: r.department,
        justification: r.justification,
        status: r.status,
        reviewedBy: r.reviewedBy,
        reviewedAt: r.reviewedAt?.toISOString() ?? null,
        decisionNote: r.decisionNote,
        createdAt: r.createdAt.toISOString(),
      })),
      p,
    ),
    pendingCount,
  });
});

const bodySchema = z.discriminatedUnion("op", [
  // The role is chosen here, by a human, at approval time. It is never taken from
  // the request itself — the applicant has no say in their own permissions.
  z.object({ op: z.literal("approve"), id: idSchema, role: z.enum(ROLES), note: z.string().trim().max(500).optional() }),
  z.object({ op: z.literal("reject"), id: idSchema, reason: reasonSchema }),
]);

export const POST = withApi({ permission: "user.manage", body: bodySchema }, async (_req, _ctx, api) => {
  const b = api.body;
  const reqRow = await db.accessRequest.findUnique({ where: { id: b.id } });
  if (!reqRow) throw notFound("Access request");
  if (reqRow.status !== "PENDING") throw conflict("ALREADY_DECIDED", "That request has already been decided.");

  if (b.op === "reject") {
    await db.$transaction(async (tx) => {
      const claimed = await tx.accessRequest.updateMany({
        where: { id: b.id, status: "PENDING" },
        data: { status: "REJECTED", pendingKey: null, reviewedBy: api.principal.username, reviewedByUserId: api.principal.userId, reviewedAt: new Date(), decisionNote: b.reason },
      });
      if (claimed.count !== 1) throw conflict("ALREADY_DECIDED", "That request has already been decided.");
      await api.audit(tx, { action: "ACCESS_REQUEST_REJECTED", entity: "AccessRequest", entityId: b.id, before: { status: "PENDING" }, after: { status: "REJECTED" }, reason: b.reason });
    });
    return ok({ id: b.id, status: "REJECTED" });
  }

  // Approval mints a real account — the same guard the admin create path uses.
  if (b.role === "SUPER_ADMIN" && api.principal.role !== "SUPER_ADMIN") throw badRequest("Only a Super Admin can assign the Super Admin role.");
  if (await db.user.findUnique({ where: { username: reqRow.username }, select: { id: true } })) {
    throw conflict("USERNAME_TAKEN", "An account with that username now exists. Reject this request instead.");
  }

  // Issued once, shown to the approving admin to hand over, and never stored in
  // plaintext. Mirrors `scripts/create-user.ts --generate`.
  const temporaryPassword = randomBytes(18).toString("base64url");
  const passwordHash = await hashPassword(temporaryPassword);

  const user = await db.$transaction(async (tx) => {
    const claimed = await tx.accessRequest.updateMany({ where: { id: b.id, status: "PENDING" }, data: { status: "APPROVED" } });
    if (claimed.count !== 1) throw conflict("ALREADY_DECIDED", "That request has already been decided.");
    const u = await tx.user.create({
      data: { username: reqRow.username, displayName: reqRow.displayName, email: reqRow.email, role: b.role, passwordHash },
    });
    await tx.accessRequest.update({
      where: { id: b.id },
      data: { pendingKey: null, createdUserId: u.id, reviewedBy: api.principal.username, reviewedByUserId: api.principal.userId, reviewedAt: new Date(), decisionNote: b.note ?? null },
    });
    await api.audit(tx, { action: "ACCESS_REQUEST_APPROVED", entity: "AccessRequest", entityId: b.id, before: { status: "PENDING" }, after: { status: "APPROVED", userId: u.id, role: b.role }, reason: b.note ?? null });
    // Second row against the User, so account creation is visible when auditing
    // by entity=User regardless of how the account came about.
    await api.audit(tx, { action: "USER_CREATED", entity: "User", entityId: u.id, after: { username: u.username, role: u.role, via: "ACCESS_REQUEST" } });
    return u;
  });

  return ok({ id: b.id, status: "APPROVED", user: { id: user.id, username: user.username, role: user.role }, temporaryPassword });
});
