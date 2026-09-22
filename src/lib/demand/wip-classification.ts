/**
 * MANUFACTURING WIP CLASSIFICATION — single authoritative implementation.
 *
 * Every consumer of WIP coverage (the demand calculation, the WIP Inventory page,
 * Demand Trace, country position, KPI tiles) classifies the same canonical
 * manufacturing records through this module, so the numbers cannot drift apart.
 *
 * Policy source: business rule BR-WIP-001. The rule is only treated as active when
 * it exists, is CONFIRMED, and carries a non-empty eligibleStages list. When it is
 * absent, unconfirmed or empty, WIP coverage is reported as NOT_CONFIGURED and
 * nothing is deducted from the pipeline requirement — no hardcoded stage list is
 * silently substituted.
 */

import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  CategoryFailureReason,
  CategoryMappings,
  loadCategoryMappings,
  resolvePlanningCategory,
} from "@/lib/demand/planning-category";

type DbClient = Prisma.TransactionClient | typeof db;

export const WIP_RULE_ID = "BR-WIP-001";

/** Stages that mean the WIP record has left manufacturing; they are never coverage. */
const COMPLETED_STAGES = new Set(["COMPLETED", "FINISHED", "CLOSED"]);

export type WipPolicyStatus = "CONFIGURED" | "NOT_CONFIGURED";

export type WipPolicyReason =
  | "ACTIVE"
  | "RULE_MISSING"
  | "RULE_NOT_CONFIRMED"
  | "NO_ELIGIBLE_STAGES"
  | "INVALID_CONFIGURATION";

export interface WipPolicy {
  ruleId: string;
  status: WipPolicyStatus;
  reason: WipPolicyReason;
  /** Operator-facing explanation. Safe to display verbatim. */
  message: string;
  ruleStatus: string | null;
  ruleVersion: string | null;
  effectiveDate: string | null;
  /** Normalized eligible stages. Empty whenever status is NOT_CONFIGURED. */
  eligibleStages: string[];
  /** True only when eligible WIP may be deducted from the pipeline requirement. */
  appliesCoverage: boolean;
}

/**
 * Deterministic stage normalization: upper-case, non-alphanumerics collapse to a
 * single underscore, and the transport prefix `WIP_` is dropped so that
 * "WIP_POLISHING", "wip polishing" and "Polishing" are one stage, while
 * "PRE_POLISHING" stays a different stage (no substring matching).
 */
export function normalizeWipStage(raw: string | null | undefined): string {
  if (!raw) return "UNKNOWN";
  const collapsed = raw
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!collapsed) return "UNKNOWN";
  return collapsed.startsWith("WIP_") ? collapsed.slice(4) || "UNKNOWN" : collapsed;
}

function policy(
  status: WipPolicyStatus,
  reason: WipPolicyReason,
  message: string,
  rule: { status: string; version: string; effectiveDate: Date } | null,
  eligibleStages: string[],
): WipPolicy {
  return {
    ruleId: WIP_RULE_ID,
    status,
    reason,
    message,
    ruleStatus: rule?.status ?? null,
    ruleVersion: rule?.version ?? null,
    effectiveDate: rule?.effectiveDate.toISOString() ?? null,
    eligibleStages,
    appliesCoverage: status === "CONFIGURED",
  };
}

