-- Reverses 20260926090000_sarin_import_foundation.
--
-- Drops every Sarin import table, trigger and function this migration created. Run it only
-- as part of a deliberate rollback before any real Sarin data exists: it destroys source
-- files, source rows, validation issues, review decisions and shape-mapping history, and
-- that evidence cannot be recovered afterwards. No pre-existing table is touched, so the
-- rest of the schema is exactly as it was before the migration.

DROP TABLE IF EXISTS "SarinIssueOverride";
DROP TABLE IF EXISTS "SarinValidationIssue";
DROP TABLE IF EXISTS "SarinStoneBlock";
DROP TABLE IF EXISTS "SarinSourceRow";
DROP TABLE IF EXISTS "SarinImportBatch";
DROP TABLE IF EXISTS "SarinShapeMappingRule";
DROP TABLE IF EXISTS "SarinShapeMappingSet";
DROP TABLE IF EXISTS "SarinSourceFileContent";
DROP TABLE IF EXISTS "SarinSourceFile";

DROP FUNCTION IF EXISTS "sarin_issue_override_insert_guard"();
DROP FUNCTION IF EXISTS "sarin_validation_issue_guard"();
DROP FUNCTION IF EXISTS "sarin_issue_has_effective_override"(TEXT);
DROP FUNCTION IF EXISTS "sarin_stone_block_guard"();
DROP FUNCTION IF EXISTS "sarin_source_row_insert_guard"();
DROP FUNCTION IF EXISTS "sarin_assert_batch_accepts_structure"(TEXT);
DROP FUNCTION IF EXISTS "sarin_import_batch_guard"();
DROP FUNCTION IF EXISTS "sarin_shape_mapping_rule_guard"();
DROP FUNCTION IF EXISTS "sarin_shape_mapping_set_guard"();
DROP FUNCTION IF EXISTS "sarin_shape_mapping_set_content_hash"(TEXT);
DROP FUNCTION IF EXISTS "sarin_source_file_requires_content"();
DROP FUNCTION IF EXISTS "sarin_source_file_content_verify"();
DROP FUNCTION IF EXISTS "sarin_reject_delete"();
DROP FUNCTION IF EXISTS "sarin_reject_mutation"();
