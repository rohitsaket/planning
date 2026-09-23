/**
 * SHADOW RECONCILIATION — how a projection run compares to the live canonical records.
 *
 * Answers one question: if the projected interpretation replaced the legacy one, what
 * would change? It reports that as counts and fixed difference codes. It never changes
 * anything, never promotes a candidate, and never returns a raw payload, a source
 * remark, a calculation expression or a full record.
 *
 * Reads are paginated and aggregated at the database level; nothing loads a whole
 * operational table into memory. The comparison itself is a bounded page-by-page join
 * on the legacy identifier, so a run over a large batch costs one indexed lookup per
 * page rather than one per row.
 *
 * Server-only.
 */

import { db } from "@/lib/db";

if (typeof window !== "undefined") {
  throw new Error("fantasy/projection-reconciliation is server-only and must not be imported by client code.");
}

/** Fixed difference codes. Never free text and never a source value. */
export const RECONCILIATION_DIFFERENCE_CODES = [
  "MATCHED",
  "INVENTORY_CLASS_DIFFERS",
  "AVAILABILITY_DIFFERS",
  "HOLD_STATE_DIFFERS",
  "LIFECYCLE_DIFFERS",
  "CANDIDATE_ONLY_NO_CANONICAL_RECORD",
  "CANDIDATE_QUARANTINED",
  "CANONICAL_UNCLASSIFIED",
] as const;
export type ReconciliationDifferenceCode = (typeof RECONCILIATION_DIFFERENCE_CODES)[number];

export interface ReconciliationSummary {
  readonly runId: string;
  readonly mode: string;
  readonly status: string;
  readonly effectiveSourceState: string;
  readonly classificationProfile: string | null;
  readonly classificationProfileVersion: number | null;
  /** Every candidate the run wrote, regardless of how many were compared. */
  readonly candidatesTotal: number;
  readonly candidatesCompared: number;
  /** Candidates the ceiling prevented from being compared. Never hidden. */
  readonly candidatesNotCompared: number;
  /** Counts per fixed difference code. A candidate may contribute to several. */
  readonly differenceCounts: Readonly<Record<string, number>>;
  /** Candidates whose projected interpretation matches the live record exactly. */
  readonly matched: number;
  /** Candidates that differ in at least one compared field. */
  readonly differing: number;
  /** True only when every candidate in the run was compared. */
  readonly complete: boolean;
  /** The configured ceiling, always reported so a partial result is interpretable. */
  readonly ceiling: number;
  readonly ceilingReached: boolean;
  /** Constant: reconciliation never promotes, whatever the result says. */
  readonly activationBlockedReason: string;
}

/** Rows compared per page. Bounded so reconciliation cannot exhaust memory. */
export const RECONCILIATION_PAGE_SIZE = 500;

/**
 * Ceiling on a single reconciliation. Reaching it is reported as `complete: false` with
 * the exact count, never as a silent truncation.
 */
export const RECONCILIATION_MAX_CANDIDATES = 50_000;

export class ReconciliationError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "ReconciliationError";
    this.code = code;
  }
}

export interface ReconciliationOptions {
  /**
   * Lower ceiling for this call. Clamped to the configured maximum, so a caller can only
   * ever ask for less work than the service permits, never more.
   */
  readonly maxCandidates?: number;
}

/**
 * Compares one completed shadow run against the current canonical records.
 *
 * A candidate with no canonical counterpart is reported, not created. A canonical record
 * with no candidate is outside this run's scope and is deliberately not counted here:
 * a projection covers one batch, and treating rows absent from it as missing would be
 * exactly the "absent means gone" inference the ingestion rules forbid.
 */
