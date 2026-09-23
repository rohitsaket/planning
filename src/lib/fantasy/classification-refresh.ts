/**
 * FIXTURE-ONLY CLASSIFICATION REFRESH.
 *
 * Canonical records written before the classification columns existed carry a null
 * classification, which downstream code correctly treats as "not available". That is
 * safe but not useful: fixture records whose origin is provable can be classified now,
 * with the same central classifier that would have run had it existed then.
 *
 * Every condition below must hold before a record is touched. Any record that fails even
 * one stays exactly as it is, because the cost of guessing wrong is a live stone being
 * reported as available on evidence that was never checked:
 *
 *   1. `sourceType` is the internal fixture source;
 *   2. `isSimulated` is true;
 *   3. the simulation classification profile exists and is active;
 *   4. the record was written by the known fixture adapter, proven by its own history.
 *
 * Live, imported and unverifiable records are never refreshed, and no hold meaning is
 * ever backfilled for them.
 *
 * History is append-only. A classification change adds a new version recording what the
 * classification was, what it became, which profile decided it, why, who asked and when
 * — it never rewrites an existing version.
 *
 * Server-only.
 */

import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  legacyFixtureClassificationInput,
  classifyFantasyRecord,
  type ClassificationProfile,
} from "@/lib/fantasy/classification";
import { LEGACY_FIXTURE_PROFILE, loadClassificationProfile } from "@/lib/fantasy/classification-profile";

if (typeof window !== "undefined") {
  throw new Error("fantasy/classification-refresh is server-only and must not be imported by client code.");
}

type DbClient = typeof db;

/** The only source type this refresh will touch. */
export const FIXTURE_SOURCE_TYPE = "FIXTURE";

/** Fixed codes for records the refresh inspected and declined to change. */
export const REFRESH_SKIP_CODES = [
  "NOT_FIXTURE_SOURCE",
  "NOT_SIMULATED",
  "NO_FIXTURE_ADAPTER_EVIDENCE",
  "ALREADY_CLASSIFIED",
  "CLASSIFIER_DECLINED",
] as const;
export type RefreshSkipCode = (typeof REFRESH_SKIP_CODES)[number];

export const CLASSIFICATION_CHANGE_REASON = "FIXTURE_CLASSIFICATION_BACKFILL";

export class ClassificationRefreshError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "ClassificationRefreshError";
    this.code = code;
  }
}

export interface RefreshOptions {
  readonly actor: string;
  readonly actorUserId: string | null;
  /** Compute and report without writing. */
  readonly dryRun?: boolean;
  readonly limit?: number;
  readonly client?: DbClient;
}

export interface RefreshResult {
  readonly dryRun: boolean;
  readonly profileCode: string;
  readonly profileVersion: number;
  readonly inspected: number;
  readonly refreshed: number;
  readonly skipped: Readonly<Record<string, number>>;
  readonly historyVersionsAppended: number;
}

/** Bounded so one call cannot walk an unbounded table. */
export const REFRESH_MAX_RECORDS = 500;

/**
 * Proof that a record came from the known fixture adapter.
 *
 * The master row's `sourceType` alone is a column value that anything could have
 * written. Its history is the corroboration: the fixture adapter always writes at least
 * one history version, and every version it writes is itself marked simulated. A master
 * row claiming fixture origin with no simulated history behind it is not trusted.
 */
function hasFixtureAdapterEvidence(record: {
  sourceType: string;
  isSimulated: boolean;
  history: Array<{ isSimulated: boolean }>;
}): boolean {
  return (
    record.sourceType === FIXTURE_SOURCE_TYPE &&
    record.isSimulated &&
    record.history.length > 0 &&
    record.history.every((h) => h.isSimulated)
  );
}

/**
 * Refreshes classification for provable fixture records.
 *
 * Each record is written in its own transaction with its history version and audit row,
 * so a failure part-way leaves earlier records correctly classified and later ones
 * untouched — never a record updated without the history that explains it.
 */