/** Reads BR-WIP-001 and decides whether WIP coverage may be applied at all. */
export async function loadWipPolicy(client: DbClient = db): Promise<WipPolicy> {
  const rule = await client.businessRule.findUnique({ where: { ruleId: WIP_RULE_ID } });

  if (!rule) {
    return policy(
      "NOT_CONFIGURED",
      "RULE_MISSING",
      `WIP coverage is unavailable: business rule ${WIP_RULE_ID} has not been created. Eligible manufacturing stages must be configured and confirmed before WIP can reduce the pipeline requirement.`,
      null,
      [],
    );
  }

  const ruleRef = { status: rule.status, version: rule.version, effectiveDate: rule.effectiveDate };

  if (rule.status !== "CONFIRMED") {
    return policy(
      "NOT_CONFIGURED",
      "RULE_NOT_CONFIRMED",
      `WIP coverage is unavailable: business rule ${WIP_RULE_ID} is ${rule.status}, not CONFIRMED. WIP is counted and shown, but it does not reduce the pipeline requirement until the rule is client-confirmed.`,
      ruleRef,
      [],
    );
  }

  let parsed: unknown;
  try {
    parsed = rule.configuration ? JSON.parse(rule.configuration) : null;
  } catch {
    return policy(
      "NOT_CONFIGURED",
      "INVALID_CONFIGURATION",
      `WIP coverage is unavailable: the configuration stored on ${WIP_RULE_ID} is not valid JSON and cannot be applied.`,
      ruleRef,
      [],
    );
  }

  const rawStages =
    parsed && typeof parsed === "object" && Array.isArray((parsed as { eligibleStages?: unknown }).eligibleStages)
      ? ((parsed as { eligibleStages: unknown[] }).eligibleStages.filter((s) => typeof s === "string") as string[])
      : [];

  const eligibleStages = Array.from(new Set(rawStages.map(normalizeWipStage).filter((s) => s !== "UNKNOWN"))).sort();

  if (eligibleStages.length === 0) {
    return policy(
      "NOT_CONFIGURED",
      "NO_ELIGIBLE_STAGES",
      `WIP coverage is unavailable: business rule ${WIP_RULE_ID} is CONFIRMED but lists no eligible manufacturing stages.`,
      ruleRef,
      [],
    );
  }

  return policy(
    "CONFIGURED",
    "ACTIVE",
    `WIP coverage is applied per confirmed rule ${WIP_RULE_ID} v${rule.version}. Eligible stages: ${eligibleStages.join(", ")}.`,
    ruleRef,
    eligibleStages,
  );
}

export type WipOutcome =
  | "ELIGIBLE"
  | "INELIGIBLE_STAGE"
  | "AMBIGUOUS"
  | "COMPLETED"
  | "ALREADY_POLISHED"
  | "POLICY_NOT_CONFIGURED";

export interface WipSourceRecord {
  lotId: string;
  wipStage: string | null;
  currentStatus: string;
  shape: string | null;
  labRaw: string | null;
  labNormalized: string | null;
  weight: Prisma.Decimal | number;
  quantity: Prisma.Decimal | number;
  country: string;
  branch: string;
  kapan: string | null;
  parentRoughId: string | null;
}

export interface WipClassificationResult {
  lotId: string;
  stageRaw: string | null;
  stage: string;
  outcome: WipOutcome;
  /** True only for ELIGIBLE records under a configured policy. */
  countsAsCoverage: boolean;
  /** Real WIP that exists but may not reduce shortage. */
  countsAsUnallocated: boolean;
  reason: string;
  categoryFailure: CategoryFailureReason | null;
  category: string | null;
  lab: string;
  shape: string;
  weightBandCode: string | null;
  weightBandLabel: string | null;
  quantity: number;
  weight: number;
  country: string;
  branch: string;
  kapan: string | null;
}

export interface WipClassificationContext {
  policy: WipPolicy;
  mappings: CategoryMappings;
  /** Lot ids already represented as polished output; they must never be counted again as WIP. */
  polishedLotIds: Set<string>;
}

