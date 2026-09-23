/**
 * PROJECTION ELIGIBILITY — the single place that decides whether a raw batch may be
 * projected, and under which classification profile.
 *
 * The question this module exists to answer is not "what is this application configured
 * for" but "what was true when this batch arrived". Those diverge the moment anything
 * changes: a fixture batch ingested in September, re-projected after a live switchover,
 * would otherwise be classified with live provenance it never had. So projection binds
 * to the provenance recorded on the batch itself, and the current global source state is
 * never consulted as an authority.
 *
 * Every refusal is a fixed code. None of them carries a payload value, a provider
 * message or an identifier.
 *
 * Server-only.
 */

import type { ClassificationProfile } from "@/lib/fantasy/classification";
import { FANTASY_EFFECTIVE_SOURCE_STATES, type FantasyEffectiveSourceState } from "@/lib/fantasy/source-state";

if (typeof window !== "undefined") {
  throw new Error("fantasy/projection-provenance is server-only and must not be imported by client code.");
}

// ---------------------------------------------------------------------------
// Batch status
// ---------------------------------------------------------------------------

/**
 * Batch statuses projection may proceed from.
 *
 * `ACCEPTED_WITH_ISSUES` is eligible at the BATCH level only. Its individual rows are
 * still filtered by ingestion outcome, so the issues that earned it that status are the
 * rows that get skipped — not silently carried through.
 */
export const PROJECTABLE_BATCH_STATUSES = ["ACCEPTED", "ACCEPTED_WITH_ISSUES"] as const;

/**
 * Statuses that are refused outright.
 *
 * `REJECTED` speaks for itself. `CONFLICT` is the more dangerous one: it means this
 * provider batch id already arrived with different content, so which of the two is
 * authoritative is an unanswered question. Projecting either would be picking a winner
 * the ingestion stage deliberately declined to pick.
 */
export const REFUSED_BATCH_STATUSES = ["REJECTED", "CONFLICT"] as const;

// ---------------------------------------------------------------------------
// Decision codes
// ---------------------------------------------------------------------------

export const PROJECTION_ELIGIBILITY_CODES = [
  "ELIGIBLE",
  "BATCH_STATUS_REJECTED",
  "BATCH_STATUS_CONFLICT",
  "BATCH_STATUS_NOT_PROJECTABLE",
  "SOURCE_PROVENANCE_NOT_CONFIGURED",
  "SOURCE_PROVENANCE_MISMATCH",
  "SOURCE_MODE_NOT_SUPPORTED",
  "SOURCE_STATE_NOT_PROJECTABLE",
  "CLASSIFICATION_PROFILE_NOT_AVAILABLE_FOR_SOURCE",
  "CLASSIFICATION_PROFILE_NOT_APPLICABLE",
  "CLASSIFICATION_PROFILE_INACTIVE",
] as const;
export type ProjectionEligibilityCode = (typeof PROJECTION_ELIGIBILITY_CODES)[number];

export interface ProjectionEligibilityInput {
  readonly batchStatus: string;
  /** Canonical mode recorded on the batch: FIXTURE | FILE_IMPORT | FANTASY_API. */
  readonly batchSourceMode: string;
  /** Effective state recorded AT INGESTION. Null for a batch ingested before this existed. */
  readonly effectiveSourceStateAtIngestion: string | null;
  readonly providerIdAtIngestion: string | null;
  /** The profile that would classify this batch, already loaded for its recorded state. */
  readonly profile: ClassificationProfile | null;
}

export interface ProjectionEligibility {
  readonly eligible: boolean;
  readonly code: ProjectionEligibilityCode;
  /** The state a run must record. Only set when eligible. */
  readonly effectiveSourceState: FantasyEffectiveSourceState | null;
  readonly providerId: string | null;
}

function refuse(code: ProjectionEligibilityCode): ProjectionEligibility {
  return { eligible: false, code, effectiveSourceState: null, providerId: null };
}

/**
 * Which effective states each canonical source mode may legitimately have been ingested
 * under.
 *
 * `FILE_IMPORT` maps to nothing: `parseConfiguredSourceMode` refuses it at configuration
 * time, so a batch claiming that mode cannot have a coherent provenance and is refused
 * rather than reconciled.
 */
const STATES_BY_SOURCE_MODE: Readonly<Record<string, readonly FantasyEffectiveSourceState[]>> = Object.freeze({
  FIXTURE: ["FIXTURE_SIMULATION"],
  FANTASY_API: ["LIVE_FANTASY", "LIVE_FANTASY_DEGRADED"],
  FILE_IMPORT: [],
});

function isEffectiveSourceState(value: string): value is FantasyEffectiveSourceState {
  return (FANTASY_EFFECTIVE_SOURCE_STATES as readonly string[]).includes(value);
}

