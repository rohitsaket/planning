import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { num } from "@/lib/api-utils";
import { resolveFantasySourceStateWithHistory } from "@/lib/fantasy/config";
import { formatIST } from "@/lib/fantasy/time";
import { loadWipPolicy } from "@/lib/demand/wip-classification";
import {
  resolveAnalysisAvailability,
  selectAnalysisSnapshot,
  type AnalysisAvailabilityState,
} from "@/lib/analysis/analysis-snapshot";
import {
  toBusinessStatus,
  toCategoryLabel,
  toSalesTrendDirection,
  toWipCoverageState,
  type DemandCategoryStatus,
  type SalesTrendDirection,
  type WipCoverageState,
} from "@/lib/demand/demand-result-presentation";
import { scopeWhere, type EffectiveScope } from "@/lib/auth/access-scope";
import { resolveSourceDisclosure, UNESTABLISHED_SOURCE, type SourceDisclosure } from "@/lib/analysis/source-disclosure";

if (typeof window !== "undefined") {
  throw new Error("analysis/executive-summary is server-only and must not be imported by client code.");
}

type DbClient = typeof db;

async function compatibleRunId(client: DbClient): Promise<string | null> {
  const selection = await selectAnalysisSnapshot(client);
  return selection.run?.id ?? null;
}

export const EXECUTIVE_PAGE_MAX = 200;
export const EXECUTIVE_PAGE_DEFAULT = 25;

export interface ExecutiveFilters {
  readonly country: string | null;
  readonly branch: string | null;
  readonly lab: string | null;
  readonly search: string | null;
  readonly scope: EffectiveScope;
}

export interface ExecutivePaging {
  readonly page: number;
  readonly pageSize: number;
}

export const READINESS_STATES = [
  "CURRENT",
  "SIMULATED",
  "STALE",
  "DEGRADED",
  "FAILED",
  "UNAVAILABLE",
  "NOT_RUN",
  "UNKNOWN",
] as const;
export type ReadinessState = (typeof READINESS_STATES)[number];

export interface ReadinessRow {
  readonly key: string;
  readonly label: string;
  readonly value: string;
  readonly state: ReadinessState;
}

export interface ReadinessResult {
  readonly rows: readonly ReadinessRow[];
  readonly isSimulated: boolean;
  readonly sourceLabel: string;
  readonly sourceDisclosure: SourceDisclosure;
  readonly demandRunId: string | null;
  readonly demandRunAt: string | null;
  readonly demandRunAtIst: string | null;
  readonly hasCompletedRun: boolean;
  readonly demandMayNeedRecalculation: boolean;
  readonly wipCoverage: WipCoverageState;
  readonly blockingDataQualityIssues: number;
  readonly availability: AnalysisAvailabilityState;
  readonly availabilityMessage: string;
  readonly refreshRequired: boolean;
  readonly canonicalRecordCount: number;
  readonly ineligibleRuns: ReadonlyArray<{ runId: string; reasons: readonly string[] }>;
}

