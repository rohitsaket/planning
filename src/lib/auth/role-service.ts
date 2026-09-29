/**
 * Role assignment and protected-administrator safety — server-only.
 *
 * Two jobs:
 *   1. Turn role codes into assignments inside a caller's transaction, so an account is
 *      never created without the roles it was meant to have.
 *   2. Refuse any change that would leave the installation without a usable security
 *      administrator, using a database-level lock rather than a count-then-write race.
 */

import { Prisma } from "@prisma/client";
import { ApiError } from "@/lib/api/errors";
import { isPermission, permissionsFor, type Permission } from "@/lib/auth/permissions";
import { resolveEffectiveAccess, type AssignedRole } from "@/lib/auth/effective-permissions";

if (typeof window !== "undefined") {
  throw new Error("auth/role-service is server-only and must not be imported by client code.");
}

/**
 * Permissions that, taken together, let someone restore access for everyone else. An
 * installation must keep at least one active account holding all of them, or nobody can
 * repair a mistake through the application.
 */
export const SECURITY_ADMIN_PERMISSIONS: readonly Permission[] = [
  "user.read",
  "user.roles.assign",
  "user.status.manage",
];

/** Minimum number of active security administrators an operation may leave behind. */
export const MIN_SECURITY_ADMINS = 1;

/**
 * Advisory lock key for the last-administrator check. Every path that could reduce the
 * number of security administrators takes this lock first, so two concurrent removals
 * cannot both observe "there is still another one" and both commit.
 */
const SECURITY_ADMIN_LOCK_KEY = BigInt("8123456789012345");

/**
 * Exactly the database capability this service needs, with literal selections so Prisma
 * resolves the payload precisely rather than widening it.
 */
const SECURITY_ADMIN_SELECT = {
  id: true,
  role: true,
  roleAssignments: {
    select: {
      role: {
        select: { code: true, isSystem: true, status: true, permissions: { select: { permissionCode: true } } },
      },
    },
  },
} as const;

const ROLE_SELECT = { id: true, code: true, isSystem: true, status: true } as const;

export interface RoleServiceTx {
  $executeRaw(query: TemplateStringsArray, ...values: unknown[]): Promise<number>;
  user: {
    findMany(args: {
      where: { status: string };
      select: typeof SECURITY_ADMIN_SELECT;
    }): Promise<Array<{ id: string; role: string; roleAssignments: Array<{ role: AssignedRole }> }>>;
  };
  role: {
    findMany(args: { where: { code: { in: string[] } }; select: typeof ROLE_SELECT }): Promise<
      Array<{ id: string; code: string; isSystem: boolean; status: string }>
    >;
  };
  userRole: {
    deleteMany(args: { where: Record<string, unknown> }): Promise<{ count: number }>;
    createMany(args: { data: Array<{ userId: string; roleId: string; assignedByUserId: string | null; reason: string | null }> }): Promise<{ count: number }>;
  };
}

const ROLE_ASSIGNMENT_STATUS: Record<string, number> = { NO_ROLES: 400, UNKNOWN_ROLE: 400, INACTIVE_ROLE: 400, NOT_DELEGABLE: 403, LAST_SECURITY_ADMIN: 409, LAST_SUPER_ADMIN: 409, SUPER_ADMIN_SERVER_ONLY: 403 };

/** A refused role assignment, answered with its own status and code rather than a server error. */
export class RoleAssignmentError extends ApiError {
  constructor(code: keyof typeof ROLE_ASSIGNMENT_STATUS, message: string) {
    super(ROLE_ASSIGNMENT_STATUS[code], code, message);
    this.name = "RoleAssignmentError";
  }
}

/**
 * Resolves role codes to active roles, refusing anything unknown or deactivated.
 * An inactive role can never be assigned, so it cannot silently grant nothing.
 */
export async function resolveAssignableRoles(
  tx: RoleServiceTx,
  roleCodes: readonly string[],
): Promise<Array<{ id: string; code: string; isSystem: boolean }>> {
  const unique = Array.from(new Set(roleCodes));
  if (unique.length === 0) throw new RoleAssignmentError("NO_ROLES", "At least one role is required.");

  const found = await tx.role.findMany({ where: { code: { in: unique } }, select: ROLE_SELECT });

  const missing = unique.filter((c) => !found.some((r) => r.code === c));
  if (missing.length > 0) throw new RoleAssignmentError("UNKNOWN_ROLE", "One or more roles do not exist.");

  const inactive = found.filter((r) => r.status !== "ACTIVE");
  if (inactive.length > 0) throw new RoleAssignmentError("INACTIVE_ROLE", "One or more roles are not active.");

  return found.map(({ id, code, isSystem }) => ({ id, code, isSystem }));
}

/** The permissions a role grants, from code for a system role and from rows otherwise. */
export function permissionsOfRole(role: AssignedRole): Permission[] {
  if (role.status !== "ACTIVE") return [];
  if (role.isSystem) return permissionsFor(role.code);
  return role.permissions.map((p) => p.permissionCode).filter(isPermission);
}

/**
 * Refuses to grant anything the actor does not itself hold.
 *
 * Without this, an administrator who may assign roles could hand someone a role that
 * carries authorities they lack, then sign in as that user — assignment would become a
 * route to every permission in the system.
 */
