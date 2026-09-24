import { z } from "zod";
import { db } from "@/lib/db";
import { ok } from "@/lib/api-utils";
import { withApi, paging, paged, idSchema } from "@/lib/api/with-api";
import { badRequest, conflict, forbidden, notFound } from "@/lib/api/errors";
import { ROLES, permissionsFor, type Permission } from "@/lib/auth/permissions";
import { hashPassword, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@/lib/auth/password";
import { revokeAllSessions } from "@/lib/auth/session";
import {
  assertSecurityAdminFloor,
  replaceUserRoles,
  resolveAssignableRoles,
} from "@/lib/auth/role-service";
import { resolveEffectiveAccess } from "@/lib/auth/effective-permissions";
import { SCOPE_DIMENSIONS, readEffectiveScope } from "@/lib/auth/access-scope";

export const GET = withApi({ permission: "user.read" }, async (_req, _ctx, api) => {
  const p = paging(api.url);
  // Which countries and labs an account may see is access information in its own right,
  // so it is withheld from a reader who may look at accounts but not at their data scope.
  const canSeeScope = api.principal.permissions.includes("user.scope.read");
  const users = await db.user.findMany({
    orderBy: { username: "asc" },
    skip: p.skip,
    take: p.take,
    include: {
      roleAssignments: {
        include: {
          role: {
            include: {
              permissions: { select: { permissionCode: true } },
            },
          },
        },
      },
    },
  });

  const totalCount = await db.user.count();

  // One query for the page rather than one per user.
  const scopeRows = canSeeScope
    ? await db.userAccessScope.findMany({
      where: { userId: { in: users.map((u) => u.id) } },
      select: { userId: true, dimension: true, value: true },
      orderBy: [{ dimension: "asc" }, { value: "asc" }],
    })
    : [];
  const scopeByUser = new Map<string, { countries: string[]; labs: string[] }>();
  for (const row of scopeRows) {
    const entry = scopeByUser.get(row.userId) ?? { countries: [], labs: [] };
    if (row.dimension === "COUNTRY") entry.countries.push(row.value);
    if (row.dimension === "LAB") entry.labs.push(row.value);
    scopeByUser.set(row.userId, entry);
  }

  const formattedUsers = users.map((u) => {
    const assignedRoles = u.roleAssignments.map((a) => a.role);
    const effective = resolveEffectiveAccess(assignedRoles, u.role);
    const roleCodes = effective.roleCodes.length > 0 ? effective.roleCodes : [u.role];

    return {
      id: u.id,
      name: u.displayName,
      username: u.username,
      email: u.email ?? "",
      role: u.role,
      roles: roleCodes,
      status: u.status,
      lastActive: u.lastLoginAt?.toISOString() ?? null,
      permissionCount: effective.permissions.length,
      permissions: effective.permissions,
      createdAt: u.createdAt.toISOString(),
      mustChangePassword: u.mustChangePassword,
      // An empty list is unrestricted, not "no access". Null means the reader is not
      // authorized to see the scope at all — which is a different statement again.
      accessScope: canSeeScope
        ? {
          countries: scopeByUser.get(u.id)?.countries ?? [],
          labs: scopeByUser.get(u.id)?.labs ?? [],
          unrestricted: (scopeByUser.get(u.id)?.countries.length ?? 0) === 0
            && (scopeByUser.get(u.id)?.labs.length ?? 0) === 0,
        }
        : null,
    };
  });

  return ok({
    rows: formattedUsers,
    // The UI uses this to decide whether to offer scope management at all. It is UX: the
    // POST below makes its own authorization decision regardless of what the UI shows.
    canManageScope: api.principal.permissions.includes("user.scope.assign"),
    canReadScope: canSeeScope,
    scopeDimensions: SCOPE_DIMENSIONS,
    total: totalCount,
    page: p.page,
    pageSize: p.take,
    totalPages: Math.max(1, Math.ceil(totalCount / p.take)),
  });
});

const password = z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH);

const bodySchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("create"),
    username: z.string().trim().toLowerCase().min(3).max(50).regex(/^[a-z0-9._-]+$/),
    displayName: z.string().trim().min(1).max(100),
    email: z.string().email().max(200).optional().or(z.literal("")),
    role: z.string().optional(),
    roles: z.array(z.string()).min(1).optional(),
    password,
  }),
  z.object({
    op: z.literal("update"),
    id: idSchema,
    displayName: z.string().trim().min(1).max(100).optional(),
    email: z.string().email().max(200).optional().or(z.literal("")),
  }),
  z.object({
    op: z.literal("setStatus"),
    id: idSchema,
    status: z.enum(["ACTIVE", "SUSPENDED", "DISABLED"]),
  }),
  z.object({
    op: z.literal("setRole"),
    id: idSchema,
    role: z.string(),
  }),
  z.object({
    op: z.literal("setRoles"),
    id: idSchema,
    roles: z.array(z.string()).min(1),
  }),
  z.object({
    op: z.literal("resetPassword"),
    id: idSchema,
    password,
  }),
  z.object({
    op: z.literal("delete"),
    id: idSchema,
  }),
  z.object({
    op: z.literal("setScope"),
    id: idSchema,
    // The complete intended scope per dimension, not a delta: replacing the set makes the
    // operation idempotent and makes a revocation impossible to forget. An empty array is
    // an explicit grant of unrestricted access to that dimension.
    countries: z.array(z.string().trim().min(1).max(60)).max(200),
    labs: z.array(z.string().trim().min(1).max(60)).max(200),
    reason: z.string().trim().min(1).max(500),
  }),
]);

