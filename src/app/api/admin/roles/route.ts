import { z } from "zod";
import { db } from "@/lib/db";
import { ok } from "@/lib/api-utils";
import { withApi, idSchema } from "@/lib/api/with-api";
import { badRequest, conflict, forbidden, notFound } from "@/lib/api/errors";
import { ROLES, isPermission } from "@/lib/auth/permissions";
import { PERMISSION_AREAS, PERMISSION_CAPABILITIES, PERMISSION_CATALOG } from "@/lib/auth/permission-catalog";
import { isSuperAdmin } from "@/lib/auth/role-service";

interface RoleView {
  id: string;
  code: string;
  name: string;
  description: string | null;
  status: string;
  version: number;
  permissions: string[];
  userCount: number;
  createdAt: string;
}

const ROLE_INCLUDE = { permissions: { select: { permissionCode: true } }, assignments: { select: { userId: true } } } as const;

function toView(r: {
  id: string; code: string; name: string; description: string | null; isSystem: boolean; status: string; version: number; createdAt: Date;
  permissions: Array<{ permissionCode: string }>; assignments: Array<{ userId: string }>;
}): RoleView {
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    description: r.description,
    status: r.status,
    version: r.version,
    permissions: r.permissions.map((p) => p.permissionCode).filter(isPermission).sort(),
    userCount: new Set(r.assignments.map((a) => a.userId)).size,
    createdAt: r.createdAt.toISOString(),
  };
}

export const GET = withApi({ permission: "role.read" }, async (_req, _ctx, api) => {
  const roles = (await db.role.findMany({ where: { isSystem: false }, include: ROLE_INCLUDE, orderBy: { name: "asc" } })).map(toView);
  const superAdmin = isSuperAdmin(api.principal);
  return ok({
    roles,
    total: roles.length,
    catalog: { areas: PERMISSION_AREAS, capabilities: PERMISSION_CAPABILITIES, permissions: PERMISSION_CATALOG },
    canEditPermissions: superAdmin && api.principal.permissions.includes("role.permissions.assign"),
    canManageRoles: api.principal.permissions.includes("role.manage"),
  });
});

const permissionSchema = z.string().refine(isPermission, { message: "Invalid permission code" });
const permissionsSchema = z.array(permissionSchema).max(500);

const bodySchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("createRole"),
    code: z.string().trim().toUpperCase().min(2).max(40).regex(/^[A-Z0-9_]+$/, "Code must contain uppercase letters, numbers, and underscores only"),
    name: z.string().trim().min(2).max(100),
    description: z.string().trim().max(500).optional(),
    permissions: permissionsSchema,
  }),
  z.object({
    op: z.literal("updateRole"),
    id: idSchema,
    version: z.number().int().min(0),
    name: z.string().trim().min(2).max(100).optional(),
    description: z.string().trim().max(500).optional(),
    permissions: permissionsSchema.optional(),
    status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
  }),
]);

const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && [...a].sort().every((v, i) => v === [...b].sort()[i]);

export const POST = withApi({ permission: "role.read", body: bodySchema }, async (_req, _ctx, api) => {
  const b = api.body;
  if (!api.principal.permissions.includes("role.manage")) throw forbidden();
  const touchesPermissions = b.op === "createRole" ? b.permissions.length > 0 : b.permissions !== undefined;
  if (touchesPermissions && !(isSuperAdmin(api.principal) && api.principal.permissions.includes("role.permissions.assign"))) {
    throw forbidden("Only a Super Admin can choose role permissions.");
  }
  const permissions = b.permissions ? Array.from(new Set(b.permissions)).sort() : undefined;

  if (b.op === "createRole") {
    if ((ROLES as readonly string[]).includes(b.code)) throw conflict("ROLE_CODE_EXISTS", `The code ${b.code} is reserved for a system role.`);
    if (await db.role.findUnique({ where: { code: b.code }, select: { id: true } })) throw conflict("ROLE_CODE_EXISTS", `A role with code ${b.code} already exists.`);
    const created = await db.$transaction(async (tx) => {
      const role = await tx.role.create({
        data: { code: b.code, name: b.name, description: b.description || null, isSystem: false, status: "ACTIVE", createdByUserId: api.principal.userId },
      });
      if (permissions && permissions.length > 0) {
        await tx.rolePermission.createMany({
          data: permissions.map((permissionCode) => ({ roleId: role.id, permissionCode, assignedByUserId: api.principal.userId, reason: "Initial permission assignment on role creation" })),
        });
      }
      await api.audit(tx, {
        action: "ROLE_CREATED",
        entity: "Role",
        entityId: role.id,
        after: { code: role.code, name: role.name, permissions: permissions ?? [] },
        category: "SECURITY",
      });
      return tx.role.findUniqueOrThrow({ where: { id: role.id }, include: ROLE_INCLUDE });
    });
    return ok({ role: toView(created), changed: true });
  }

  const target = await db.role.findUnique({ where: { id: b.id }, include: ROLE_INCLUDE });
  if (!target) throw notFound("Role");
  if (target.isSystem) throw badRequest("This role is managed on the server and cannot be changed here.");

  const before = toView(target);
  const next = {
    name: b.name ?? target.name,
    description: b.description !== undefined ? b.description || null : target.description,
    status: b.status ?? target.status,
    permissions: permissions ?? before.permissions,
  };
  if (b.version !== target.version) throw conflict("STALE_ROLE", "This role was changed by someone else since you opened it. Reload it and apply your changes again.");
  if (next.status === "INACTIVE" && target.status !== "INACTIVE" && before.userCount > 0) {
    throw conflict("ROLE_IN_USE", `This role is assigned to ${before.userCount} user(s). Reassign them before retiring it.`);
  }
  if (next.name === target.name && next.description === target.description && next.status === target.status && sameSet(next.permissions, before.permissions)) {
    return ok({ role: before, changed: false });
  }

  const added = next.permissions.filter((p) => !before.permissions.includes(p));
  const removed = before.permissions.filter((p) => !next.permissions.includes(p));
  const updated = await db.$transaction(async (tx) => {
    const claimed = await tx.role.updateMany({
      where: { id: target.id, version: target.version },
      data: { name: next.name, description: next.description, status: next.status, updatedByUserId: api.principal.userId, version: { increment: 1 } },
    });
    if (claimed.count !== 1) throw conflict("STALE_ROLE", "This role was changed by someone else since you opened it. Reload it and apply your changes again.");
    if (removed.length > 0) await tx.rolePermission.deleteMany({ where: { roleId: target.id, permissionCode: { in: removed } } });
    if (added.length > 0) {
      await tx.rolePermission.createMany({
        data: added.map((permissionCode) => ({ roleId: target.id, permissionCode, assignedByUserId: api.principal.userId, reason: "Role permissions changed" })),
      });
    }
    await api.audit(tx, {
      action: added.length > 0 || removed.length > 0 ? "ROLE_PERMISSIONS_CHANGED" : "ROLE_UPDATED",
      entity: "Role",
      entityId: target.id,
      before: { name: target.name, description: target.description, status: target.status, permissions: before.permissions, version: target.version },
      after: { name: next.name, description: next.description, status: next.status, permissions: next.permissions, version: target.version + 1, added, removed, affectedUsers: before.userCount },
      category: "SECURITY",
    });
    return tx.role.findUniqueOrThrow({ where: { id: target.id }, include: ROLE_INCLUDE });
  });
  return ok({ role: toView(updated), changed: true, added, removed, affectedUsers: before.userCount });
});