/** Classifies a single canonical WIP record. Pure — no database access. */
export function classifyWipRecord(record: WipSourceRecord, ctx: WipClassificationContext): WipClassificationResult {
  const stageRaw = record.wipStage ?? record.currentStatus ?? null;
  const stage = normalizeWipStage(record.wipStage || record.currentStatus);
  const weight = Number(record.weight);
  const rawQty = Number(record.quantity);
  const quantity = Number.isFinite(rawQty) && rawQty > 0 ? Math.round(rawQty) : 1;

  const base = {
    lotId: record.lotId,
    stageRaw,
    stage,
    quantity,
    weight,
    country: record.country,
    branch: record.branch,
    kapan: record.kapan,
  };

  const resolution = resolvePlanningCategory(
    { labNormalized: record.labNormalized, labRaw: record.labRaw, shape: record.shape, weight },
    ctx.mappings,
  );
  const lab = resolution.lab;
  const shape = resolution.shape;
  const weightBandCode = resolution.weightBand?.code ?? null;
  const weightBandLabel = resolution.weightBand?.label ?? null;
  const category = resolution.resolved ? resolution.category : null;

  const decided = (
    outcome: WipOutcome,
    reason: string,
    flags: { coverage?: boolean; unallocated?: boolean } = {},
  ): WipClassificationResult => ({
    ...base,
    outcome,
    countsAsCoverage: flags.coverage ?? false,
    countsAsUnallocated: flags.unallocated ?? false,
    reason,
    categoryFailure: resolution.resolved ? null : resolution.reason,
    category,
    lab,
    shape,
    weightBandCode,
    weightBandLabel,
  });

  // 1. Output that already exists as polished stock is counted there, never twice.
  if (ctx.polishedLotIds.has(record.lotId)) {
    return decided("ALREADY_POLISHED", "Already represented as polished inventory; excluded from WIP coverage.");
  }

  // 2. Completed manufacturing has left WIP; it is neither coverage nor open WIP.
  if (COMPLETED_STAGES.has(stage)) {
    return decided("COMPLETED", `Manufacturing stage ${stage} is complete; the output is tracked as finished stock.`);
  }

  // 3. Unmapped attributes are quarantined, never mapped into a valid category.
  if (!resolution.resolved) {
    return decided("AMBIGUOUS", `Ambiguous WIP attributes (${resolution.reason}); cannot be attributed to a planning category.`, {
      unallocated: true,
    });
  }

  // 4. Without a confirmed policy nothing is deducted, but the WIP is still reported.
  if (!ctx.policy.appliesCoverage) {
    return decided("POLICY_NOT_CONFIGURED", ctx.policy.message, { unallocated: true });
  }

  // 5. Exact stage membership — no substring matching.
  if (!ctx.policy.eligibleStages.includes(stage)) {
    return decided("INELIGIBLE_STAGE", `Stage ${stage} is not an eligible stage under ${ctx.policy.ruleId}.`, {
      unallocated: true,
    });
  }

  return decided("ELIGIBLE", `Stage ${stage} is eligible under ${ctx.policy.ruleId} v${ctx.policy.ruleVersion}.`, {
    coverage: true,
  });
}

export interface WipSummary {
  totalRecords: number;
  totalPieces: number;
  eligiblePieces: number;
  ineligibleStagePieces: number;
  ambiguousPieces: number;
  completedPieces: number;
  alreadyPolishedPieces: number;
  policyBlockedPieces: number;
  /** Real WIP that does not reduce shortage: ineligible + ambiguous + policy-blocked. */
  unallocatedPieces: number;
}

export function summarizeWipClassifications(results: WipClassificationResult[]): WipSummary {
  const summary: WipSummary = {
    totalRecords: results.length,
    totalPieces: 0,
    eligiblePieces: 0,
    ineligibleStagePieces: 0,
    ambiguousPieces: 0,
    completedPieces: 0,
    alreadyPolishedPieces: 0,
    policyBlockedPieces: 0,
    unallocatedPieces: 0,
  };

  for (const r of results) {
    summary.totalPieces += r.quantity;
    if (r.countsAsUnallocated) summary.unallocatedPieces += r.quantity;
    switch (r.outcome) {
      case "ELIGIBLE":
        summary.eligiblePieces += r.quantity;
        break;
      case "INELIGIBLE_STAGE":
        summary.ineligibleStagePieces += r.quantity;
        break;
      case "AMBIGUOUS":
        summary.ambiguousPieces += r.quantity;
        break;
      case "COMPLETED":
        summary.completedPieces += r.quantity;
        break;
      case "ALREADY_POLISHED":
        summary.alreadyPolishedPieces += r.quantity;
        break;
      case "POLICY_NOT_CONFIGURED":
        summary.policyBlockedPieces += r.quantity;
        break;
    }
  }

  return summary;
}

