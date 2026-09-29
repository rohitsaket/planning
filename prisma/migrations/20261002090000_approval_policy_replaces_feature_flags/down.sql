-- Reverses the permission rename. Withdrawn feature_flag.manage grants and the deleted
-- settings rows are not recreated: neither had any effect, and the Audit Log keeps the
-- record of who held and changed them.
UPDATE "RolePermission" SET "permissionCode" = 'feature_flag.read' WHERE "permissionCode" = 'approval_policy.read';
DELETE FROM "RolePermission" WHERE "permissionCode" = 'approval_policy.manage';
