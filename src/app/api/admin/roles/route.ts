import { z } from "zod";
import { db } from "@/lib/db";
import { ok } from "@/lib/api-utils";
import { withApi, idSchema } from "@/lib/api/with-api";
import { badRequest, conflict, forbidden, notFound } from "@/lib/api/errors";
import {
  ROLES,
  PERMISSIONS,
  ROLE_PERMISSIONS,
  permissionsFor,
  isPermission,
  type Permission,
} from "@/lib/auth/permissions";
import { assertDelegable } from "@/lib/auth/role-service";

export const GET = withApi({ permission: "role.read" }, async (_req, _ctx, api) => {
  const dbRoles = await db.role.findMany({
    include: {
      permissions: { select: { permissionCode: true } },
      assignments: { select: { userId: true } },
    },
    orderBy: { name: "asc" },
  });

  // Collect unique user counts per role
  const rolesMap = new Map<string, {
    id: string;
    code: string;
    name: string;
    description: string | null;
    isSystem: boolean;
    status: string;
    permissions: string[];
    userCount: number;
    createdAt: string;
  }>();

  for (const r of dbRoles) {
    const userCount = new Set(r.assignments.map((a) => a.userId)).size;
    const permissions = r.isSystem
      ? permissionsFor(r.code)
      : r.permissions.map((p) => p.permissionCode).filter(isPermission);

    rolesMap.set(r.code, {
      id: r.id,
      code: r.code,
      name: r.name,
      description: r.description,
      isSystem: r.isSystem,
      status: r.status,
      permissions,
      userCount,
      createdAt: r.createdAt.toISOString(),
    });
  }

  // Ensure all built-in system roles exist in output even if not in DB yet
  for (const roleCode of ROLES) {
    if (!rolesMap.has(roleCode)) {
      const perms = permissionsFor(roleCode);
      rolesMap.set(roleCode, {
        id: `sys-${roleCode.toLowerCase()}`,
        code: roleCode,
        name: roleCode.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase()),
        description: `Built-in system role for ${roleCode.toLowerCase().replace(/_/g, " ")}.`,
        isSystem: true,
        status: "ACTIVE",
        permissions: perms,
        userCount: 0,
        createdAt: new Date().toISOString(),
      });
    }
  }

  const roleList = Array.from(rolesMap.values()).sort((a, b) => {
    if (a.isSystem && !b.isSystem) return -1;
    if (!a.isSystem && b.isSystem) return 1;
    return a.name.localeCompare(b.name);
  });

  return ok({
    roles: roleList,
    total: roleList.length,
    availablePermissions: PERMISSIONS,
  });
});

const permissionSchema = z.string().refine(isPermission, {
  message: "Invalid permission code",
});

const bodySchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("createRole"),
    code: z
      .string()
      .trim()
      .toUpperCase()
      .min(2)
      .max(40)
      .regex(/^[A-Z0-9_]+$/, "Code must contain uppercase letters, numbers, and underscores only"),
    name: z.string().trim().min(2).max(100),
    description: z.string().trim().max(500).optional(),
    permissions: z.array(permissionSchema),
  }),
  z.object({
    op: z.literal("updateRole"),
    id: idSchema,
    name: z.string().trim().min(2).max(100).optional(),
    description: z.string().trim().max(500).optional(),
    permissions: z.array(permissionSchema).optional(),
    status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
  }),
  z.object({
    op: z.literal("deleteRole"),
    id: idSchema,
  }),
  z.object({
    op: z.literal("setPermissions"),
    id: idSchema,
    permissions: z.array(permissionSchema),
  }),
]);

const OPERATION_PERMISSION = {
  createRole: "role.manage",
  updateRole: "role.manage",
  deleteRole: "role.manage",
  setPermissions: "role.permissions.assign",
} as const satisfies Record<z.infer<typeof bodySchema>["op"], Permission>;

