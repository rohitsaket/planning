/**
 * POLISHED INVENTORY VALUATION — configuration-driven, never invented.
 *
 * The application does not know diamond prices. A monetary value is only produced
 * when an approved, versioned valuation model exists as business rule
 * BR-VALUATION-001 (CONFIRMED, effective, with a price table). Without it the
 * valuation state is NOT_CONFIGURED and pieces and carats are reported alone.
 *
 * Any value produced here is an estimate from the configured model and carries its
 * version, effective date, currency and price source. It is never a statutory or
 * financial inventory valuation.
 */

import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

type DbClient = Prisma.TransactionClient | typeof db;

export const VALUATION_RULE_ID = "BR-VALUATION-001";

export type ValuationStatus = "CONFIGURED" | "NOT_CONFIGURED";

export type ValuationReason =
  | "ACTIVE"
  | "RULE_MISSING"
  | "RULE_NOT_CONFIRMED"
  | "NOT_YET_EFFECTIVE"
  | "INVALID_CONFIGURATION"
  | "NO_PRICE_ENTRIES";

export interface ValuationPriceEntry {
  lab: string | null;
  shape: string | null;
  weightBandCode: string | null;
  color: string | null;
  clarity: string | null;
  pricePerCarat: number;
}

export interface ValuationPolicy {
  ruleId: string;
  status: ValuationStatus;
  reason: ValuationReason;
  /** Operator-facing explanation. Safe to display verbatim. */
  message: string;
  modelVersion: string | null;
  effectiveDate: string | null;
  currency: string | null;
  priceSource: string | null;
  entries: ValuationPriceEntry[];
  /** Always true when a value is produced: these are model estimates, not book values. */
  isEstimate: boolean;
}

function notConfigured(reason: ValuationReason, message: string, rule: { version: string; effectiveDate: Date } | null): ValuationPolicy {
  return {
    ruleId: VALUATION_RULE_ID,
    status: "NOT_CONFIGURED",
    reason,
    message,
    modelVersion: rule?.version ?? null,
    effectiveDate: rule?.effectiveDate.toISOString() ?? null,
    currency: null,
    priceSource: null,
    entries: [],
    isEstimate: true,
  };
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

/** Reads BR-VALUATION-001 and decides whether any monetary value may be shown at all. */
export async function loadValuationPolicy(client: DbClient = db, now: Date = new Date()): Promise<ValuationPolicy> {
  const rule = await client.businessRule.findUnique({ where: { ruleId: VALUATION_RULE_ID } });

  if (!rule) {
    return notConfigured(
      "RULE_MISSING",
      `Inventory valuation is unavailable: no approved valuation model (${VALUATION_RULE_ID}) is configured. Connect Fantasy valuation data or configure an approved model to show monetary values.`,
      null,
    );
  }

  const ruleRef = { version: rule.version, effectiveDate: rule.effectiveDate };

  if (rule.status !== "CONFIRMED") {
    return notConfigured(
      "RULE_NOT_CONFIRMED",
      `Inventory valuation is unavailable: valuation model ${VALUATION_RULE_ID} is ${rule.status}, not CONFIRMED. Pieces and carats are shown without monetary value.`,
      ruleRef,
    );
  }

  if (rule.effectiveDate.getTime() > now.getTime()) {
    return notConfigured(
      "NOT_YET_EFFECTIVE",
      `Inventory valuation is unavailable: valuation model ${VALUATION_RULE_ID} takes effect on ${rule.effectiveDate.toISOString().slice(0, 10)}.`,
      ruleRef,
    );
  }

  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = rule.configuration ? (JSON.parse(rule.configuration) as Record<string, unknown>) : null;
  } catch {
    return notConfigured("INVALID_CONFIGURATION", `Inventory valuation is unavailable: the configuration stored on ${VALUATION_RULE_ID} is not valid JSON.`, ruleRef);
  }

  const currency = str(parsed?.currency);
  const priceSource = str(parsed?.priceSource);
  const rawPrices = Array.isArray(parsed?.prices) ? (parsed!.prices as unknown[]) : [];

  if (!currency || !priceSource) {
    return notConfigured(
      "INVALID_CONFIGURATION",
      `Inventory valuation is unavailable: valuation model ${VALUATION_RULE_ID} must declare both a currency and a price source.`,
      ruleRef,
    );
  }

  const entries: ValuationPriceEntry[] = [];
  for (const raw of rawPrices) {
    if (!raw || typeof raw !== "object") continue;
    const e = raw as Record<string, unknown>;
    const price = typeof e.pricePerCarat === "number" ? e.pricePerCarat : Number(e.pricePerCarat);
    if (!Number.isFinite(price) || price <= 0) continue;
    entries.push({
      lab: str(e.lab),
      shape: str(e.shape)?.toUpperCase() ?? null,
      weightBandCode: str(e.weightBandCode),
      color: str(e.color)?.toUpperCase() ?? null,
      clarity: str(e.clarity)?.toUpperCase() ?? null,
      pricePerCarat: price,
    });
  }

  if (entries.length === 0) {
    return notConfigured(
      "NO_PRICE_ENTRIES",
      `Inventory valuation is unavailable: valuation model ${VALUATION_RULE_ID} is CONFIRMED but contains no usable price entries.`,
      ruleRef,
    );
  }

  return {
    ruleId: VALUATION_RULE_ID,
    status: "CONFIGURED",
    reason: "ACTIVE",
    message: `Estimated using approved valuation model ${VALUATION_RULE_ID} v${rule.version} (${priceSource}, ${currency}, effective ${rule.effectiveDate.toISOString().slice(0, 10)}). Estimates are advisory and are not statutory inventory value.`,
    modelVersion: rule.version,
    effectiveDate: rule.effectiveDate.toISOString(),
    currency,
    priceSource,
    entries,
    isEstimate: true,
  };
}