export async function readExecutiveReadiness(client: DbClient = db): Promise<ReadinessResult> {
  const sourceState = await resolveFantasySourceStateWithHistory(client);
  const compatibleId = await compatibleRunId(client);
  const availability = await resolveAnalysisAvailability(client);

  const [latestRun, wipPolicy, blockingIssues, lastInventoryUpdate, classifiedCounts] = await Promise.all([
    client.demandRun.findFirst({
      where: { id: compatibleId ?? "__none__" },
      select: {
        id: true,
        runDate: true,
        finishedAt: true,
        status: true,
        windowDays: true,
        businessDateIst: true,
        lookbackStart: true,
        lookbackEnd: true,
        salesCount: true,
        inventoryCount: true,
        excludedCount: true,
        wipPolicyStatus: true,
        isSimulated: true,
        sourceMode: true,
      },
    }),
    loadWipPolicy(client),
    client.dataQualityIssue.count({ where: { severity: "BLOCKING", status: { in: ["OPEN", "IN_REVIEW"] } } }),
    client.lotMasterRecord.aggregate({ where: { isCurrent: true }, _max: { lastSeenAt: true } }),
    client.lotMasterRecord.groupBy({
      by: ["classificationState"],
      where: { isCurrent: true },
      _count: { _all: true },
    }),
  ]);

  const totalClassified = classifiedCounts.reduce((sum, g) => sum + g._count._all, 0);
  const classifiedOk = classifiedCounts
    .filter((g) => g.classificationState === "CLASSIFIED")
    .reduce((sum, g) => sum + g._count._all, 0);
  const needsReview = totalClassified - classifiedOk;

  const isSimulated = sourceState.isSimulated;
  const sourceLabel = isSimulated ? "Source: Fixture Simulation" : sourceState.statusLabel;

  const freshnessState: ReadinessState = isSimulated
    ? "SIMULATED"
    : sourceState.effectiveState === "LIVE_FANTASY"
      ? "CURRENT"
      : sourceState.effectiveState === "LIVE_FANTASY_DEGRADED"
        ? "DEGRADED"
        : "UNAVAILABLE";

  const lastSync = sourceState.lastSuccessAt;
  const inventorySeenAt = lastInventoryUpdate._max.lastSeenAt ?? null;
  const runFinishedAt = latestRun?.finishedAt ?? latestRun?.runDate ?? null;

  const demandMayNeedRecalculation =
    runFinishedAt !== null && inventorySeenAt !== null && inventorySeenAt.getTime() > runFinishedAt.getTime();

  const rows: ReadinessRow[] = [
    {
      key: "sourceMode",
      label: "Effective source mode",
      value: sourceState.effectiveState,
      state: isSimulated ? "SIMULATED" : freshnessState,
    },
    {
      key: "sourceKind",
      label: "Data origin",
      value: isSimulated ? "Fixture Simulation" : "Live Fantasy",
      state: isSimulated ? "SIMULATED" : freshnessState,
    },
    {
      key: "lastSync",
      label: "Last successful Fantasy synchronization",
      value: lastSync ? formatIST(new Date(lastSync)) : "Never",
      state: lastSync ? (isSimulated ? "SIMULATED" : "CURRENT") : "UNAVAILABLE",
    },
    {
      key: "demandRun",
      label: "Latest completed demand run",
      value: runFinishedAt ? formatIST(runFinishedAt) : "Not run",
      state: latestRun ? (latestRun.status === "REVIEW_REQUIRED" ? "DEGRADED" : "CURRENT") : "NOT_RUN",
    },
    {
      key: "window",
      label: "Demand business window",
      value: latestRun
        ? `${latestRun.windowDays} days to ${latestRun.businessDateIst ?? "—"} (IST cutoff)`
        : "Not run",
      state: latestRun ? "CURRENT" : "NOT_RUN",
    },
    {
      key: "salesRecords",
      label: "Sales records included",
      value: latestRun ? String(latestRun.salesCount) : "Not run",
      state: latestRun ? "CURRENT" : "NOT_RUN",
    },
    {
      key: "inventoryRecords",
      label: "Inventory records classified",
      value: totalClassified > 0 ? String(classifiedOk) : "None",
      state: totalClassified > 0 ? (isSimulated ? "SIMULATED" : "CURRENT") : "UNAVAILABLE",
    },
    {
      key: "reviewRecords",
      label: "Quarantined or review-required records",
      value: totalClassified > 0 ? String(needsReview) : "Unknown",
      state: totalClassified === 0 ? "UNKNOWN" : needsReview > 0 ? "DEGRADED" : "CURRENT",
    },
    {
      key: "freshness",
      label: "Source freshness",
      value: sourceState.statusLabel,
      state: freshnessState,
    },
    {
      key: "blockingIssues",
      label: "Blocking data-quality issues",
      value: String(blockingIssues),
      state: blockingIssues > 0 ? "DEGRADED" : "CURRENT",
    },
    {
      key: "recalculation",
      label: "Demand snapshot vs current inventory",
      value: !latestRun
        ? "Not run"
        : demandMayNeedRecalculation
          ? "Inventory changed after this run — result may need recalculation"
          : "Demand run is the latest snapshot",
      state: !latestRun ? "NOT_RUN" : demandMayNeedRecalculation ? "STALE" : "CURRENT",
    },
  ];

  return {
    rows,
    isSimulated,
    sourceLabel,
    sourceDisclosure: resolveSourceDisclosure({ isSimulated, hasData: Boolean(latestRun) }),
    demandRunId: latestRun?.id ?? null,
    demandRunAt: runFinishedAt ? runFinishedAt.toISOString() : null,
    demandRunAtIst: runFinishedAt ? formatIST(runFinishedAt) : null,
    hasCompletedRun: latestRun !== null,
    demandMayNeedRecalculation,
    wipCoverage: toWipCoverageState({
      policyConfigured: wipPolicy.appliesCoverage,
      appliedInRun: latestRun?.wipPolicyStatus === "CONFIGURED",
    }),
    blockingDataQualityIssues: blockingIssues,
    availability: availability.state,
    availabilityMessage: availability.message,
    refreshRequired: availability.state === "REFRESH_REQUIRED",
    canonicalRecordCount: availability.canonicalRecordCount,
    ineligibleRuns: availability.ineligibleRuns.map((r) => ({ runId: r.runId, reasons: r.reasons })),
  };
}

