-- The legacy Planning Workbench, Approval Queue, Rough Reservations and the plan approval
-- policy are retired: they ran only on seed data and no live route enforces their
-- permissions any more. Grants of those codes on custom roles are withdrawn. Roles are kept,
-- Super Admin is defined in code, and audit records that name these codes are untouched, as
-- are the historical planning tables and the stored approval-policy row.
--
-- Each withdrawn grant is first recorded in the audit log with its full original row, so the
-- withdrawal is traceable and down.sql can restore exactly what was removed.
--
-- Safe to run more than once: a second run finds no such grants, so it records and deletes
-- nothing.
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
  'Legacy planning permission retired',
  -- Canonical timestamps are UTC, and the column has no time zone.
  NOW() AT TIME ZONE 'UTC',
  '20261003090000_retire_legacy_planning_permissions',
  'SUCCESS',
  'SECURITY'
FROM "RolePermission" rp
WHERE rp."permissionCode" IN (
  'plan.read', 'plan.create', 'plan.select', 'plan.approve', 'plan.replan', 'plan.export',
  'rough.reserve',
  'approval_policy.read', 'approval_policy.manage',
  'sarin.output.approve'
);

DELETE FROM "RolePermission"
WHERE "permissionCode" IN (
  'plan.read', 'plan.create', 'plan.select', 'plan.approve', 'plan.replan', 'plan.export',
  'rough.reserve',
  'approval_policy.read', 'approval_policy.manage',
  'sarin.output.approve'
);
