-- The Business Rules page and its API are withdrawn, and with them the two permissions
-- that only exposed or changed business rules through that API. Their grants on custom
-- roles go with them (built-in roles are defined in code). Business rules themselves,
-- their history and the audit records of earlier changes are untouched: the demand and
-- planning calculations still read them.
DELETE FROM "RolePermission" WHERE "permissionCode" IN ('business_rule.read', 'business_rule.manage');
