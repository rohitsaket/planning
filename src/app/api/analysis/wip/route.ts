import { db } from "@/lib/db";
import { ok } from "@/lib/api-utils";
import { withApi, qStr, qInt, SCAN_MAX, scanned } from "@/lib/api/with-api";
import { classifyCurrentWip, type WipClassificationResult } from "@/lib/demand/wip-classification";

// WIP Inventory — manufacturing work in progress classified by the single shared
// classifier that the authoritative demand calculation uses, so this page and the
// demand engine can never report different coverage.
//
// Coverage is applied only when BR-WIP-001 is confirmed and lists eligible stages;
// otherwise the policy state is reported as NOT_CONFIGURED and nothing is deducted.
//
// Lot-level rows are demand trace data: they require demand.trace, exactly like
// /api/analysis/demand-trace, so this route cannot be used as a side channel.
export const GET = withApi({ permission: "analysis.read" }, async (req: Request, _ctx, { principal }) => {
  const url = new URL(req.url);
  const country = qStr(url, "country");
  const branch = qStr(url, "branch");
  const lab = qStr(url, "lab");
  const outcome = qStr(url, "outcome", 40);
  const page = qInt(url, "page", { def: 1, min: 1, max: 1_000_000 });
  const pageSize = qInt(url, "pageSize", { def: 50, min: 1, max: 500 });
  const canSeeLots = principal.permissions.includes("demand.trace");

  const classified = await classifyCurrentWip(db, {
    filter: { country, branch, lab },
    take: SCAN_MAX,
  });
  scanned(classified.results);

  const byStage = new Map<string, number>();
  const byCategory = new Map<string, number>();
  const byShape = new Map<string, number>();
  const byCountry = new Map<string, number>();
  const byOutcome = new Map<string, number>();

  const bump = (m: Map<string, number>, key: string, qty: number) => m.set(key, (m.get(key) ?? 0) + qty);

  for (const r of classified.results) {
    bump(byStage, r.stage, r.quantity);
    bump(byOutcome, r.outcome, r.quantity);
    bump(byShape, r.shape, r.quantity);
    bump(byCountry, `${r.country} / ${r.branch}`, r.quantity);
    bump(byCategory, r.category ?? "Unmapped (quarantined)", r.quantity);
  }

  const dimension = (m: Map<string, number>) =>
    Array.from(m.entries())
      .map(([key, pieces]) => ({ dimension: key, pieces }))
      .sort((a, b) => b.pieces - a.pieces || a.dimension.localeCompare(b.dimension));

  // Detail rows: deterministic order, filtered, then paginated with a real total.
  const detailSource: WipClassificationResult[] = outcome
    ? classified.results.filter((r) => r.outcome === outcome)
    : classified.results;
  const ordered = [...detailSource].sort(
    (a, b) => a.outcome.localeCompare(b.outcome) || a.lotId.localeCompare(b.lotId),
  );
  const total = ordered.length;
  const pageRows = canSeeLots ? ordered.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize) : [];

  return ok({
    policy: {
      ruleId: classified.policy.ruleId,
      status: classified.policy.status,
      reason: classified.policy.reason,
      message: classified.policy.message,
      ruleStatus: classified.policy.ruleStatus,
      ruleVersion: classified.policy.ruleVersion,
      effectiveDate: classified.policy.effectiveDate,
      eligibleStages: classified.policy.eligibleStages,
      appliesCoverage: classified.policy.appliesCoverage,
    },
    summary: classified.summary,
    // Kept for continuity with the existing page; all derived from the shared classifier.
    totalWipPieces: classified.summary.totalPieces,
    eligibleWipPieces: classified.summary.eligiblePieces,
    unallocatedWipPieces: classified.summary.unallocatedPieces,
    byStage: dimension(byStage),
    byOutcome: dimension(byOutcome),
    byCategory: dimension(byCategory),
    byShape: dimension(byShape),
    byCountry: dimension(byCountry),
    detailAccessRestricted: !canSeeLots,
    rows: pageRows.map((r) => ({
      lotId: r.lotId,
      stage: r.stage,
      stageRaw: r.stageRaw,
      outcome: r.outcome,
      reason: r.reason,
      category: r.category,
      lab: r.lab,
      shape: r.shape,
      weightBand: r.weightBandLabel,
      quantity: r.quantity,
      weight: r.weight,
      country: r.country,
      branch: r.branch,
      kapan: r.kapan,
      countsAsCoverage: r.countsAsCoverage,
      countsAsUnallocated: r.countsAsUnallocated,
    })),
    page,
    pageSize,
    total,
    hasMore: canSeeLots ? page * pageSize < total : false,
  });
});