export function classifyWipRecords(
  records: WipSourceRecord[],
  ctx: WipClassificationContext,
): WipClassificationResult[] {
  return records.map((r) => classifyWipRecord(r, ctx));
}

/** Loads policy, mappings and the polished-output index needed to classify WIP. */
export async function loadWipClassificationContext(
  client: DbClient = db,
  preloaded: { mappings?: CategoryMappings } = {},
): Promise<WipClassificationContext> {
  const [wipPolicy, mappings, polished] = await Promise.all([
    loadWipPolicy(client),
    preloaded.mappings ? Promise.resolve(preloaded.mappings) : loadCategoryMappings(client),
    client.polishedStone.findMany({ select: { fantasyLotId: true } }),
  ]);

  return {
    policy: wipPolicy,
    mappings,
    polishedLotIds: new Set(polished.map((p) => p.fantasyLotId)),
  };
}

export interface WipInventoryFilter {
  country?: string | null;
  branch?: string | null;
  /** Restricts to a single normalized lab after classification. */
  lab?: string | null;
}

export interface ClassifiedWipInventory {
  policy: WipPolicy;
  results: WipClassificationResult[];
  summary: WipSummary;
  /** Lot ids currently tracked as WIP — used to stop approved-plan coverage double-counting them. */
  wipLotIds: Set<string>;
  eligibleLotIds: Set<string>;
}

/**
 * Loads and classifies current manufacturing WIP. This is the single entry point
 * used by both the demand calculation and the WIP Inventory API.
 */
export async function classifyCurrentWip(
  client: DbClient = db,
  options: { filter?: WipInventoryFilter; take?: number; mappings?: CategoryMappings; context?: WipClassificationContext } = {},
): Promise<ClassifiedWipInventory> {
  const ctx = options.context ?? (await loadWipClassificationContext(client, { mappings: options.mappings }));

  const where: Prisma.LotMasterRecordWhereInput = {
    isCurrent: true,
    OR: [{ roughOrPolished: "WIP" }, { entityType: "WIP" }],
  };
  if (options.filter?.country) where.country = options.filter.country;
  if (options.filter?.branch) where.branch = options.filter.branch;

  const records = await client.lotMasterRecord.findMany({
    where,
    orderBy: [{ lastSeenAt: "desc" }, { lotId: "asc" }],
    ...(options.take ? { take: options.take } : {}),
  });

  let results = classifyWipRecords(records as WipSourceRecord[], ctx);
  if (options.filter?.lab) results = results.filter((r) => r.lab === options.filter!.lab);

  return {
    policy: ctx.policy,
    results,
    summary: summarizeWipClassifications(results),
    wipLotIds: new Set(results.map((r) => r.lotId)),
    eligibleLotIds: new Set(results.filter((r) => r.countsAsCoverage).map((r) => r.lotId)),
  };
}

/**
 * True when an approved plan piece is already represented by a WIP record or by
 * polished output, so approved-plan coverage must not count it again.
 */
export function isPlanPieceCoveredElsewhere(
  piece: { fulfilled: boolean; fantasyChildId: string | null; actualPolishedLotId: string | null },
  wipLotIds: Set<string>,
): boolean {
  if (piece.fulfilled) return true;
  if (piece.actualPolishedLotId) return true;
  if (piece.fantasyChildId && wipLotIds.has(piece.fantasyChildId)) return true;
  return false;
}
