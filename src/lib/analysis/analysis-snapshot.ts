import { db } from "@/lib/db";

if (typeof window !== "undefined") {
  throw new Error("analysis/analysis-snapshot is server-only and must not be imported by client code.");
}

type DbClient = typeof db;

export const USABLE_RUN_STATUSES = ["COMPLETED", "REVIEW_REQUIRED"] as const;

export const ANALYSIS_WINDOW_DAYS = 90;

export const ANALYSIS_SOURCE_POLICY = "CANONICAL_FANTASY";

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

export function assessSnapshot(run: SnapshotCandidate): SnapshotEligibility {
  const reasons: SnapshotIneligibilityCode[] = [];

  if (!(USABLE_RUN_STATUSES as readonly string[]).includes(run.status)) reasons.push("STATUS_NOT_USABLE");
  if (run.finishedAt === null) reasons.push("NOT_FINISHED");
  if (run.businessDateIst === null || run.businessDateIst.trim() === "") reasons.push("MISSING_BUSINESS_DATE");
  if (run.lookbackStart === null || run.lookbackEnd === null) reasons.push("MISSING_LOOKBACK_WINDOW");
  if (run.windowDays !== ANALYSIS_WINDOW_DAYS) reasons.push("WINDOW_NOT_90_DAYS");
  if (run.sourcePolicy !== ANALYSIS_SOURCE_POLICY) reasons.push("SOURCE_POLICY_NOT_CANONICAL");
  if (run._count.metrics === 0 && run._count.traceItems === 0 && run.salesCount !== 0) {
    reasons.push("NO_PERSISTED_EVIDENCE");
  }

  if (run._count.traceItems === 0 && run.salesCount !== 0) {
    reasons.push("NO_PERSISTED_TRACE_AND_NOT_ZERO_SALES");
  }

  if (!run.sourceMode || run.sourceMode.trim() === "") reasons.push("MISSING_SOURCE_METADATA");

  return { eligible: reasons.length === 0, reasons };
}

export interface SnapshotSelection {
  readonly run: SnapshotCandidate | null;
  readonly anyRunExists: boolean;
  readonly ineligible: ReadonlyArray<{ runId: string; runDate: Date; reasons: readonly SnapshotIneligibilityCode[] }>;
}

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
  readonly canonicalRecordCount: number;
  readonly ineligibleRuns: SnapshotSelection["ineligible"];
}

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
    return build("REFRESH_REQUIRED", null, true);
  }

  if (blockingIssues > 0) return build("BLOCKED_BY_DATA_QUALITY", selection.run, true);

  if (selection.run.salesCount === 0) return build("NO_CONFIRMED_SALES_IN_WINDOW", selection.run, true);

  return build("CURRENT", selection.run, true);
}
