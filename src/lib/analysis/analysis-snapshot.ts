/**
 * ANALYSIS SNAPSHOT SELECTION — which demand run the Analysis pages may read.
 *
 * "The latest row labelled COMPLETED" is not the same question as "the latest run whose
 * result can be shown". A run recorded before the business-window metadata existed is
 * still historically real, but it cannot say which 90 days it covered, under which
 * source policy, or which sales it counted — so presenting its numbers as a current
 * answer would be presenting an unknown as a fact.
 *
 * Such runs stay in the history and stay ineligible. The page then reports
 * REFRESH_REQUIRED, which is a different statement from "no data" and from "zero sales".
 *
 * Server-only.
 */

import { db } from "@/lib/db";

if (typeof window !== "undefined") {
  throw new Error("analysis/analysis-snapshot is server-only and must not be imported by client code.");
}

type DbClient = typeof db;

/** Statuses whose result may be shown. A running or failed run is never a result. */
export const USABLE_RUN_STATUSES = ["COMPLETED", "REVIEW_REQUIRED"] as const;

/** The window Analysis is defined over. A run of any other length answers another question. */
export const ANALYSIS_WINDOW_DAYS = 90;

/** The only source policy Analysis reads. Legacy seeded sales are never an Analysis source. */
export const ANALYSIS_SOURCE_POLICY = "CANONICAL_FANTASY";

/** Fixed codes explaining why a run cannot be used. */
export const SNAPSHOT_INELIGIBILITY_CODES = [
  "STATUS_NOT_USABLE",
  "NOT_FINISHED",
  "MISSING_BUSINESS_DATE",
  "MISSING_LOOKBACK_WINDOW",
  "WINDOW_NOT_90_DAYS",
  "SOURCE_POLICY_NOT_CANONICAL",
  "NO_PERSISTED_EVIDENCE",
  "NO_PERSISTED_TRACE_AND_NOT_ZERO_SALES",
  "MISSING_SOURCE_METADATA",
] as const;
export type SnapshotIneligibilityCode = (typeof SNAPSHOT_INELIGIBILITY_CODES)[number];

/** Exactly the fields the eligibility rule inspects. */
export const SNAPSHOT_RUN_SELECT = {
  id: true,
  status: true,
  runDate: true,
  finishedAt: true,
  windowDays: true,
  sourcePolicy: true,
  businessDateIst: true,
  lookbackStart: true,
  lookbackEnd: true,
  sourceMode: true,
  isSimulated: true,
  salesCount: true,
  wipPolicyStatus: true,
  _count: { select: { metrics: true, traceItems: true } },
} as const;

export interface SnapshotCandidate {
  id: string;
  status: string;
  runDate: Date;
  finishedAt: Date | null;
  windowDays: number;
  sourcePolicy: string;
  businessDateIst: string | null;
  lookbackStart: Date | null;
  lookbackEnd: Date | null;
  sourceMode: string;
  isSimulated: boolean;
  salesCount: number;
  wipPolicyStatus: string;
  _count: { metrics: number; traceItems: number };
}

export interface SnapshotEligibility {
  readonly eligible: boolean;
  readonly reasons: readonly SnapshotIneligibilityCode[];
}

/**
 * Decides whether one run may back an Analysis page.
 *
 * Every reason is collected rather than short-circuiting, so a legacy run reports
 * everything it is missing instead of only the first problem.
 */
export function assessSnapshot(run: SnapshotCandidate): SnapshotEligibility {
  const reasons: SnapshotIneligibilityCode[] = [];

  if (!(USABLE_RUN_STATUSES as readonly string[]).includes(run.status)) reasons.push("STATUS_NOT_USABLE");
  if (run.finishedAt === null) reasons.push("NOT_FINISHED");
  if (run.businessDateIst === null || run.businessDateIst.trim() === "") reasons.push("MISSING_BUSINESS_DATE");
  if (run.lookbackStart === null || run.lookbackEnd === null) reasons.push("MISSING_LOOKBACK_WINDOW");
  if (run.windowDays !== ANALYSIS_WINDOW_DAYS) reasons.push("WINDOW_NOT_90_DAYS");
  if (run.sourcePolicy !== ANALYSIS_SOURCE_POLICY) reasons.push("SOURCE_POLICY_NOT_CANONICAL");
  // A run that saw sales must have persisted evidence of them. Metrics alone are not
  // the test: a run whose only sale could not be mapped to a category legitimately
  // produces no metric, but does produce a quarantine trace row — and that run is a
  // real answer ("the one sale we saw is unmapped"), not a missing one. Requiring a
  // metric would leave it permanently ineligible and the page permanently asking for a
  // recalculation that would change nothing.
  if (run._count.metrics === 0 && run._count.traceItems === 0 && run.salesCount !== 0) {
    reasons.push("NO_PERSISTED_EVIDENCE");
  }

  // A run with no trace is acceptable only when it also recorded no sales — that is a
  // genuine "nothing qualified" result. A run claiming sales but persisting no evidence
  // for them cannot be shown, because its numbers would be unverifiable.
  if (run._count.traceItems === 0 && run.salesCount !== 0) {
    reasons.push("NO_PERSISTED_TRACE_AND_NOT_ZERO_SALES");
  }

  if (!run.sourceMode || run.sourceMode.trim() === "") reasons.push("MISSING_SOURCE_METADATA");

  return { eligible: reasons.length === 0, reasons };
}

export interface SnapshotSelection {
  /** The run Analysis may read, or null when none qualifies. */
  readonly run: SnapshotCandidate | null;
  /** True when at least one run exists, whether or not any is eligible. */
  readonly anyRunExists: boolean;
  /** Runs that exist but cannot be shown, with why. Newest first. */
  readonly ineligible: ReadonlyArray<{ runId: string; runDate: Date; reasons: readonly SnapshotIneligibilityCode[] }>;
}

