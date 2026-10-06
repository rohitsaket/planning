import { db } from "@/lib/db";
import type { ClassificationProfile } from "@/lib/fantasy/classification";
import type { FantasyEffectiveSourceState } from "@/lib/fantasy/source-state";

if (typeof window !== "undefined") {
  throw new Error("fantasy/classification-profile is server-only and must not be imported by client code.");
}

export const LEGACY_FIXTURE_PROFILE = "LEGACY_FIXTURE";

export const FIXTURE_RAW_TEST_PROFILE = "FIXTURE_RAW_TEST";

type DbClient = typeof db;

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

export async function loadProfileForSourceState(
  effectiveSourceState: FantasyEffectiveSourceState,
  client: DbClient = db,
): Promise<ClassificationProfile | null> {
  if (effectiveSourceState !== "FIXTURE_SIMULATION") return null;
  return loadClassificationProfile(LEGACY_FIXTURE_PROFILE, client);
}
