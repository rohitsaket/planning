-- The Fantasy Rough page and its API are retired: no authoritative rough-stock source is
-- configured, and the only rough records were seeded. Grants of `rough.read` on custom roles
-- are withdrawn. Roles, users, the RoughStone and RoughReservation history and every audit
-- record are kept; Super Admin is defined in code.
--
-- Each withdrawn grant is first recorded in the audit log with its full original row, so the
-- withdrawal is traceable and down.sql can restore exactly what was removed.
--
-- Safe to run more than once: a second run finds no such grants, so it records and deletes
-- nothing. No other permission is touched.
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
  'Fantasy rough stock permission retired',
  -- Canonical timestamps are UTC, and the column has no time zone.
  NOW() AT TIME ZONE 'UTC',
  '20261004090000_withdraw_rough_read_permission',
  'SUCCESS',
  'SECURITY'
FROM "RolePermission" rp
WHERE rp."permissionCode" = 'rough.read';

DELETE FROM "RolePermission"
WHERE "permissionCode" = 'rough.read';