export async function reconcileProjectionRun(
  runId: string,
  options: ReconciliationOptions = {},
): Promise<ReconciliationSummary> {
  const ceiling =
    options.maxCandidates !== undefined && Number.isInteger(options.maxCandidates) && options.maxCandidates > 0
      ? Math.min(options.maxCandidates, RECONCILIATION_MAX_CANDIDATES)
      : RECONCILIATION_MAX_CANDIDATES;

  const run = await db.fantasyProjectionRun.findUnique({
    where: { id: runId },
    select: {
      id: true,
      mode: true,
      status: true,
      effectiveSourceState: true,
      classificationProfile: true,
      classificationProfileVersion: true,
      activationBlockedReason: true,
    },
  });
  if (!run) throw new ReconciliationError("RUN_NOT_FOUND", "The projection run does not exist.");
  if (run.mode !== "SHADOW") {
    // A dry run persists no candidates, so there is nothing to compare against.
    throw new ReconciliationError("RUN_NOT_COMPARABLE", "Only a shadow run stores candidates to reconcile.");
  }
  if (run.status !== "COMPLETED") {
    // A RUNNING run is still writing candidates, so any comparison of it is a snapshot
    // of a partial projection presented as a whole one. A FAILED or ABORTED run wrote an
    // unknown subset. Neither is a basis for "how much would change".
    throw new ReconciliationError(
      run.status === "RUNNING" ? "RUN_STILL_RUNNING" : "RUN_NOT_SUCCESSFUL",
      "Only a completed shadow run can be reconciled.",
    );
  }

  // The real total, read once. Reporting "compared 50,000" without it would let a
  // ceiling-truncated result read as a complete one.
  const candidatesTotal = await db.fantasyProjectionCandidate.count({ where: { runId: run.id } });

  const differenceCounts: Record<string, number> = {};
  const bump = (code: ReconciliationDifferenceCode) => {
    differenceCounts[code] = (differenceCounts[code] ?? 0) + 1;
  };

  let compared = 0;
  let matched = 0;
  let differing = 0;
  // Keyset cursor on the unique (runId, sourceRowNumber) pair, which is exactly the
  // ordering. Ordering by one key while paging on another does not guarantee the cursor
  // row's position, so rows could be skipped or repeated at a page boundary.
  let afterRowNumber: number | null = null;
  let ceilingReached = false;

  for (;;) {
    if (compared >= ceiling) {
      ceilingReached = true;
      break;
    }

    const page = await db.fantasyProjectionCandidate.findMany({
      where: {
        runId: run.id,
        ...(afterRowNumber === null ? {} : { sourceRowNumber: { gt: afterRowNumber } }),
      },
      select: {
        sourceRowNumber: true,
        legacyLotId: true,
        candidateState: true,
        inventoryClass: true,
        holdState: true,
        canonicalLifecycle: true,
        classificationAvailable: true,
      },
      orderBy: { sourceRowNumber: "asc" },
      take: Math.min(RECONCILIATION_PAGE_SIZE, ceiling - compared),
    });
    if (page.length === 0) break;
    afterRowNumber = page[page.length - 1].sourceRowNumber;

    // One indexed lookup per page rather than per candidate.
    const lotIds = page.map((c) => c.legacyLotId).filter((id): id is string => id !== null);
    const canonicalRows =
      lotIds.length > 0
        ? await db.lotMasterRecord.findMany({
            where: { lotId: { in: lotIds }, isCurrent: true },
            select: {
              lotId: true,
              inventoryClass: true,
              holdState: true,
              canonicalLifecycle: true,
              classificationAvailable: true,
            },
          })
        : [];
    const canonicalByLotId = new Map(canonicalRows.map((r) => [r.lotId, r]));

    for (const candidate of page) {
      compared++;

      if (candidate.candidateState === "QUARANTINED") {
        bump("CANDIDATE_QUARANTINED");
        differing++;
        continue;
      }

      const canonical = candidate.legacyLotId ? canonicalByLotId.get(candidate.legacyLotId) : undefined;
      if (!canonical) {
        bump("CANDIDATE_ONLY_NO_CANONICAL_RECORD");
        differing++;
        continue;
      }

      if (canonical.inventoryClass === null) {
        // Written before classification existed. Reported rather than assumed equal.
        bump("CANONICAL_UNCLASSIFIED");
        differing++;
        continue;
      }

      let differs = false;
      if (canonical.inventoryClass !== candidate.inventoryClass) {
        bump("INVENTORY_CLASS_DIFFERS");
        differs = true;
      }
      if (canonical.classificationAvailable !== candidate.classificationAvailable) {
        bump("AVAILABILITY_DIFFERS");
        differs = true;
      }
      if (canonical.holdState !== candidate.holdState) {
        bump("HOLD_STATE_DIFFERS");
        differs = true;
      }
      if (canonical.canonicalLifecycle !== candidate.canonicalLifecycle) {
        bump("LIFECYCLE_DIFFERS");
        differs = true;
      }

      if (differs) differing++;
      else {
        bump("MATCHED");
        matched++;
      }
    }
  }

  return {
    runId: run.id,
    mode: run.mode,
    status: run.status,
    effectiveSourceState: run.effectiveSourceState,
    classificationProfile: run.classificationProfile,
    classificationProfileVersion: run.classificationProfileVersion,
    candidatesTotal,
    candidatesCompared: compared,
    candidatesNotCompared: Math.max(0, candidatesTotal - compared),
    differenceCounts,
    matched,
    differing,
    // Completeness is measured against the run's real total, not against whether the
    // loop happened to stop early.
    complete: compared === candidatesTotal,
    ceiling,
    ceilingReached,
    activationBlockedReason: run.activationBlockedReason,
  };
}