export function assertDelegable(
  actorPermissions: readonly Permission[],
  grantedPermissions: readonly Permission[],
): void {
  const actor = new Set(actorPermissions);
  const excess = grantedPermissions.filter((p) => !actor.has(p));
  if (excess.length > 0) {
    throw new RoleAssignmentError(
      "NOT_DELEGABLE",
      "You cannot grant access you do not hold yourself.",
    );
  }
}

/**
 * Replaces a user's role set. Idempotent: the same call twice leaves the same rows.
 */
export async function replaceUserRoles(
  tx: RoleServiceTx,
  input: {
    userId: string;
    roles: Array<{ id: string }>;
    assignedByUserId: string;
    reason: string;
  },
): Promise<void> {
  await tx.userRole.deleteMany({ where: { userId: input.userId } });
  await tx.userRole.createMany({
    data: input.roles.map((r) => ({
      userId: input.userId,
      roleId: r.id,
      assignedByUserId: input.assignedByUserId,
      reason: input.reason,
    })),
  });
}

/**
 * Takes the security-administrator lock for this transaction.
 *
 * Held until the transaction ends, so the count below and the write that follows it are
 * one atomic decision rather than a read followed by a hopeful write.
 */
export async function lockSecurityAdminCheck(tx: RoleServiceTx): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${SECURITY_ADMIN_LOCK_KEY}::bigint)`;
}

/** Ids of the active accounts that currently hold every security-administrator permission. */
export async function activeSecurityAdminIds(tx: RoleServiceTx): Promise<string[]> {
  const users = await tx.user.findMany({ where: { status: "ACTIVE" }, select: SECURITY_ADMIN_SELECT });

  return users
    .filter((u) => {
      const access = resolveEffectiveAccess(
        u.roleAssignments.map((a) => a.role),
        u.role,
      );
      const held = new Set(access.permissions);
      return SECURITY_ADMIN_PERMISSIONS.every((p) => held.has(p));
    })
    .map((u) => u.id);
}

/**
 * Refuses an operation that would drop the number of active security administrators
 * below the configured floor.
 *
 * `excludingUserId` is the account the caller is about to disable, suspend or strip:
 * it is removed from the count before the floor is checked.
 */
export async function assertSecurityAdminFloor(
  tx: RoleServiceTx,
  options: { excludingUserId: string },
): Promise<void> {
  await lockSecurityAdminCheck(tx);
  const admins = await activeSecurityAdminIds(tx);
  const remaining = admins.filter((id) => id !== options.excludingUserId);
  if (remaining.length < MIN_SECURITY_ADMINS) {
    throw new RoleAssignmentError(
      "LAST_SECURITY_ADMIN",
      "This would leave the system without an account that can manage access. Grant another account access administration first.",
    );
  }
}

/** True when a Prisma error is a unique-constraint violation. */
export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/** The one built-in role. Its permissions are fixed in code and it cannot be edited. */
export const SUPER_ADMIN_ROLE = "SUPER_ADMIN";

/**
 * Super Admin is managed on the server only (scripts/create-user.ts): no admin API grants
 * it, and no admin API changes the roles of an account that holds it. Suspending or
 * disabling such an account stays possible for a holder of user.super_admin.assign, within
 * the final-Super-Admin floor.
 */
export function assertNotSuperAdminChange(requestedRoleCodes: readonly string[], targetHoldsSuperAdmin = false): void {
  if (requestedRoleCodes.includes(SUPER_ADMIN_ROLE) || targetHoldsSuperAdmin) {
    throw new RoleAssignmentError("SUPER_ADMIN_SERVER_ONLY", "The Super Admin role is managed on the server and cannot be granted or changed here.");
  }
}

/**
 * True when the principal holds an active Super Admin assignment. Read from the resolved
 * role assignments, never from the legacy single-role column.
 */
export const isSuperAdmin = (principal: { roleCodes: readonly string[] }): boolean => principal.roleCodes.includes(SUPER_ADMIN_ROLE);

/**
 * Refuses an operation that would leave no active Super Admin — the final recovery path.
 * `excludingUserId` is the account about to be suspended, disabled or stripped of the
 * role; it is left out of the count. Shares the security-administrator lock, so two
 * concurrent removals cannot both see "there is still another one".
 */
export async function assertSuperAdminFloor(tx: Prisma.TransactionClient, options: { excludingUserId: string }): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${SECURITY_ADMIN_LOCK_KEY}::bigint)`;
  const remaining = await tx.user.count({
    where: {
      status: "ACTIVE",
      id: { not: options.excludingUserId },
      roleAssignments: { some: { role: { code: SUPER_ADMIN_ROLE, status: "ACTIVE" } } },
    },
  });
  if (remaining < 1) {
    throw new RoleAssignmentError("LAST_SUPER_ADMIN", "This would leave no active Super Admin. Make another account a Super Admin first.");
  }
}

/** Everything a set of roles grants, for checking that an assigner may hand them out. */
export async function permissionsGrantedByRoles(tx: Prisma.TransactionClient, roleIds: readonly string[]): Promise<Permission[]> {
  const roles = await tx.role.findMany({
    where: { id: { in: [...roleIds] } },
    select: { code: true, isSystem: true, status: true, permissions: { select: { permissionCode: true } } },
  });
  return Array.from(new Set(roles.flatMap((r) => permissionsOfRole(r))));
}
