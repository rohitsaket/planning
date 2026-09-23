/**
 * Effective permissions for a user — server-only.
 *
 * A user's permissions are the union of the roles assigned to them:
 *
 *   - A **system role** keeps its permissions in application code
 *     (`ROLE_PERMISSIONS`). There is deliberately no second, mutable source of truth
 *     for what a built-in role may do, so an administrator cannot widen `SUPER_ADMIN`
 *     by editing a row.
 *   - A **custom role** keeps its permissions in `RolePermission` rows. Every code is
 *     validated against the application catalogue on write *and* on read, so a row that
 *     names a permission this build does not define contributes nothing.
 *   - An **inactive role** contributes nothing, whichever kind it is.
 *
 * Legacy fallback: while `User.role` still exists, a user with no role assignments
 * resolves through that column. It is a transition path, not a parallel model — the
 * migration backfilled one assignment per account, so the fallback should only be
 * reached by a row written by an unmigrated writer.
 */

import { isPermission, permissionsFor, type Permission } from "@/lib/auth/permissions";

if (typeof window !== "undefined") {
  throw new Error("auth/effective-permissions is server-only and must not be imported by client code.");
}

/** Exactly the shape this resolver needs from a role assignment. */
export interface AssignedRole {
  readonly code: string;
  readonly isSystem: boolean;
  readonly status: string;
  readonly permissions: readonly { readonly permissionCode: string }[];
}

export interface EffectiveAccess {
  /** Deduplicated, sorted, and free of any code this build does not define. */
  readonly permissions: Permission[];
  /** Codes of the active roles that contributed, for display and audit. */
  readonly roleCodes: string[];
  /** True when the result came from the legacy `User.role` column. */
  readonly usedLegacyFallback: boolean;
}

const ACTIVE = "ACTIVE";

/**
 * Resolves effective access from assigned roles, falling back to the legacy column only
 * when a user has no usable assignment at all.
 */
export function resolveEffectiveAccess(
  assignedRoles: readonly AssignedRole[],
  legacyRoleCode: string | null,
): EffectiveAccess {
  const active = assignedRoles.filter((r) => r.status === ACTIVE);

  if (active.length === 0) {
    // No usable assignment. The legacy column is the only remaining evidence of what
    // this account was granted; an unknown value there yields no permissions.
    const legacy = legacyRoleCode ? permissionsFor(legacyRoleCode) : [];
    return {
      permissions: sortUnique(legacy),
      roleCodes: legacy.length > 0 && legacyRoleCode ? [legacyRoleCode] : [],
      usedLegacyFallback: true,
    };
  }

  const granted: Permission[] = [];
  for (const role of active) {
    if (role.isSystem) {
      // Code-defined. An unrecognized code yields nothing, exactly as before.
      granted.push(...permissionsFor(role.code));
    } else {
      for (const { permissionCode } of role.permissions) {
        // A stored code this build does not define is ignored rather than trusted.
        if (isPermission(permissionCode)) granted.push(permissionCode);
      }
    }
  }

  return {
    permissions: sortUnique(granted),
    roleCodes: active.map((r) => r.code).sort(),
    usedLegacyFallback: false,
  };
}

function sortUnique(permissions: readonly Permission[]): Permission[] {
  return Array.from(new Set(permissions)).sort();
}

/** The Prisma selection this resolver needs. Kept beside it so the two cannot drift. */
export const ASSIGNED_ROLE_SELECT = {
  role: {
    select: {
      code: true,
      isSystem: true,
      status: true,
      permissions: { select: { permissionCode: true } },
    },
  },
} as const;