function metricWhere(runId: string, filters: ExecutiveFilters): Prisma.DemandMetricWhereInput {
  const where: Prisma.DemandMetricWhereInput = {
    runId,
    ...scopeWhere(filters.scope, { country: null, lab: "labNormalized" }),
  };
  if (filters.lab) where.labNormalized = filters.lab;
  if (filters.search) {
    where.planningCategory = { contains: filters.search, mode: "insensitive" };
  }
  return where;
}

export type CategorySort = "category" | "shortage" | "excess" | "target" | "sales";

function metricOrder(sort: CategorySort): Prisma.DemandMetricOrderByWithRelationInput[] {
  switch (sort) {
    case "shortage":
      return [{ physicalShortage: "desc" }, { planningCategory: "asc" }];
    case "excess":
      return [{ excessStock: "desc" }, { planningCategory: "asc" }];
    case "target":
      return [{ roundedTarget: "desc" }, { planningCategory: "asc" }];
    case "sales":
      return [{ sales90d: "desc" }, { planningCategory: "asc" }];
    default:
      return [{ planningCategory: "asc" }];
  }
}

export interface PageMeta {
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
  readonly totalPages: number;
  readonly hasMore: boolean;
}

function pageMeta(paging: ExecutivePaging, total: number): PageMeta {
  const pageSize = Math.min(Math.max(1, paging.pageSize), EXECUTIVE_PAGE_MAX);
  const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);
  return {
    page: paging.page,
    pageSize,
    total,
    totalPages,
    hasMore: paging.page < totalPages,
  };
}

export interface SalesDemandRow {
  readonly category: string;
  readonly label: string;
  readonly lab: string;
  readonly shape: string;
  readonly weightBand: string;
  readonly sales90d: number;
  readonly earliest30: number | null;
  readonly middle30: number | null;
  readonly latest30: number | null;
  readonly target: number;
  readonly trend: SalesTrendDirection | null;
  readonly status: DemandCategoryStatus;
}

export interface SalesDemandResult {
  readonly rows: readonly SalesDemandRow[];
  readonly meta: PageMeta;
  readonly runId: string | null;
  readonly runAtIst: string | null;
  readonly windowDays: number | null;
  readonly businessDateIst: string | null;
  readonly available: boolean;
  readonly unavailableReason: "NOT_RUN" | null;
  readonly salesWindowsAvailable: boolean;
  readonly salesWindowsUnavailableReason: "NO_SALES_TRACE_IN_RUN" | null;
  readonly locationFilterApplies: boolean;
}

