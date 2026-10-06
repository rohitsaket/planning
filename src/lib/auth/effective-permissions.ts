import { isPermission, permissionsFor, type Permission } from "@/lib/auth/permissions";

if (typeof window !== "undefined") {
  throw new Error("auth/effective-permissions is server-only and must not be imported by client code.");
}

export interface AssignedRole {
  readonly code: string;
  readonly isSystem: boolean;
  readonly status: string;
  readonly permissions: readonly { readonly permissionCode: string }[];
}

export interface EffectiveAccess {
  readonly permissions: Permission[];
  readonly roleCodes: string[];
  readonly usedLegacyFallback: boolean;
}

const ACTIVE = "ACTIVE";

export function resolveEffectiveAccess(
  assignedRoles: readonly AssignedRole[],
  legacyRoleCode: string | null,
): EffectiveAccess {
  const active = assignedRoles.filter((r) => r.status === ACTIVE);

  if (active.length === 0) {
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
      granted.push(...permissionsFor(role.code));
    } else {
      for (const { permissionCode } of role.permissions) {
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
