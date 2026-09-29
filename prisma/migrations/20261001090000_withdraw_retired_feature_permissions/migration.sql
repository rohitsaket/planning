-- Forecast models, predictive analytics and realtime broadcasts are withdrawn from the planning
-- utility, and with them the permissions that only they used: forecast.run, forecast.publish,
-- forecast.methodology.read and notification.broadcast. Their grants on custom roles go with
-- them (Super Admin is defined in code). Audit records that mention these permissions, stored
-- forecast models and persisted notifications are untouched.
DELETE FROM "RolePermission" WHERE "permissionCode" IN ('forecast.run', 'forecast.publish', 'forecast.methodology.read', 'notification.broadcast');
