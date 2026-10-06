-- Reverses 20261005090000_withdraw_requirement_permissions.
--
-- Restores every withdrawn requirement and order-export grant from the audit record the
-- migration wrote for it, with its original id, assignment time, assigner and reason. Grants
-- whose role has since been removed, or that already exist again, are skipped. The audit
-- records are kept.
--
-- Only meaningful together with a rollback of the application code: this build no longer
-- defines these permissions, so it ignores the restored grants on read. After running this
-- file, delete the migration's row from "_prisma_migrations" so `migrate deploy` applies it
-- again when the retirement is redeployed.
INSERT INTO "RolePermission" ("id", "roleId", "permissionCode", "assignedAt", "assignedByUserId", "reason")
SELECT DISTINCT ON (g."roleId", g."permissionCode")
  g."id", g."roleId", g."permissionCode", g."assignedAt", g."assignedByUserId", g."reason"
FROM (
  SELECT
    (a."before"::json ->> 'id') AS "id",
    (a."before"::json ->> 'roleId') AS "roleId",
    (a."before"::json ->> 'permissionCode') AS "permissionCode",
    (a."before"::json ->> 'assignedAt')::timestamp AS "assignedAt",
    (a."before"::json ->> 'assignedByUserId') AS "assignedByUserId",
    (a."before"::json ->> 'reason') AS "reason",
    a."timestamp"
  FROM "AuditLog" a
  WHERE a."action" = 'ROLE_PERMISSION_WITHDRAWN'
    AND a."correlationId" = '20261005090000_withdraw_requirement_permissions'
) g
WHERE EXISTS (SELECT 1 FROM "Role" r WHERE r."id" = g."roleId")
ORDER BY g."roleId", g."permissionCode", g."timestamp" DESC
ON CONFLICT DO NOTHING;
