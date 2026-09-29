-- The generic Feature Flags page is retired. Of its settings only the plan approval policy
-- (stored as FeatureFlag "SOD_PLANNER_APPROVER") was ever read by the application; it now has
-- its own place under Users & Access and its own permissions.
--
-- Viewing carries over: roles that could view the settings may view the approval policy.
-- Changing does not: feature_flag.manage toggled settings that had no effect, and carrying it
-- over would silently give those roles the power to switch off separation of duties. That
-- power must be granted explicitly as approval_policy.manage.
UPDATE "RolePermission" SET "permissionCode" = 'approval_policy.read' WHERE "permissionCode" = 'feature_flag.read';
DELETE FROM "RolePermission" WHERE "permissionCode" = 'feature_flag.manage';

-- Settings no code ever read: optional planning dimensions, forecast-driven production
-- orders, automatic cross-country transfers, and a self-approval switch the approval route
-- never consulted. Audit records of past changes to them are untouched.
DELETE FROM "FeatureFlag" WHERE "code" IN ('FF_COLOR_DIMENSION', 'FF_CLARITY_DIMENSION', 'FF_TREATMENT_DIMENSION', 'FF_FORECAST_AUTO_ORDER', 'FF_PLANNER_SELF_APPROVE', 'FF_TRANSFER_AUTO');