export async function readSalesAndDemand(
  filters: ExecutiveFilters,
  paging: ExecutivePaging,
  sort: CategorySort = "sales",
  client: DbClient = db,
): Promise<SalesDemandResult> {
  const compatibleId = await compatibleRunId(client);
  const run = await client.demandRun.findFirst({
    where: { id: compatibleId ?? "__none__" },
    select: { id: true, runDate: true, finishedAt: true, windowDays: true, businessDateIst: true, lookbackEnd: true },
  });

  if (!run) {
    return {
      rows: [],
      meta: pageMeta(paging, 0),
      runId: null,
      runAtIst: null,
      windowDays: null,
      businessDateIst: null,
      available: false,
      unavailableReason: "NOT_RUN",
      salesWindowsAvailable: false,
      salesWindowsUnavailableReason: null,
      locationFilterApplies: false,
    };
  }

  const where = metricWhere(run.id, filters);
  const pageSize = Math.min(Math.max(1, paging.pageSize), EXECUTIVE_PAGE_MAX);

  const [total, metrics] = await Promise.all([
    client.demandMetric.count({ where }),
    client.demandMetric.findMany({
      where,
      orderBy: metricOrder(sort),
      skip: (paging.page - 1) * pageSize,
      take: pageSize,
      select: {
        planningCategory: true,
        labNormalized: true,
        shapeNormalized: true,
        weightBandLabel: true,
        sales90d: true,
        roundedTarget: true,
        physicalShortage: true,
        remainingUnplanned: true,
        excessStock: true,
        status: true,
      },
    }),
  ]);

  const categories = metrics.map((m) => m.planningCategory);
  const buckets = await readSalesWindowBuckets(run.id, run.lookbackEnd, categories, client);
  const salesWindowsAvailable =
    run.lookbackEnd !== null &&
    (categories.length === 0 ||
      (await client.demandMetricTraceItem.count({ where: { runId: run.id, traceType: "SALE" }, take: 1 })) > 0);

  const rows: SalesDemandRow[] = metrics.map((m) => {
    const parts = m.planningCategory.split("|");
    const lab = m.labNormalized || parts[0] || "—";
    const shape = m.shapeNormalized || parts[1] || "—";
    const weightBand = m.weightBandLabel || parts.slice(2).join("|") || "—";
    const b = buckets.get(m.planningCategory) ?? { earliest30: 0, middle30: 0, latest30: 0 };

    return {
      category: m.planningCategory,
      label: toCategoryLabel(lab, shape, weightBand),
      lab,
      shape,
      weightBand,
      sales90d: num(m.sales90d),
      earliest30: salesWindowsAvailable ? b.earliest30 : null,
      middle30: salesWindowsAvailable ? b.middle30 : null,
      latest30: salesWindowsAvailable ? b.latest30 : null,
      target: num(m.roundedTarget),
      trend: salesWindowsAvailable ? toSalesTrendDirection(b.earliest30, b.latest30) : null,
      status: toBusinessStatus({
        metricStatus: m.status,
        physicalShortage: num(m.physicalShortage),
        remainingUnplanned: num(m.remainingUnplanned),
        excessStock: num(m.excessStock),
      }),
    };
  });

  const finishedAt = run.finishedAt ?? run.runDate;
  return {
    rows,
    meta: pageMeta(paging, total),
    runId: run.id,
    runAtIst: formatIST(finishedAt),
    windowDays: run.windowDays,
    businessDateIst: run.businessDateIst,
    available: true,
    unavailableReason: null,
    salesWindowsAvailable,
    salesWindowsUnavailableReason: salesWindowsAvailable ? null : "NO_SALES_TRACE_IN_RUN",
    locationFilterApplies: false,
  };
}

interface WindowBuckets {
  earliest30: number;
  middle30: number;
  latest30: number;
}

