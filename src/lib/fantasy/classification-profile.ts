/**
 * Loading and caching of classification profiles — server-only.
 *
 * A profile is the versioned set of status and hold mappings the classifier consults.
 * Nothing here decides availability; that is `classification.ts`. This module only
 * answers "which mappings apply, at which version".
 */

import { db } from "@/lib/db";
import type { ClassificationProfile } from "@/lib/fantasy/classification";
import type { FantasyEffectiveSourceState } from "@/lib/fantasy/source-state";

if (typeof window !== "undefined") {
  throw new Error("fantasy/classification-profile is server-only and must not be imported by client code.");
}

/**
 * The profile the legacy fixture synchronization uses. Simulation-only: it encodes the
 * vocabulary the application's own fixture provider emits, which is not the Fantasy
 * vocabulary and must never be applied to live data.
 */
export const LEGACY_FIXTURE_PROFILE = "LEGACY_FIXTURE";

/**
 * Profile for the synthetic 46-column rows the Phase 3A/4 test providers emit. Kept
 * separate from the legacy fixture profile so neither can silently classify the other's
 * data.
 */
export const FIXTURE_RAW_TEST_PROFILE = "FIXTURE_RAW_TEST";

type DbClient = typeof db;

/** Exactly the columns the classifier reads. */
const PROFILE_SELECT = {
  code: true,
  version: true,
  applicability: true,
  isActive: true,
  statusMappings: {
    select: {
      sourceStatus: true,
      canonicalLifecycle: true,
      inventoryClass: true,
      countsAvailable: true,
      planningEligible: true,
      terminalState: true,
      reviewRequired: true,
      isActive: true,
    },
  },
  holdMappings: {
    select: { sourceValue: true, holdState: true, isActive: true },
  },
} as const;

/**
 * Loads a profile by code, or null when it does not exist.
 *
 * Null is a usable answer: the classifier turns it into NOT_CONFIGURED rather than
 * inventing a default, so an installation with no profile classifies nothing as
 * available instead of everything.
 */
export async function loadClassificationProfile(
  code: string,
  client: DbClient = db,
): Promise<ClassificationProfile | null> {
  const row = await client.fantasyClassificationProfile.findUnique({
    where: { code },
    select: PROFILE_SELECT,
  });
  if (!row) return null;

  return {
    code: row.code,
    version: row.version,
    applicability: row.applicability === "LIVE_ELIGIBLE" ? "LIVE_ELIGIBLE" : "SIMULATION_ONLY",
    isActive: row.isActive,
    statusMappings: row.statusMappings,
    holdMappings: row.holdMappings,
  };
}

/**
 * The profile that may classify a given source state.
 *
 * There is deliberately no live profile: the Fantasy status vocabulary, hold encoding
 * and row granularity are all unconfirmed, so a live source resolves to null and
 * everything it delivers stays unclassified and unavailable.
 */
export async function loadProfileForSourceState(
  effectiveSourceState: FantasyEffectiveSourceState,
  client: DbClient = db,
): Promise<ClassificationProfile | null> {
  if (effectiveSourceState !== "FIXTURE_SIMULATION") return null;
  return loadClassificationProfile(LEGACY_FIXTURE_PROFILE, client);
}
