-- The Requirements section (Requirement Matrix, Priority Queue, Order Exceptions, Replenishment
-- & Allocation) and its seeded order views are retired: their requirement and order records had
-- no authoritative source, and requirement and order workflows are out of scope for the
-- planning utility. Grants of their permissions on custom roles are withdrawn. Roles, users,
-- the Requirement, RequirementAllocation, SalesOrder, SalesOrderLine and Customer history and
-- every audit record are kept; Super Admin is defined in code. `orders.read` is kept: it still
-- governs the Customers & Orders page's order-source state.
--
-- Each withdrawn grant is first recorded in the audit log with its full original row, so the
-- withdrawal is traceable and down.sql can restore exactly what was removed.
--
-- Safe to run more than once: a second run finds no such grants, so it records and deletes
-- nothing. No other permission is touched, and no replacement is granted.
INSERT INTO "AuditLog" ("id", "actor", "action", "entity", "entityId", "before", "after", "reason", "timestamp", "correlationId", "outcome", "category")
SELECT
  'retire_' || md5(rp."id" || clock_timestamp()::text || random()::text),
  'system.migration',
  'ROLE_PERMISSION_WITHDRAWN',
  'RolePermission',
  rp."roleId",
  json_build_object(
    'id', rp."id",
    'roleId', rp."roleId",
    'permissionCode', rp."permissionCode",
    'assignedAt', rp."assignedAt",
    'assignedByUserId', rp."assignedByUserId",
    'reason', rp."reason"
  )::text,
  NULL,
  'Requirements and order-export permission retired',
  -- Canonical timestamps are UTC, and the column has no time zone.
  NOW() AT TIME ZONE 'UTC',
  '20261005090000_withdraw_requirement_permissions',
  'SUCCESS',
  'SECURITY'
FROM "RolePermission" rp
WHERE rp."permissionCode" IN ('requirement.read', 'requirement.create', 'requirement.override', 'requirement.export', 'orders.export');

DELETE FROM "RolePermission"
WHERE "permissionCode" IN ('requirement.read', 'requirement.create', 'requirement.override', 'requirement.export', 'orders.export');