async function readSalesWindowBuckets(
  runId: string,
  lookbackEnd: Date | null,
  categories: readonly string[],
  client: DbClient,
): Promise<Map<string, WindowBuckets>> {
  const out = new Map<string, WindowBuckets>();
  if (categories.length === 0 || lookbackEnd === null) return out;

  const day = 24 * 60 * 60 * 1000;
  const end = lookbackEnd.getTime();
  const windows = [
    { key: "latest30" as const, gte: new Date(end - 30 * day), lte: lookbackEnd },
    { key: "middle30" as const, gte: new Date(end - 60 * day), lte: new Date(end - 30 * day - 1) },
    { key: "earliest30" as const, gte: new Date(end - 90 * day), lte: new Date(end - 60 * day - 1) },
  ];

  const results = await Promise.all(
    windows.map((w) =>
      client.demandMetricTraceItem.groupBy({
        by: ["planningCategory"],
        where: {
          runId,
          traceType: "SALE",
          isIncluded: true,
          planningCategory: { in: [...categories] },
          docDate: { gte: w.gte, lte: w.lte },
        },
        _sum: { quantity: true },
      }),
    ),
  );

  for (const category of categories) out.set(category, { earliest30: 0, middle30: 0, latest30: 0 });
  results.forEach((groups, i) => {
    const key = windows[i].key;
    for (const g of groups) {
      const cur = out.get(g.planningCategory);
      if (cur) cur[key] = Math.round(num(g._sum.quantity));
    }
  });

  return out;
}

export const INVENTORY_BUCKETS = ["PHYSICAL_AVAILABLE", "RESERVED", "MEMO", "WIP", "EXCLUDED"] as const;

export interface InventoryLocationRow {
  readonly country: string;
  readonly branch: string;
  readonly physicalAvailablePolished: number;
  readonly reserved: number;
  readonly memo: number;
  readonly wip: number;
  readonly roughAvailable: number;
  readonly heldOrExcluded: number;
  readonly unclassified: number;
  readonly totalClassified: number;
  readonly lastSourceUpdate: string | null;
  readonly lastSourceUpdateIst: string | null;
}

export interface InventoryPositionResult {
  readonly rows: readonly InventoryLocationRow[];
  readonly meta: PageMeta;
  readonly isSimulated: boolean;
  readonly available: boolean;
}