/**
 * Decides whether one raw batch may be projected.
 *
 * The order matters. Batch status is checked first because a rejected or conflicting
 * batch should never reach a provenance question at all; provenance next, because a
 * batch whose origin is unknown cannot be reasoned about; the profile last, because the
 * profile is only meaningful once the provenance that selects it is trusted.
 */
export function decideProjectionEligibility(input: ProjectionEligibilityInput): ProjectionEligibility {
  // --- Batch status -------------------------------------------------------
  if (input.batchStatus === "REJECTED") return refuse("BATCH_STATUS_REJECTED");
  if (input.batchStatus === "CONFLICT") return refuse("BATCH_STATUS_CONFLICT");
  if (!(PROJECTABLE_BATCH_STATUSES as readonly string[]).includes(input.batchStatus)) {
    // Deny by default: an unrecognized status is not assumed to be safe.
    return refuse("BATCH_STATUS_NOT_PROJECTABLE");
  }

  // --- Provenance ---------------------------------------------------------
  const recorded = input.effectiveSourceStateAtIngestion;
  if (recorded === null || recorded.trim() === "") {
    // A batch ingested before provenance was recorded. Failing closed here is the whole
    // point: the alternative is guessing, and a wrong guess classifies live data with a
    // simulation profile.
    return refuse("SOURCE_PROVENANCE_NOT_CONFIGURED");
  }
  if (!isEffectiveSourceState(recorded)) return refuse("SOURCE_PROVENANCE_NOT_CONFIGURED");

  const permitted = STATES_BY_SOURCE_MODE[input.batchSourceMode];
  if (permitted === undefined) return refuse("SOURCE_MODE_NOT_SUPPORTED");
  if (permitted.length === 0) return refuse("SOURCE_MODE_NOT_SUPPORTED");
  if (!permitted.includes(recorded)) {
    // The batch's own two records of where it came from disagree. Neither is trusted.
    return refuse("SOURCE_PROVENANCE_MISMATCH");
  }
  if (recorded === "NOT_CONFIGURED") return refuse("SOURCE_STATE_NOT_PROJECTABLE");

  // --- Classification profile ---------------------------------------------
  if (input.profile === null) {
    // No profile exists for this provenance. For a live batch this is the expected
    // state today, and it is a refusal rather than a fallback: the simulation profile
    // encodes the application's own fixture vocabulary and must never touch live data.
    return refuse("CLASSIFICATION_PROFILE_NOT_AVAILABLE_FOR_SOURCE");
  }
  if (!input.profile.isActive) return refuse("CLASSIFICATION_PROFILE_INACTIVE");
  if (input.profile.applicability === "SIMULATION_ONLY" && recorded !== "FIXTURE_SIMULATION") {
    // Belt and braces with the same check inside the classifier. A profile reaching a
    // source it does not apply to should fail before a single row is interpreted, not
    // row by row afterwards.
    return refuse("CLASSIFICATION_PROFILE_NOT_APPLICABLE");
  }

  return {
    eligible: true,
    code: "ELIGIBLE",
    effectiveSourceState: recorded,
    providerId: input.providerIdAtIngestion,
  };
}

// ---------------------------------------------------------------------------
// Row eligibility
// ---------------------------------------------------------------------------

/**
 * The only ingestion outcome whose normalized values may be decoded and projected.
 *
 * A quarantined row has a normalized record — that is precisely the trap. It looks
 * projectable, and projecting it would turn a row ingestion flagged as doubtful into a
 * canonical business record with an identity, a classification and measurements.
 */
export const PROJECTABLE_ROW_OUTCOME = "ACCEPTED_RAW";

export const ROW_SKIP_REASON_CODES = [
  "ROW_SKIPPED_QUARANTINED_AT_INGESTION",
  "ROW_SKIPPED_REJECTED_AT_INGESTION",
  "ROW_SKIPPED_OUTCOME_UNRECOGNIZED",
  "ROW_SKIPPED_NOT_NORMALIZED",
  "ROW_SKIPPED_UNDECODABLE",
] as const;
export type RowSkipReasonCode = (typeof ROW_SKIP_REASON_CODES)[number];

/** Null means the row may be projected; a code means it must be skipped and counted. */
export function rowSkipReason(outcome: string): RowSkipReasonCode | null {
  if (outcome === PROJECTABLE_ROW_OUTCOME) return null;
  if (outcome === "QUARANTINED") return "ROW_SKIPPED_QUARANTINED_AT_INGESTION";
  if (outcome === "REJECTED_STRUCTURE") return "ROW_SKIPPED_REJECTED_AT_INGESTION";
  return "ROW_SKIPPED_OUTCOME_UNRECOGNIZED";
}