/**
 * Finds the latest compatible run.
 *
 * Scans recent runs newest-first and returns the first that qualifies — not merely the
 * newest row. A bounded window of candidates is inspected; a run far enough back to fall
 * outside it is old enough that it would be reported stale anyway.
 */
export async function selectAnalysisSnapshot(client: DbClient = db, scanLimit = 25): Promise<SnapshotSelection> {
  const candidates = (await client.demandRun.findMany({
    orderBy: { runDate: "desc" },
    take: scanLimit,
    select: SNAPSHOT_RUN_SELECT,
  })) as SnapshotCandidate[];

  const ineligible: Array<{ runId: string; runDate: Date; reasons: readonly SnapshotIneligibilityCode[] }> = [];
  let selected: SnapshotCandidate | null = null;

  for (const run of candidates) {
    const verdict = assessSnapshot(run);
    if (verdict.eligible && selected === null) {
      selected = run;
      continue;
    }
    if (!verdict.eligible) ineligible.push({ runId: run.id, runDate: run.runDate, reasons: verdict.reasons });
  }

  return { run: selected, anyRunExists: candidates.length > 0, ineligible };
}

// ---------------------------------------------------------------------------
// Analysis availability
// ---------------------------------------------------------------------------

/**
 * The distinct states an Analysis page can be in.
 *
 * `NOT_RUN` is deliberately absent as a *numeric* outcome: it is a state, and the page
 * shows it instead of zeros. `NO_CONFIRMED_SALES_IN_WINDOW` is only reachable after a
 * compatible run completed and found nothing, which is a different fact from having
 * never looked.
 */
export const ANALYSIS_AVAILABILITY_STATES = [
  "NO_FANTASY_DATA",
  "REFRESH_REQUIRED",
  "RUNNING",
  "FAILED",
  "NO_CONFIRMED_SALES_IN_WINDOW",
  "BLOCKED_BY_DATA_QUALITY",
  "CURRENT",
] as const;
export type AnalysisAvailabilityState = (typeof ANALYSIS_AVAILABILITY_STATES)[number];

export const ANALYSIS_AVAILABILITY_MESSAGES: Record<AnalysisAvailabilityState, string> = {
  NO_FANTASY_DATA:
    "No canonical Fantasy records exist yet. Synchronize Fantasy data before calculating analysis.",
  REFRESH_REQUIRED:
    "REFRESH REQUIRED — Fantasy data is available, but the 90-day analysis snapshot has not been calculated.",
  RUNNING: "A demand calculation is currently running. Results will appear when it finishes.",
  FAILED: "The most recent demand calculation did not succeed. Review it before relying on these figures.",
  NO_CONFIRMED_SALES_IN_WINDOW:
    "The 90-day analysis completed and found no confirmed sales in the business window.",
  BLOCKED_BY_DATA_QUALITY:
    "Analysis is blocked by open data-quality problems. Resolve them and recalculate.",
  CURRENT: "Analysis reflects the latest completed 90-day snapshot.",
};

export interface AnalysisAvailability {
  readonly state: AnalysisAvailabilityState;
  readonly message: string;
  readonly snapshot: SnapshotCandidate | null;
  readonly canRefresh: boolean;
  /** Canonical records available to analyse, regardless of whether a run exists. */
  readonly canonicalRecordCount: number;
  readonly ineligibleRuns: SnapshotSelection["ineligible"];
}

/**
 * Resolves which state an Analysis page should show.
 *
 * Order matters: a page with no canonical data at all must not tell the user to
 * recalculate, and a page whose only runs are legacy must not report zero sales.
 */
export async function resolveAnalysisAvailability(client: DbClient = db): Promise<AnalysisAvailability> {
  const [canonicalRecordCount, selection, runningRun, blockingIssues] = await Promise.all([
    client.lotMasterRecord.count({ where: { isCurrent: true } }),
    selectAnalysisSnapshot(client),
    client.demandRun.findFirst({ where: { status: "RUNNING" }, select: { id: true } }),
    client.dataQualityIssue.count({ where: { severity: "BLOCKING", status: { in: ["OPEN", "IN_REVIEW"] } } }),
  ]);

  const build = (state: AnalysisAvailabilityState, snapshot: SnapshotCandidate | null, canRefresh: boolean): AnalysisAvailability => ({
    state,
    message: ANALYSIS_AVAILABILITY_MESSAGES[state],
    snapshot,
    canRefresh,
    canonicalRecordCount,
    ineligibleRuns: selection.ineligible,
  });

  if (canonicalRecordCount === 0) return build("NO_FANTASY_DATA", null, false);
  if (runningRun) return build("RUNNING", selection.run, false);

  if (selection.run === null) {
    // Canonical data exists but nothing compatible has been calculated over it. This is
    // the state the legacy runs produce, and it is why they must not be substituted.
    return build("REFRESH_REQUIRED", null, true);
  }

  // Only a genuinely blocking data-quality issue blocks the page. A run whose own status
  // is REVIEW_REQUIRED completed and produced usable metrics — some categories need a
  // look, which the per-category status and the readiness row already say. Calling the
  // whole page blocked, or failed, would overstate that and hide a usable result.
  if (blockingIssues > 0) return build("BLOCKED_BY_DATA_QUALITY", selection.run, true);

  // Reachable only now: a compatible run completed and its own recorded sales count is
  // zero. That is an answer, not an absence of one.
  if (selection.run.salesCount === 0) return build("NO_CONFIRMED_SALES_IN_WINDOW", selection.run, true);

  return build("CURRENT", selection.run, true);
}