export async function readInventoryPosition(
  filters: ExecutiveFilters,
  paging: ExecutivePaging,
  client: DbClient = db,
): Promise<InventoryPositionResult> {
  const where: Prisma.LotMasterRecordWhereInput = {
    isCurrent: true,
    ...scopeWhere(filters.scope, { country: "country", lab: "labNormalized" }),
  };
  if (filters.country) where.country = filters.country;
  if (filters.branch) where.branch = filters.branch;
  if (filters.lab) where.labNormalized = filters.lab;

  const groups = await client.lotMasterRecord.groupBy({
    by: ["country", "branch", "inventoryClass", "roughOrPolished"],
    where,
    _count: { _all: true },
    _max: { lastSeenAt: true },
  });

  type LocationAccumulator = {
    -readonly [K in keyof InventoryLocationRow]: InventoryLocationRow[K];
  } & { lastSeen: Date | null };

  const byLocation = new Map<string, LocationAccumulator>();
  for (const g of groups) {
    const key = `${g.country}\u0001${g.branch}`;
    let row = byLocation.get(key);
    if (!row) {
      row = {
        country: g.country,
        branch: g.branch,
        physicalAvailablePolished: 0,
        reserved: 0,
        memo: 0,
        wip: 0,
        roughAvailable: 0,
        heldOrExcluded: 0,
        unclassified: 0,
        totalClassified: 0,
        lastSourceUpdate: null,
        lastSourceUpdateIst: null,
        lastSeen: null,
      };
      byLocation.set(key, row);
    }

    const count = g._count._all;
    row.totalClassified += count;
    if (g._max.lastSeenAt && (row.lastSeen === null || g._max.lastSeenAt > row.lastSeen)) {
      row.lastSeen = g._max.lastSeenAt;
    }

    if (g.inventoryClass === null) {
      row.unclassified += count;
      continue;
    }

    const isRough = g.roughOrPolished === "ROUGH";
    switch (g.inventoryClass) {
      case "PHYSICAL_AVAILABLE":
        if (isRough) row.roughAvailable += count;
        else row.physicalAvailablePolished += count;
        break;
      case "RESERVED":
        row.reserved += count;
        break;
      case "MEMO":
        row.memo += count;
        break;
      case "WIP":
        row.wip += count;
        break;
      default:
        row.heldOrExcluded += count;
        break;
    }
  }

  const all = Array.from(byLocation.values())
    .map((r) => ({
      country: r.country,
      branch: r.branch,
      physicalAvailablePolished: r.physicalAvailablePolished,
      reserved: r.reserved,
      memo: r.memo,
      wip: r.wip,
      roughAvailable: r.roughAvailable,
      heldOrExcluded: r.heldOrExcluded,
      unclassified: r.unclassified,
      totalClassified: r.totalClassified,
      lastSourceUpdate: r.lastSeen ? r.lastSeen.toISOString() : null,
      lastSourceUpdateIst: r.lastSeen ? formatIST(r.lastSeen) : null,
    }))
    .sort((a, b) => a.country.localeCompare(b.country) || a.branch.localeCompare(b.branch));

  const pageSize = Math.min(Math.max(1, paging.pageSize), EXECUTIVE_PAGE_MAX);
  const start = (paging.page - 1) * pageSize;
  const sourceState = await resolveFantasySourceStateWithHistory(client);

  return {
    rows: all.slice(start, start + pageSize),
    meta: pageMeta(paging, all.length),
    isSimulated: sourceState.isSimulated,
    available: all.length > 0,
  };
}

export type ShortageExcessMode = "ALL" | "SHORTAGE_ONLY" | "EXCESS_ONLY";

export interface ShortageExcessRow {
  readonly category: string;
  readonly label: string;
  readonly target: number;
  readonly physicalAvailable: number;
  readonly physicalShortage: number;
  readonly excess: number;
  readonly reserved: number;
  readonly memo: number;
  readonly wip: number | null;
  readonly status: DemandCategoryStatus;
}

export interface ShortageExcessResult {
  readonly rows: readonly ShortageExcessRow[];
  readonly meta: PageMeta;
  readonly runId: string | null;
  readonly runAtIst: string | null;
  readonly available: boolean;
  readonly unavailableReason: "NOT_RUN" | null;
  readonly wipCoverage: WipCoverageState;
  readonly locationFilterApplies: boolean;
}

