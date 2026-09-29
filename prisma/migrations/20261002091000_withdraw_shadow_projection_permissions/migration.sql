-- The shadow projection of raw Fantasy batches is retired: no screen, synchronization or
-- worker ever started it, and nothing read its output as planning data. Its permissions go
-- with it. The FantasyProjectionRun and FantasyProjectionCandidate tables and their rows are
-- kept as history.
DELETE FROM "RolePermission" WHERE "permissionCode" IN ('fantasy.projection.read', 'fantasy.projection.run', 'fantasy.projection.recover');
