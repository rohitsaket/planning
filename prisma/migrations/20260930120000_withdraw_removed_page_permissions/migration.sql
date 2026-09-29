-- The Data Quality Issues page and the Demand Overview page are withdrawn, and with them
-- the permissions that only those pages used: data_quality.read, data_quality.manage,
-- data_quality.export and demand.unlock. Their grants on custom roles go with them
-- (Super Admin is defined in code). Data-quality issues, demand runs and the audit records
-- of earlier unlocks are untouched: synchronization, the demand calculation and the
-- Analysis pages still write and read them.
DELETE FROM "RolePermission" WHERE "permissionCode" IN ('data_quality.read', 'data_quality.manage', 'data_quality.export', 'demand.unlock');
