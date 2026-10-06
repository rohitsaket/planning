import { Prisma } from "@prisma/client";
import { resolveCanonicalQuantity, type CanonicalQuantityProvenance } from "@/lib/fantasy/quantity-weight";
import { db } from "@/lib/db";
import {
  CategoryFailureReason,
  CategoryMappings,
  loadCategoryMappings,
  resolvePlanningCategory,
} from "@/lib/demand/planning-category";
import { UNRESTRICTED_SCOPE, scopeWhere, type EffectiveScope } from "@/lib/auth/access-scope";

type DbClient = Prisma.TransactionClient | typeof db;

export const WIP_RULE_ID = "BR-WIP-001";

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
  message: string;
  ruleStatus: string | null;
  ruleVersion: string | null;
  effectiveDate: string | null;
  eligibleStages: string[];
  appliesCoverage: boolean;
}

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

export async function loadWipPolicy(client: DbClient = db): Promise<WipPolicy> {
  const rule = await client.businessRule.findUnique({ where: { ruleId: WIP_RULE_ID } });

  if (!rule) {
    return policy(
      "NOT_CONFIGURED",
      "RULE_MISSING",
      "WIP coverage policy is not configured. Eligible manufacturing stages must be set up and confirmed before WIP can reduce the pipeline requirement.",
      null,
      [],
    );
  }

  const ruleRef = { status: rule.status, version: rule.version, effectiveDate: rule.effectiveDate };

  if (rule.status !== "CONFIRMED") {
    return policy(
      "NOT_CONFIGURED",
      "RULE_NOT_CONFIRMED",
      "WIP coverage policy is not yet approved. WIP is counted and shown separately, but it does not reduce the pipeline requirement until the policy is confirmed.",
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
      "WIP coverage policy cannot be applied: its stored configuration is not readable. Contact an administrator.",
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
      "WIP coverage policy is approved but lists no eligible manufacturing stages, so no WIP can be counted as coverage.",
      ruleRef,
      [],
    );
  }

  return policy(
    "CONFIGURED",
    "ACTIVE",
    `WIP coverage policy: Active. Eligible stages: ${eligibleStages.join(", ")}.`,
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
  sourceType?: string | null;
  isSimulated?: boolean;
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
  countsAsCoverage: boolean;
  countsAsUnallocated: boolean;
  reason: string;
  categoryFailure: CategoryFailureReason | null;
  category: string | null;
  lab: string;
  shape: string;
  weightBandCode: string | null;
  weightBandLabel: string | null;
  quantity: number | null;
  quantityProvenance: CanonicalQuantityProvenance;
  weight: number;
  country: string;
  branch: string;
  kapan: string | null;
}

export interface WipClassificationContext {
  policy: WipPolicy;
  mappings: CategoryMappings;
  polishedLotIds: Set<string>;
}

export function classifyWipRecord(record: WipSourceRecord, ctx: WipClassificationContext): WipClassificationResult {
  const stageRaw = record.wipStage ?? record.currentStatus ?? null;
  const stage = normalizeWipStage(record.wipStage || record.currentStatus);
  const weight = Number(record.weight);
  const quantityDecision = resolveCanonicalQuantity({
    quantity: record.quantity,
    sourceType: record.sourceType ?? null,
    isSimulated: record.isSimulated ?? false,
  });
  const quantity = quantityDecision.pieces;

  const base = {
    lotId: record.lotId,
    stageRaw,
    stage,
    quantity,
    quantityProvenance: quantityDecision.provenance,
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

  if (ctx.polishedLotIds.has(record.lotId)) {
    return decided("ALREADY_POLISHED", "Already represented as polished inventory; excluded from WIP coverage.");
  }

  if (COMPLETED_STAGES.has(stage)) {
    return decided("COMPLETED", `Manufacturing stage ${stage} is complete; the output is tracked as finished stock.`);
  }

  if (!resolution.resolved) {
    return decided("AMBIGUOUS", `Ambiguous WIP attributes (${resolution.reason}); cannot be attributed to a planning category.`, {
      unallocated: true,
    });
  }

  if (!ctx.policy.appliesCoverage) {
    return decided("POLICY_NOT_CONFIGURED", ctx.policy.message, { unallocated: true });
  }

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
  unallocatedPieces: number;
  unconfirmedQuantityRecords: number;
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
    unconfirmedQuantityRecords: 0,
  };

  for (const r of results) {
    if (r.quantity === null) {
      summary.unconfirmedQuantityRecords++;
      continue;
    }
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
  lab?: string | null;
}

export interface ClassifiedWipInventory {
  policy: WipPolicy;
  results: WipClassificationResult[];
  summary: WipSummary;
  eligibleLotIds: Set<string>;
}

export async function classifyCurrentWip(
  client: DbClient = db,
  options: {
    filter?: WipInventoryFilter;
    take?: number;
    mappings?: CategoryMappings;
    context?: WipClassificationContext;
    scope?: EffectiveScope;
  } = {},
): Promise<ClassifiedWipInventory> {
  const ctx = options.context ?? (await loadWipClassificationContext(client, { mappings: options.mappings }));

  const scope = options.scope ?? UNRESTRICTED_SCOPE;
  const where: Prisma.LotMasterRecordWhereInput = {
    isCurrent: true,
    OR: [{ roughOrPolished: "WIP" }, { entityType: "WIP" }],
    ...scopeWhere(scope, { country: "country", lab: null }),
  };
  if (options.filter?.country) where.country = options.filter.country;
  if (options.filter?.branch) where.branch = options.filter.branch;

  const records = await client.lotMasterRecord.findMany({
    where,
    orderBy: [{ lastSeenAt: "desc" }, { lotId: "asc" }],
    ...(options.take ? { take: options.take } : {}),
  });

  let results = classifyWipRecords(records as WipSourceRecord[], ctx);
  const allowedLabs = scope.labs;
  if (allowedLabs !== null) results = results.filter((r) => r.lab !== null && allowedLabs.includes(r.lab));
  if (options.filter?.lab) results = results.filter((r) => r.lab === options.filter!.lab);

  return {
    policy: ctx.policy,
    results,
    summary: summarizeWipClassifications(results),
    eligibleLotIds: new Set(results.filter((r) => r.countsAsCoverage).map((r) => r.lotId)),
  };
}