export const POST = withApi({ permission: "role.read", body: bodySchema }, async (_req, _ctx, api) => {
  const b = api.body;
  if (!api.principal.permissions.includes(OPERATION_PERMISSION[b.op])) throw forbidden();

  if (b.op === "createRole") {
    // Check if code conflicts with system role or existing DB role
    if ((ROLES as readonly string[]).includes(b.code)) {
      throw conflict("ROLE_CODE_EXISTS", `The code ${b.code} is reserved for a system role.`);
    }

    const existing = await db.role.findUnique({ where: { code: b.code } });
    if (existing) {
      throw conflict("ROLE_CODE_EXISTS", `A role with code ${b.code} already exists.`);
    }

    // Caller cannot delegate permissions they do not hold unless they are SUPER_ADMIN
    if (api.principal.role !== "SUPER_ADMIN") {
      assertDelegable(api.principal.permissions, b.permissions);
    }

    const created = await db.$transaction(async (tx) => {
      const role = await tx.role.create({
        data: {
          code: b.code,
          name: b.name,
          description: b.description || null,
          isSystem: false,
          status: "ACTIVE",
          createdByUserId: api.principal.userId,
        },
      });

      if (b.permissions.length > 0) {
        await tx.rolePermission.createMany({
          data: b.permissions.map((perm) => ({
            roleId: role.id,
            permissionCode: perm,
            assignedByUserId: api.principal.userId,
            reason: "Initial permission assignment on role creation",
          })),
        });
      }

      await api.audit(tx, {
        action: "ROLE_CREATED",
        entity: "Role",
        entityId: role.id,
        after: { code: role.code, name: role.name, permissions: b.permissions },
        category: "SECURITY",
      });

      return role;
    });

    return ok({
      id: created.id,
      code: created.code,
      name: created.name,
      permissions: b.permissions,
      status: created.status,
    });
  }

  const targetRole = await db.role.findUnique({
    where: { id: b.id },
    include: {
      permissions: true,
      assignments: { select: { userId: true } },
    },
  });

  if (!targetRole) throw notFound("Role");

  if (b.op === "deleteRole") {
    if (targetRole.isSystem) {
      throw badRequest("System roles are built into the platform and cannot be deleted.");
    }

    if (targetRole.assignments.length > 0) {
      throw badRequest(
        `Cannot delete role '${targetRole.name}' because ${targetRole.assignments.length} active user(s) are currently assigned to it. Please reassign those users first.`
      );
    }

    await db.$transaction(async (tx) => {
      await tx.rolePermission.deleteMany({ where: { roleId: targetRole.id } });
      await tx.role.delete({ where: { id: targetRole.id } });

      await api.audit(tx, {
        action: "ROLE_DELETED",
        entity: "Role",
        entityId: targetRole.id,
        before: { code: targetRole.code, name: targetRole.name },
        category: "SECURITY",
      });
    });

    return ok({ id: b.id, op: "deleteRole", deleted: true });
  }

  if (b.op === "updateRole") {
    if (targetRole.isSystem && (b.name || b.permissions)) {
      throw badRequest("System roles have immutable definitions and cannot be edited.");
    }

    if (b.permissions && api.principal.role !== "SUPER_ADMIN") {
      assertDelegable(api.principal.permissions, b.permissions);
    }

    await db.$transaction(async (tx) => {
      await tx.role.update({
        where: { id: b.id },
        data: {
          name: b.name ?? targetRole.name,
          description: b.description !== undefined ? b.description : targetRole.description,
          status: b.status ?? targetRole.status,
          updatedByUserId: api.principal.userId,
          version: { increment: 1 },
        },
      });

      if (b.permissions !== undefined && !targetRole.isSystem) {
        await tx.rolePermission.deleteMany({ where: { roleId: targetRole.id } });
        if (b.permissions.length > 0) {
          await tx.rolePermission.createMany({
            data: b.permissions.map((perm) => ({
              roleId: targetRole.id,
              permissionCode: perm,
              assignedByUserId: api.principal.userId,
              reason: "Permissions updated by administrator",
            })),
          });
        }
      }

      await api.audit(tx, {
        action: "ROLE_UPDATED",
        entity: "Role",
        entityId: targetRole.id,
        before: {
          name: targetRole.name,
          status: targetRole.status,
          permissions: targetRole.permissions.map((p) => p.permissionCode),
        },
        after: {
          name: b.name ?? targetRole.name,
          status: b.status ?? targetRole.status,
          permissions: b.permissions ?? targetRole.permissions.map((p) => p.permissionCode),
        },
        category: "SECURITY",
      });
    });

    return ok({ id: b.id, op: "updateRole" });
  }

  // setPermissions
  if (targetRole.isSystem) {
    throw badRequest("System role permissions are code-defined and cannot be modified.");
  }

  if (api.principal.role !== "SUPER_ADMIN") {
    assertDelegable(api.principal.permissions, b.permissions);
  }

  await db.$transaction(async (tx) => {
    await tx.rolePermission.deleteMany({ where: { roleId: targetRole.id } });
    if (b.permissions.length > 0) {
      await tx.rolePermission.createMany({
        data: b.permissions.map((perm) => ({
          roleId: targetRole.id,
          permissionCode: perm,
          assignedByUserId: api.principal.userId,
          reason: "Role permissions updated",
        })),
      });
    }

    await api.audit(tx, {
      action: "ROLE_PERMISSIONS_CHANGED",
      entity: "Role",
      entityId: targetRole.id,
      before: { permissions: targetRole.permissions.map((p) => p.permissionCode) },
      after: { permissions: b.permissions },
      category: "SECURITY",
    });
  });

  return ok({ id: b.id, op: "setPermissions", permissions: b.permissions });
});