export interface ValuationSubject {
  lab: string | null | undefined;
  shape: string | null | undefined;
  weightBandCode: string | null | undefined;
  color?: string | null;
  clarity?: string | null;
  weight: number;
}

export interface ValuationResult {
  valued: boolean;
  value: number | null;
  pricePerCarat: number | null;
  /** Why no value was produced, when valued is false. */
  reason: "VALUED" | "POLICY_NOT_CONFIGURED" | "NO_MATCHING_PRICE" | "INVALID_WEIGHT";
}

const UNVALUED = (reason: ValuationResult["reason"]): ValuationResult => ({
  valued: false,
  value: null,
  pricePerCarat: null,
  reason,
});

/**
 * Values one stone with the most specific matching price entry. Entries leave a
 * dimension null to act as a wildcard; a stone with no matching entry is reported
 * as unvalued rather than being given a made-up price.
 */
export function valueStone(subject: ValuationSubject, policy: ValuationPolicy): ValuationResult {
  if (policy.status !== "CONFIGURED") return UNVALUED("POLICY_NOT_CONFIGURED");
  if (!Number.isFinite(subject.weight) || subject.weight <= 0) return UNVALUED("INVALID_WEIGHT");

  const lab = subject.lab?.trim() ?? null;
  const shape = subject.shape?.trim().toUpperCase() ?? null;
  const band = subject.weightBandCode?.trim() ?? null;
  const color = subject.color?.trim().toUpperCase() ?? null;
  const clarity = subject.clarity?.trim().toUpperCase() ?? null;

  let best: ValuationPriceEntry | null = null;
  let bestScore = -1;

  for (const e of policy.entries) {
    let score = 0;
    if (e.lab !== null) {
      if (e.lab !== lab) continue;
      score += 16;
    }
    if (e.shape !== null) {
      if (e.shape !== shape) continue;
      score += 8;
    }
    if (e.weightBandCode !== null) {
      if (e.weightBandCode !== band) continue;
      score += 4;
    }
    if (e.color !== null) {
      if (e.color !== color) continue;
      score += 2;
    }
    if (e.clarity !== null) {
      if (e.clarity !== clarity) continue;
      score += 1;
    }
    if (score > bestScore) {
      best = e;
      bestScore = score;
    }
  }

  if (!best) return UNVALUED("NO_MATCHING_PRICE");

  return {
    valued: true,
    value: Math.round(subject.weight * best.pricePerCarat * 100) / 100,
    pricePerCarat: best.pricePerCarat,
    reason: "VALUED",
  };
}