export async function refreshFixtureClassification(options: RefreshOptions): Promise<RefreshResult> {
  const client = options.client ?? db;
  const dryRun = options.dryRun ?? false;
  const limit = Math.min(Math.max(1, options.limit ?? REFRESH_MAX_RECORDS), REFRESH_MAX_RECORDS);

  const profile = await loadClassificationProfile(LEGACY_FIXTURE_PROFILE, client);
  if (profile === null) {
    throw new ClassificationRefreshError(
      "PROFILE_NOT_CONFIGURED",
      "The simulation classification profile is not configured.",
    );
  }
  if (!profile.isActive) {
    throw new ClassificationRefreshError(
      "PROFILE_INACTIVE",
      "The simulation classification profile is not active.",
    );
  }
  if (profile.applicability !== "SIMULATION_ONLY") {
    // The refresh is defined for the simulation profile. A profile that claims live
    // eligibility is not what this path was reasoned about.
    throw new ClassificationRefreshError(
      "PROFILE_NOT_SIMULATION_ONLY",
      "This refresh applies only to the simulation classification profile.",
    );
  }

  // Only unclassified current records are candidates, and only fixture ones are read.
  const candidates = await client.lotMasterRecord.findMany({
    where: {
      isCurrent: true,
      classificationState: null,
      sourceType: FIXTURE_SOURCE_TYPE,
      isSimulated: true,
    },
    orderBy: { lotId: "asc" },
    take: limit,
    select: {
      id: true,
      lotId: true,
      sourceType: true,
      isSimulated: true,
      currentStatus: true,
      departmentName: true,
      currentVersion: true,
      // Carried verbatim onto the appended version. A history row must describe the same
      // stone as the master it follows; writing blanks here would invent a record.
      shape: true,
      weight: true,
      country: true,
      branch: true,
      roughOrPolished: true,
      quantity: true,
      docDate: true,
      statusEffectiveDate: true,
      lastSyncBatchId: true,
      checkpoint: true,
      history: { select: { isSimulated: true }, take: 50 },
    },
  });

  const skipped: Record<string, number> = {};
  const bumpSkip = (code: RefreshSkipCode) => {
    skipped[code] = (skipped[code] ?? 0) + 1;
  };

  let refreshed = 0;
  let historyVersionsAppended = 0;

  for (const record of candidates) {
    if (record.sourceType !== FIXTURE_SOURCE_TYPE) { bumpSkip("NOT_FIXTURE_SOURCE"); continue; }
    if (!record.isSimulated) { bumpSkip("NOT_SIMULATED"); continue; }
    if (!hasFixtureAdapterEvidence(record)) { bumpSkip("NO_FIXTURE_ADAPTER_EVIDENCE"); continue; }

    const classification = classifyFantasyRecord(
      legacyFixtureClassificationInput({
        currentStatus: record.currentStatus,
        currentDepartment: record.departmentName ?? null,
        previousDepartment: null,
      }),
      profile satisfies ClassificationProfile,
    );

    if (classification.state === "NOT_CONFIGURED") { bumpSkip("CLASSIFIER_DECLINED"); continue; }

    if (dryRun) { refreshed++; continue; }

    await client.$transaction(async (tx) => {
      // Conditional on the record still being unclassified, so two concurrent refreshes
      // cannot both append a version for the same change.
      const updated = await tx.lotMasterRecord.updateMany({
        where: { id: record.id, classificationState: null },
        data: {
          holdState: classification.holdState,
          canonicalLifecycle: classification.lifecycle,
          inventoryClass: classification.inventoryClass,
          classificationAvailable: classification.available,
          classificationPlanningEligible: classification.planningEligible,
          classificationReviewRequired: classification.reviewRequired,
          classificationTerminal: classification.terminal,
          classificationReasons:
            classification.exclusionReasons.length > 0 ? classification.exclusionReasons.join(",") : null,
          classificationProfile: classification.profileCode,
          classificationProfileVersion: classification.profileVersion,
          classificationState: classification.state,
          currentVersion: { increment: 1 },
        },
      });
      if (updated.count !== 1) return;

      // Append-only: a new version recording the transition. Nothing existing is edited.
      const nextVersion = record.currentVersion + 1;
      await tx.lotHistoryRecord.create({
        data: {
          lotId: record.lotId,
          version: nextVersion,
          status: record.currentStatus,
          // The business facts are unchanged: only the classification is new.
          docDate: record.docDate,
          statusEffectiveDate: record.statusEffectiveDate,
          shape: record.shape,
          weight: record.weight,
          country: record.country,
          branch: record.branch,
          roughOrPolished: record.roughOrPolished,
          quantity: record.quantity,
          isCurrent: true,
          syncBatchId: record.lastSyncBatchId,
          checkpoint: record.checkpoint,
          changeReason: CLASSIFICATION_CHANGE_REASON,
          isSimulated: true,
          holdState: classification.holdState,
          canonicalLifecycle: classification.lifecycle,
          inventoryClass: classification.inventoryClass,
          classificationAvailable: classification.available,
          classificationPlanningEligible: classification.planningEligible,
          classificationReviewRequired: classification.reviewRequired,
          classificationTerminal: classification.terminal,
          classificationReasons:
            classification.exclusionReasons.length > 0 ? classification.exclusionReasons.join(",") : null,
          classificationProfile: classification.profileCode,
          classificationProfileVersion: classification.profileVersion,
          classificationState: classification.state,
        },
      });

      await tx.auditLog.create({
        data: {
          actor: options.actor,
          actorUserId: options.actorUserId,
          action: "FANTASY_CLASSIFICATION_REFRESH",
          entity: "LotMasterRecord",
          entityId: record.lotId,
          outcome: "SUCCESS",
          category: "OPERATIONAL",
          // Previous classification was null by construction — that is the transition.
          before: JSON.stringify({ classificationState: null, inventoryClass: null }),
          after: JSON.stringify({
            classificationState: classification.state,
            inventoryClass: classification.inventoryClass,
            holdState: classification.holdState,
            profile: classification.profileCode,
            profileVersion: classification.profileVersion,
          }),
          reason: CLASSIFICATION_CHANGE_REASON,
        },
      });

      refreshed++;
      historyVersionsAppended++;
    });
  }

  return {
    dryRun,
    profileCode: profile.code,
    profileVersion: profile.version,
    inspected: candidates.length,
    refreshed,
    skipped,
    historyVersionsAppended,
  };
}
