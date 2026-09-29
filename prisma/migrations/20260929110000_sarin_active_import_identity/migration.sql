-- Sarin import identity: only active imports are deduplicated (additive, reversible).
--
-- An archived import is history. It keeps its rows, checks and outputs, but it is no
-- longer "the same import" as a new upload of the same file with the same details: before
-- this change the duplicate-identity index covered archived imports too, so re-uploading a
-- file whose import had been archived returned the archived record instead of starting a
-- new one. The index now covers every status except ARCHIVED; an archived import can never
-- return to an active state (the batch guard makes ARCHIVED terminal), so at most one
-- active import per identity remains guaranteed by the database.
--
-- No row is changed. Reversal: down.sql (refuses while an archived import shares its
-- identity with another import, which the previous index could not hold).

DROP INDEX "SarinImportBatch_duplicate_identity_key";
CREATE UNIQUE INDEX "SarinImportBatch_duplicate_identity_key"
  ON "SarinImportBatch" ("sourceFileId", "stoneType", "contractVersion", "country", (COALESCE("labScope", '')), "planningDate")
  WHERE "status" <> 'ARCHIVED';
