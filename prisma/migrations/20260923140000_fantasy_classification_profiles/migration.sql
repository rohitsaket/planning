-- Fantasy classification profiles: versioned status and hold mapping.
--
-- Additive only. Three new tables plus their indexes. `FantasyStatusMapping` is left
-- exactly as it is — its `fantasyStatus` unique constraint cannot express one status per
-- profile, and dropping a constraint would be destructive — so the versioned model lives
-- alongside it. The old table keeps serving the fixture seed and the Sync Monitor
-- "unmapped statuses" tile and is no longer consulted for classification.
--
-- The seed at the end reproduces exactly what the hardcoded logic did for fixture data,
-- so routing the legacy pipeline through the classifier changes no business number.

CREATE TABLE IF NOT EXISTS "FantasyClassificationProfile" (
    "id"              TEXT NOT NULL,
    "code"            TEXT NOT NULL,
    "name"            TEXT NOT NULL,
    "description"     TEXT,
    "applicability"   TEXT NOT NULL,
    "version"         INTEGER NOT NULL DEFAULT 1,
    "isActive"        BOOLEAN NOT NULL DEFAULT true,
    "createdByUserId" TEXT,
    "updatedByUserId" TEXT,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FantasyClassificationProfile_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "FantasyClassificationProfile_code_key" ON "FantasyClassificationProfile"("code");
CREATE INDEX IF NOT EXISTS "FantasyClassificationProfile_isActive_idx" ON "FantasyClassificationProfile"("isActive");
CREATE INDEX IF NOT EXISTS "FantasyClassificationProfile_applicability_idx" ON "FantasyClassificationProfile"("applicability");

CREATE TABLE IF NOT EXISTS "FantasySourceStatusMapping" (
    "id"                 TEXT NOT NULL,
    "profileId"          TEXT NOT NULL,
    "sourceStatus"       TEXT NOT NULL,
    "canonicalLifecycle" TEXT NOT NULL,
    "inventoryClass"     TEXT NOT NULL,
    "countsAvailable"    BOOLEAN NOT NULL DEFAULT false,
    "planningEligible"   BOOLEAN NOT NULL DEFAULT false,
    "terminalState"      BOOLEAN NOT NULL DEFAULT false,
    "reviewRequired"     BOOLEAN NOT NULL DEFAULT false,
    "isActive"           BOOLEAN NOT NULL DEFAULT true,
    "notes"              TEXT,
    "createdByUserId"    TEXT,
    "updatedByUserId"    TEXT,
    "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"          TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FantasySourceStatusMapping_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "FantasySourceStatusMapping_profileId_sourceStatus_key" ON "FantasySourceStatusMapping"("profileId", "sourceStatus");
CREATE INDEX IF NOT EXISTS "FantasySourceStatusMapping_profileId_isActive_idx" ON "FantasySourceStatusMapping"("profileId", "isActive");

CREATE TABLE IF NOT EXISTS "FantasyHoldMapping" (
    "id"              TEXT NOT NULL,
    "profileId"       TEXT NOT NULL,
    "sourceValue"     TEXT NOT NULL,
    "holdState"       TEXT NOT NULL,
    "isActive"        BOOLEAN NOT NULL DEFAULT true,
    "notes"           TEXT,
    "createdByUserId" TEXT,
    "updatedByUserId" TEXT,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FantasyHoldMapping_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "FantasyHoldMapping_profileId_sourceValue_key" ON "FantasyHoldMapping"("profileId", "sourceValue");
CREATE INDEX IF NOT EXISTS "FantasyHoldMapping_profileId_isActive_idx" ON "FantasyHoldMapping"("profileId", "isActive");

-- Mappings are referenced by completed calculations through their profile version, so a
-- profile that is in use cannot be deleted out from under them.
ALTER TABLE "FantasySourceStatusMapping"
    ADD CONSTRAINT "FantasySourceStatusMapping_profileId_fkey"
    FOREIGN KEY ("profileId") REFERENCES "FantasyClassificationProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "FantasyHoldMapping"
    ADD CONSTRAINT "FantasyHoldMapping_profileId_fkey"
    FOREIGN KEY ("profileId") REFERENCES "FantasyClassificationProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Seed: the legacy fixture profile
--
-- Reproduces the behaviour the hardcoded logic had, so fixture parity is preserved:
--   STOCK  -> physically available and planning eligible  (was: "PHYSICAL")
--   MEMO   -> memo, advisory only                         (was: "MEMO")
-- and adds the states the mirror gate and demand bucketing already recognised
-- (RESERVED, the WIP stages, and the terminal states) so they are classified rather
-- than silently falling through to memo.
--
-- SIMULATION_ONLY: this is the vocabulary the application's own fixture provider emits.
-- It is not the Fantasy vocabulary and may never classify live data.
-- ---------------------------------------------------------------------------

INSERT INTO "FantasyClassificationProfile" ("id", "code", "name", "description", "applicability", "version", "isActive", "createdAt", "updatedAt")
VALUES (
  'fcp_legacy_fixture',
  'LEGACY_FIXTURE',
  'Legacy fixture simulation',
  'Status and hold vocabulary emitted by the built-in fixture provider. Simulation only: the real Fantasy status vocabulary and hold encoding are unconfirmed.',
  'SIMULATION_ONLY',
  1,
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "FantasySourceStatusMapping"
  ("id", "profileId", "sourceStatus", "canonicalLifecycle", "inventoryClass", "countsAvailable", "planningEligible", "terminalState", "reviewRequired", "isActive", "notes", "createdAt", "updatedAt")
VALUES
  ('fssm_lf_stock',         'fcp_legacy_fixture', 'STOCK',          'AVAILABLE',         'PHYSICAL_AVAILABLE', true,  true,  false, false, true, 'Replaces the hardcoded STOCK -> PHYSICAL rule.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('fssm_lf_memo',          'fcp_legacy_fixture', 'MEMO',           'MEMO',              'MEMO',               false, false, false, false, true, 'Advisory only: memo never reduces physical shortage.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('fssm_lf_reserved',      'fcp_legacy_fixture', 'RESERVED',       'RESERVED',          'RESERVED',           false, false, false, false, true, 'Recognised by demand bucketing before this profile existed.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('fssm_lf_wip_planning',  'fcp_legacy_fixture', 'WIP_PLANNING',   'MANUFACTURING_WIP', 'WIP',                false, false, false, false, true, 'WIP coverage remains governed by BR-WIP-001.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('fssm_lf_wip_laser',     'fcp_legacy_fixture', 'WIP_LASER',      'MANUFACTURING_WIP', 'WIP',                false, false, false, false, true, 'WIP coverage remains governed by BR-WIP-001.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('fssm_lf_wip_polishing', 'fcp_legacy_fixture', 'WIP_POLISHING',  'MANUFACTURING_WIP', 'WIP',                false, false, false, false, true, 'WIP coverage remains governed by BR-WIP-001.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('fssm_lf_wip_grading',   'fcp_legacy_fixture', 'WIP_GRADING',    'MANUFACTURING_WIP', 'WIP',                false, false, false, false, true, 'WIP coverage remains governed by BR-WIP-001.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('fssm_lf_wip_completed', 'fcp_legacy_fixture', 'WIP_COMPLETED',  'MANUFACTURING_WIP', 'WIP',                false, false, false, false, true, 'WIP coverage remains governed by BR-WIP-001.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('fssm_lf_invoice',       'fcp_legacy_fixture', 'INVOICE',        'SOLD',              'EXCLUDED',           false, false, true,  false, true, 'Terminal. Never available, never planning eligible.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('fssm_lf_sold',          'fcp_legacy_fixture', 'SOLD',           'SOLD',              'EXCLUDED',           false, false, true,  false, true, 'Terminal.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('fssm_lf_transferred',   'fcp_legacy_fixture', 'TRANSFERRED',    'TRANSFERRED',       'EXCLUDED',           false, false, true,  false, true, 'Terminal.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('fssm_lf_archived',      'fcp_legacy_fixture', 'ARCHIVED',       'CLOSED',            'EXCLUDED',           false, false, true,  false, true, 'Terminal.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('fssm_lf_cancelled',     'fcp_legacy_fixture', 'CANCELLED',      'CLOSED',            'EXCLUDED',           false, false, true,  false, true, 'Terminal.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('fssm_lf_removed',       'fcp_legacy_fixture', 'REMOVED_UNKNOWN','UNKNOWN',           'EXCLUDED',           false, false, false, true,  true, 'Disappearance is never treated as a sale; the record is held for review.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("profileId", "sourceStatus") DO NOTHING;

-- The only hold mapping that exists anywhere.
--
-- The fixture provider deliberately does not model hold, so its adapter supplies an
-- internal sentinel rather than a Fantasy value. Mapping the sentinel to NOT_HELD is
-- what preserves current fixture inventory and demand results. It is accepted only from
-- the application's own adapter and only for simulated data — a provider row carrying
-- this string is refused, and a real absent hold value resolves to UNKNOWN, which blocks
-- availability.
--
-- No live hold mapping is created: the real encoding is unconfirmed.
INSERT INTO "FantasyHoldMapping" ("id", "profileId", "sourceValue", "holdState", "isActive", "notes", "createdAt", "updatedAt")
VALUES (
  'fhm_lf_sentinel',
  'fcp_legacy_fixture',
  'LEGACY_FIXTURE_HOLD_NOT_MODELLED',
  'NOT_HELD',
  true,
  'Simulation-only compatibility mapping. Not a Fantasy value. Never valid for live data.',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("profileId", "sourceValue") DO NOTHING;