/**
 * Operation-level permissions.
 */
const OPERATION_PERMISSION = {
  create: "user.create",
  update: "user.update",
  setStatus: "user.status.manage",
  setRole: "user.roles.assign",
  setRoles: "user.roles.assign",
  resetPassword: "user.password.reset",
  delete: "user.status.manage",
  // Deliberately its own permission. Deciding how much of the business an account can
  // read is a data-access boundary, not a consequence of being allowed to edit accounts.
  setScope: "user.scope.assign",
} as const satisfies Record<z.infer<typeof bodySchema>["op"], Permission>;

export const POST = withApi({ permission: "user.read", body: bodySchema }, async (_req, _ctx, api) => {
  const b = api.body;
  if (!api.principal.permissions.includes(OPERATION_PERMISSION[b.op])) throw forbidden();

  if (b.op === "create") {
    const rawRoles = b.roles && b.roles.length > 0 ? b.roles : [b.role || "VIEWER"];
    const hasSuperAdmin = rawRoles.includes("SUPER_ADMIN");
    if (hasSuperAdmin && !api.principal.permissions.includes("user.super_admin.assign")) {
      throw forbidden("Assigning the Super Admin role requires a separate authority.");
    }

    const exists = await db.user.findUnique({ where: { username: b.username } });
    if (exists) throw conflict("USERNAME_TAKEN", "That username already exists.");

    const passwordHash = await hashPassword(b.password);
    const user = await db.$transaction(async (tx) => {
      const assignableRoles = await resolveAssignableRoles(tx, rawRoles);
      const primaryRole = assignableRoles[0]?.code ?? rawRoles[0];

      const u = await tx.user.create({
        data: {
          username: b.username,
          displayName: b.displayName,
          email: b.email && b.email.trim() ? b.email.trim() : null,
          role: primaryRole,
          passwordHash,
          createdByUserId: api.principal.userId,
          passwordChangedAt: new Date(),
        },
      });

      await replaceUserRoles(tx, {
        userId: u.id,
        roles: assignableRoles,
        assignedByUserId: api.principal.userId,
        reason: "Initial roles assigned at account creation",
      });

      await api.audit(tx, {
        action: "USER_CREATED",
        entity: "User",
        entityId: u.id,
        after: { username: u.username, roles: assignableRoles.map((r) => r.code) },
        category: "SECURITY",
      });

      return u;
    });

    return ok({ id: user.id, username: user.username, role: user.role, status: user.status });
  }

  const target = await db.user.findUnique({
    where: { id: b.id },
    include: {
      roleAssignments: {
        include: { role: true },
      },
    },
  });
  if (!target) throw notFound("User");

  const targetHasSuperAdmin =
    target.role === "SUPER_ADMIN" || target.roleAssignments.some((a) => a.role.code === "SUPER_ADMIN");

  if (targetHasSuperAdmin && !api.principal.permissions.includes("user.super_admin.assign")) {
    throw forbidden("Modifying a Super Admin account requires a separate authority.");
  }

  if (b.op === "delete") {
    if (target.id === api.principal.userId) {
      throw badRequest("You cannot delete your own account.");
    }

    await db.$transaction(async (tx) => {
      // Ensure another active security admin remains
      await assertSecurityAdminFloor(tx, { excludingUserId: target.id });

      // Clean up sessions and role assignments before deleting user
      await tx.session.deleteMany({ where: { userId: target.id } });
      await tx.userRole.deleteMany({ where: { userId: target.id } });
      await tx.user.delete({ where: { id: target.id } });

      await api.audit(tx, {
        action: "USER_DELETED",
        entity: "User",
        entityId: target.id,
        before: {
          username: target.username,
          displayName: target.displayName,
          role: target.role,
          status: target.status,
        },
        category: "SECURITY",
      });
    });

    return ok({ id: b.id, op: "delete", deleted: true });
  }

  if (b.op === "update") {
    await db.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: b.id },
        data: {
          displayName: b.displayName ?? target.displayName,
          email: b.email !== undefined ? (b.email.trim() ? b.email.trim() : null) : target.email,
          updatedByUserId: api.principal.userId,
          version: { increment: 1 },
        },
      });

      await api.audit(tx, {
        action: "USER_UPDATED",
        entity: "User",
        entityId: b.id,
        before: { displayName: target.displayName, email: target.email },
        after: { displayName: b.displayName ?? target.displayName, email: b.email },
        category: "SECURITY",
      });
    });

    return ok({ id: b.id, op: "update" });
  }

  if (b.op === "setStatus") {
    if (b.status !== "ACTIVE" && target.id === api.principal.userId) {
      throw badRequest("You cannot deactivate or suspend your own account.");
    }

    await db.$transaction(async (tx) => {
      if (b.status !== "ACTIVE") {
        await assertSecurityAdminFloor(tx, { excludingUserId: target.id });
      }

      await tx.user.update({
        where: { id: b.id },
        data: {
          status: b.status,
          failedLoginCount: 0,
          lockedUntil: null,
          deactivatedAt: b.status === "DISABLED" ? new Date() : null,
          suspendedAt: b.status === "SUSPENDED" ? new Date() : null,
          updatedByUserId: api.principal.userId,
          version: { increment: 1 },
        },
      });

      await api.audit(tx, {
        action: "USER_STATUS_CHANGE",
        entity: "User",
        entityId: b.id,
        before: { status: target.status },
        after: { status: b.status },
        category: "SECURITY",
      });
    });

    const revokedSessions = b.status !== "ACTIVE" ? await revokeAllSessions(b.id) : 0;
    return ok({ id: b.id, op: b.op, status: b.status, revokedSessions });
  }

  if (b.op === "setScope") {
    if (target.id === api.principal.userId) {
      // The same rule as roles: nobody widens their own access.
      throw forbidden("You cannot change your own data access scope.");
    }

    const countries = [...new Set(b.countries)].sort();
    const labs = [...new Set(b.labs)].sort();
    const before = await readEffectiveScope(target.id);

    await db.$transaction(async (tx) => {
      // The stored set is replaced wholesale, so what is written is exactly what was
      // asked for and a value left out is genuinely revoked.
      await tx.userAccessScope.deleteMany({ where: { userId: b.id } });
      const rows = [
        ...countries.map((value) => ({ dimension: "COUNTRY", value })),
        ...labs.map((value) => ({ dimension: "LAB", value })),
      ];
      if (rows.length) {
        await tx.userAccessScope.createMany({
          data: rows.map((r) => ({
            userId: b.id,
            dimension: r.dimension,
            value: r.value,
            reason: b.reason,
            grantedByUserId: api.principal.userId,
          })),
        });
      }

      await api.audit(tx, {
        action: "USER_ACCESS_SCOPE_CHANGE",
        entity: "User",
        entityId: b.id,
        before: { countries: before.countries ?? [], labs: before.labs ?? [] },
        after: { countries, labs },
        reason: b.reason,
        category: "SECURITY",
      });
    });

    // The scope is resolved from the database on every request, so the change takes
    // effect on the target's very next request without revoking their session.
    return ok({
      id: b.id,
      accessScope: { countries, labs, unrestricted: countries.length === 0 && labs.length === 0 },
    });
  }

  if (b.op === "setRole" || b.op === "setRoles") {
    if (target.id === api.principal.userId) {
      throw forbidden("You cannot change your own roles.");
    }

    const requestedRoles = b.op === "setRoles" ? b.roles : [b.role];
    if (requestedRoles.includes("SUPER_ADMIN") && !api.principal.permissions.includes("user.super_admin.assign")) {
      throw forbidden("Only a Super Admin can assign the Super Admin role.");
    }

    await db.$transaction(async (tx) => {
      const assignableRoles = await resolveAssignableRoles(tx, requestedRoles);
      // If this account is a security admin, make sure another remains
      await assertSecurityAdminFloor(tx, { excludingUserId: target.id });

      const primaryRole = assignableRoles[0]?.code ?? requestedRoles[0];
      await tx.user.update({
        where: { id: b.id },
        data: { role: primaryRole, updatedByUserId: api.principal.userId, version: { increment: 1 } },
      });

      await replaceUserRoles(tx, {
        userId: b.id,
        roles: assignableRoles,
        assignedByUserId: api.principal.userId,
        reason: "Roles updated by administrator",
      });

      await api.audit(tx, {
        action: "USER_ROLE_CHANGE",
        entity: "User",
        entityId: b.id,
        before: { role: target.role, roles: target.roleAssignments.map((a) => a.role.code) },
        after: { role: primaryRole, roles: assignableRoles.map((r) => r.code) },
        category: "SECURITY",
      });
    });

    return ok({ id: b.id, op: b.op, roles: requestedRoles });
  }

  // Password reset
  const resetHash = await hashPassword(b.password);
  await db.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: b.id },
      data: {
        passwordHash: resetHash,
        failedLoginCount: 0,
        lockedUntil: null,
        mustChangePassword: true,
        passwordChangedAt: new Date(),
        updatedByUserId: api.principal.userId,
        version: { increment: 1 },
      },
    });

    await api.audit(tx, {
      action: "USER_PASSWORD_RESET",
      entity: "User",
      entityId: b.id,
      after: { mustChangePassword: true },
      category: "SECURITY",
    });
  });

  const revokedSessions = await revokeAllSessions(b.id);
  return ok({ id: b.id, op: "resetPassword", revokedSessions });
});

