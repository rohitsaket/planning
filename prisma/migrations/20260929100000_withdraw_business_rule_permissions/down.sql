-- Reverses 20260929100000_withdraw_business_rule_permissions.
--
-- Nothing is recreated: the withdrawn permissions no longer exist in the application, so
-- a restored grant would be ignored on read and refused on write. Custom roles that need
-- them again are re-granted through Users & Access once the permissions return.
SELECT 1;