export async function readShortageAndExcess(
  filters: ExecutiveFilters,
  paging: ExecutivePaging,
  mode: ShortageExcessMode,
  sort: CategorySort = "shortage",
  client: DbClient = db,
): Promise<ShortageExcessResult> {
  const compatibleId = await compatibleRunId(client);
  const [run, wipPolicy] = await Promise.all([
    client.demandRun.findFirst({
      where: { id: compatibleId ?? "__none__" },
      select: { id: true, runDate: true, finishedAt: true, wipPolicyStatus: true },
    }),
    loadWipPolicy(client),
  ]);

  const wipCoverage = toWipCoverageState({
    policyConfigured: wipPolicy.appliesCoverage,
    appliedInRun: run?.wipPolicyStatus === "CONFIGURED",
  });

  if (!run) {
    return {
      rows: [],
      meta: pageMeta(paging, 0),
      runId: null,
      runAtIst: null,
      available: false,
      unavailableReason: "NOT_RUN",
      wipCoverage,
      locationFilterApplies: false,
    };
  }

  const where = metricWhere(run.id, filters);
  if (mode === "SHORTAGE_ONLY") where.physicalShortage = { gt: 0 };
  if (mode === "EXCESS_ONLY") where.excessStock = { gt: 0 };

  const pageSize = Math.min(Math.max(1, paging.pageSize), EXECUTIVE_PAGE_MAX);
  const [total, metrics] = await Promise.all([
    client.demandMetric.count({ where }),
    client.demandMetric.findMany({
      where,
      orderBy: metricOrder(sort),
      skip: (paging.page - 1) * pageSize,
      take: pageSize,
      select: {
        planningCategory: true,
        labNormalized: true,
        shapeNormalized: true,
        weightBandLabel: true,
        roundedTarget: true,
        availableStock: true,
        physicalShortage: true,
        excessStock: true,
        reservedQty: true,
        memoQty: true,
        wipCoverage: true,
        remainingUnplanned: true,
        status: true,
      },
    }),
  ]);

  const rows: ShortageExcessRow[] = metrics.map((m) => {
    const parts = m.planningCategory.split("|");
    const lab = m.labNormalized || parts[0] || "—";
    const shape = m.shapeNormalized || parts[1] || "—";
    const weightBand = m.weightBandLabel || parts.slice(2).join("|") || "—";
    return {
      category: m.planningCategory,
      label: toCategoryLabel(lab, shape, weightBand),
      target: num(m.roundedTarget),
      physicalAvailable: num(m.availableStock),
      physicalShortage: num(m.physicalShortage),
      excess: num(m.excessStock),
      reserved: num(m.reservedQty),
      memo: num(m.memoQty),
      wip: wipCoverage.appliedInRun ? num(m.wipCoverage) : null,
      status: toBusinessStatus({
        metricStatus: m.status,
        physicalShortage: num(m.physicalShortage),
        remainingUnplanned: num(m.remainingUnplanned),
        excessStock: num(m.excessStock),
      }),
    };
  });

  const finishedAt = run.finishedAt ?? run.runDate;
  return {
    rows,
    meta: pageMeta(paging, total),
    runId: run.id,
    runAtIst: formatIST(finishedAt),
    available: true,
    unavailableReason: null,
    wipCoverage,
    locationFilterApplies: false,
  };
}

export const ATTENTION_KINDS = [
  "CATEGORY_PHYSICAL_SHORTAGE",
  "SOURCE_DATA_STALE",
  "CATEGORY_BLOCKED_BY_DATA_QUALITY",
  "INVENTORY_UNCLASSIFIED",
  "INVENTORY_HOLD_UNKNOWN",
  "DEMAND_NOT_RUN",
] as const;
export type AttentionKind = (typeof ATTENTION_KINDS)[number];

export const ATTENTION_ACTIONS = {
  CATEGORY_PHYSICAL_SHORTAGE: "Review shortage",
  SOURCE_DATA_STALE: "Review source data",
  CATEGORY_BLOCKED_BY_DATA_QUALITY: null,
  INVENTORY_UNCLASSIFIED: "Review inventory",
  INVENTORY_HOLD_UNKNOWN: "Review inventory",
  DEMAND_NOT_RUN: "Run demand calculation",
} as const satisfies Record<AttentionKind, string | null>;

export interface AttentionRow {
  readonly kind: AttentionKind;
  readonly subject: string;
  readonly detail: string;
  readonly count: number;
  readonly action: string | null;
  readonly category: string | null;
}

export interface AttentionResult {
  readonly rows: readonly AttentionRow[];
  readonly meta: PageMeta;
}

