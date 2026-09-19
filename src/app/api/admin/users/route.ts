import { z } from "zod";
import { db } from "@/lib/db";
import { ok } from "@/lib/api-utils";
import { withApi, paging, paged, idSchema } from "@/lib/api/with-api";
import { badRequest, conflict, notFound } from "@/lib/api/errors";
import { ROLES, permissionsFor } from "@/lib/auth/permissions";
import { hashPassword, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@/lib/auth/password";
import { revokeAllSessions } from "@/lib/auth/session";

export const GET = withApi({ permission: "user.manage" }, async (_req, _ctx, api) => {
  const p = paging(api.url);
  const users = await db.user.findMany({ orderBy: { username: "asc" }, skip: p.skip, take: p.take });
  return ok(
    paged(
      users.map((u) => ({
        id: u.id,
        name: u.displayName,
        username: u.username,
        email: u.email ?? "",
        role: u.role,
        status: u.status,
        lastActive: u.lastLoginAt?.toISOString() ?? null,
        permissionCount: permissionsFor(u.role).length,
      })),
      p,
    ),
  );
});

const password = z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH);
const bodySchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("create"),
    username: z.string().trim().toLowerCase().min(3).max(50).regex(/^[a-z0-9._-]+$/),
    displayName: z.string().trim().min(1).max(100),
    email: z.string().email().max(200).optional(),
    role: z.enum(ROLES),
    password,
  }),
  z.object({ op: z.literal("setStatus"), id: idSchema, status: z.enum(["ACTIVE", "DISABLED"]) }),
  z.object({ op: z.literal("setRole"), id: idSchema, role: z.enum(ROLES) }),
  z.object({ op: z.literal("resetPassword"), id: idSchema, password }),
]);

export const POST = withApi({ permission: "user.manage", body: bodySchema }, async (_req, _ctx, api) => {
  const b = api.body;
  if (b.op === "create") {
    // Only a Super Admin may mint another Super Admin.
    if (b.role === "SUPER_ADMIN" && api.principal.role !== "SUPER_ADMIN") throw badRequest("Only a Super Admin can assign the Super Admin role.");
    const exists = await db.user.findUnique({ where: { username: b.username } });
    if (exists) throw conflict("USERNAME_TAKEN", "That username already exists.");
    const user = await db.$transaction(async (tx) => {
      const u = await tx.user.create({
        data: { username: b.username, displayName: b.displayName, email: b.email, role: b.role, passwordHash: await hashPassword(b.password) },
      });
      await api.audit(tx, { action: "USER_CREATED", entity: "User", entityId: u.id, after: { username: u.username, role: u.role } });
      return u;
    });
    return ok({ id: user.id, username: user.username, role: user.role, status: user.status });
  }

  const target = await db.user.findUnique({ where: { id: b.id } });
  if (!target) throw notFound("User");
  if (target.role === "SUPER_ADMIN" && api.principal.role !== "SUPER_ADMIN") throw badRequest("Only a Super Admin can change a Super Admin account.");
  if (b.op === "setStatus" && b.status === "DISABLED" && target.id === api.principal.userId) throw badRequest("You cannot disable your own account.");
  if (b.op === "setRole" && b.role === "SUPER_ADMIN" && api.principal.role !== "SUPER_ADMIN") throw badRequest("Only a Super Admin can assign the Super Admin role.");

  await db.$transaction(async (tx) => {
    if (b.op === "setStatus") {
      await tx.user.update({ where: { id: b.id }, data: { status: b.status, failedLoginCount: 0, lockedUntil: null } });
      await api.audit(tx, { action: "USER_STATUS_CHANGE", entity: "User", entityId: b.id, before: { status: target.status }, after: { status: b.status } });
    } else if (b.op === "setRole") {
      await tx.user.update({ where: { id: b.id }, data: { role: b.role } });
      await api.audit(tx, { action: "USER_ROLE_CHANGE", entity: "User", entityId: b.id, before: { role: target.role }, after: { role: b.role } });
    } else {
      await tx.user.update({ where: { id: b.id }, data: { passwordHash: await hashPassword(b.password), failedLoginCount: 0, lockedUntil: null } });
      await api.audit(tx, { action: "USER_PASSWORD_RESET", entity: "User", entityId: b.id });
    }
  });
  // Disabling or resetting a password ends every existing session for that user.
  if (b.op !== "setRole") await revokeAllSessions(b.id);
  return ok({ id: b.id, op: b.op });
});
