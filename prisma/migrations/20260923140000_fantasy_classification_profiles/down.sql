-- Reverses 20260923140000_fantasy_classification_profiles.
--
-- Destructive: dropping these tables discards the classification profiles and their
-- mappings. Completed demand runs and canonical records reference a profile version, so
-- rolling this back makes those classifications unreproducible. Only run it as part of a
-- deliberate rollback, and only while the legacy hardcoded path has been restored —
-- otherwise the classifier will find no profile and treat everything as NOT_CONFIGURED.

ALTER TABLE "FantasyHoldMapping"         DROP CONSTRAINT IF EXISTS "FantasyHoldMapping_profileId_fkey";
ALTER TABLE "FantasySourceStatusMapping" DROP CONSTRAINT IF EXISTS "FantasySourceStatusMapping_profileId_fkey";

DROP TABLE IF EXISTS "FantasyHoldMapping";
DROP TABLE IF EXISTS "FantasySourceStatusMapping";
DROP TABLE IF EXISTS "FantasyClassificationProfile";