export async function readAttentionRequired(
  filters: ExecutiveFilters,
  paging: ExecutivePaging,
  client: DbClient = db,
): Promise<AttentionResult> {
  const readiness = await readExecutiveReadiness(client);
  const rows: AttentionRow[] = [];

  if (!readiness.hasCompletedRun) {
    rows.push({
      kind: "DEMAND_NOT_RUN",
      subject: "Demand calculation",
      detail: "No completed demand run exists, so shortage and excess are unavailable.",
      count: 0,
      action: ATTENTION_ACTIONS.DEMAND_NOT_RUN,
      category: null,
    });
  }

  if (readiness.demandMayNeedRecalculation) {
    rows.push({
      kind: "SOURCE_DATA_STALE",
      subject: "Demand snapshot",
      detail: "Inventory was synchronized after this demand run finished.",
      count: 0,
      action: ATTENTION_ACTIONS.SOURCE_DATA_STALE,
      category: null,
    });
  }

  const staleSource = readiness.rows.find((r) => r.key === "freshness");
  if (staleSource && (staleSource.state === "DEGRADED" || staleSource.state === "UNAVAILABLE")) {
    rows.push({
      kind: "SOURCE_DATA_STALE",
      subject: "Fantasy source",
      detail: staleSource.value,
      count: 0,
      action: ATTENTION_ACTIONS.SOURCE_DATA_STALE,
      category: null,
    });
  }

  const inventoryWhere: Prisma.LotMasterRecordWhereInput = {
    isCurrent: true,
    ...scopeWhere(filters.scope, { country: "country", lab: "labNormalized" }),
  };
  if (filters.country) inventoryWhere.country = filters.country;
  if (filters.branch) inventoryWhere.branch = filters.branch;
  if (filters.lab) inventoryWhere.labNormalized = filters.lab;

  const [unclassified, unknownHold] = await Promise.all([
    client.lotMasterRecord.count({ where: { ...inventoryWhere, inventoryClass: null } }),
    client.lotMasterRecord.count({ where: { ...inventoryWhere, holdState: "UNKNOWN" } }),
  ]);

  if (unclassified > 0) {
    rows.push({
      kind: "INVENTORY_UNCLASSIFIED",
      subject: "Unclassified inventory",
      detail: "Records with no classification are not counted as available stock.",
      count: unclassified,
      action: ATTENTION_ACTIONS.INVENTORY_UNCLASSIFIED,
      category: null,
    });
  }
  if (unknownHold > 0) {
    rows.push({
      kind: "INVENTORY_HOLD_UNKNOWN",
      subject: "Unknown hold value",
      detail: "Records whose hold state could not be determined are excluded from availability.",
      count: unknownHold,
      action: ATTENTION_ACTIONS.INVENTORY_HOLD_UNKNOWN,
      category: null,
    });
  }

  if (readiness.demandRunId) {
    const base = metricWhere(readiness.demandRunId, filters);
    const [shortageCategories, blockedCategories] = await Promise.all([
      client.demandMetric.findMany({
        where: { ...base, physicalShortage: { gt: 0 } },
        orderBy: [{ physicalShortage: "desc" }, { planningCategory: "asc" }],
        take: EXECUTIVE_PAGE_DEFAULT,
        select: { planningCategory: true, physicalShortage: true },
      }),
      client.demandMetric.findMany({
        where: { ...base, status: "BLOCKED_BY_DATA_QUALITY" },
        orderBy: { planningCategory: "asc" },
        take: EXECUTIVE_PAGE_DEFAULT,
        select: { planningCategory: true },
      }),
    ]);

    for (const c of blockedCategories) {
      rows.push({
        kind: "CATEGORY_BLOCKED_BY_DATA_QUALITY",
        subject: c.planningCategory,
        detail: "This category is blocked by an open data-quality problem.",
        count: 0,
        action: ATTENTION_ACTIONS.CATEGORY_BLOCKED_BY_DATA_QUALITY,
        category: c.planningCategory,
      });
    }
    for (const c of shortageCategories) {
      rows.push({
        kind: "CATEGORY_PHYSICAL_SHORTAGE",
        subject: c.planningCategory,
        detail: "Physical stock is below the approved target for this category.",
        count: num(c.physicalShortage),
        action: ATTENTION_ACTIONS.CATEGORY_PHYSICAL_SHORTAGE,
        category: c.planningCategory,
      });
    }
  }

  const pageSize = Math.min(Math.max(1, paging.pageSize), EXECUTIVE_PAGE_MAX);
  const start = (paging.page - 1) * pageSize;
  return { rows: rows.slice(start, start + pageSize), meta: pageMeta(paging, rows.length) };
}
