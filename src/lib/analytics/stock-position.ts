/**
 * COUNTRY STOCK POSITION & TRANSFER CANDIDATES — one shared implementation.
 *
 * Positions are computed per exact category (Country + Branch + Lab + Shape +
 * Weight Band) and only then rolled up, so a shortage in one category can never be
 * netted against an excess in another. The Country & Branch view and the Transfer
 * Analyzer both read this module: there is no second transfer calculation.
 *
 * Transfer candidates are advisory. BR-TRANSFER-001 is not client-confirmed, so no
 * transfer is ever created or executed here; the candidate count returned is the
 * real number of category pairs found, never a placeholder.
 */

import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { classifyCurrentWip, type WipPolicy } from "@/lib/demand/wip-classification";
import { AVAILABLE_LEGACY_PLANNING_CLASSES } from "@/lib/fantasy/classification";

type DbClient = typeof db;

export const TRANSFER_RULE_ID = "BR-TRANSFER-001";

/** Canonical grouping form for already-normalized lab/shape values from different tables. */
export function canonicalKey(value: string | null | undefined): string {
  return (value ?? "").trim().toUpperCase();
}

export interface CategoryPosition {
  country: string;
  branch: string;
  lab: string;
  shape: string;
  weightBandCode: string;
  weightBandLabel: string;
  category: string;
  target: number;
  available: number;
  physicalShortage: number;
  eligibleWip: number;
  approvedPlanCoverage: number;
  pipelineRequirement: number;
  remainingUnplanned: number;
  excess: number;
}

export interface CountryRollup {
  country: string;
  target: number;
  available: number;
  physicalShortage: number;
  eligibleWip: number;
  approvedPlanCoverage: number;
  pipelineRequirement: number;
  remainingUnplanned: number;
  excess: number;
  categories: number;
  categoriesWithShortage: number;
  categoriesWithExcess: number;
}

export interface BranchRollup extends CountryRollup {
  branch: string;
}

const UNBANDED = { code: "UNBANDED", label: "Unbanded" };

interface Accumulator {
  target: number;
  available: number;
  eligibleWip: number;
  approvedPlanCoverage: number;
}

function keyOf(country: string, branch: string, lab: string, shape: string, bandCode: string): string {
  return [country, branch, lab, shape, bandCode].join("\u0001");
}

export interface StockPositionResult {
  positions: CategoryPosition[];
  wipPolicy: WipPolicy;
  /** True when WIP coverage could not be applied because BR-WIP-001 is not configured. */
  wipCoverageUnavailable: boolean;
}

/**
 * Builds the per-country, per-category position from the authoritative sources:
 * requirements (country demand), polished stock (availability), classified
 * manufacturing WIP, and approved plan pieces attributed to the rough's country.
 */
export async function computeCountryCategoryPositions(client: DbClient = db): Promise<StockPositionResult> {
  const bands = await client.weightBand.findMany({ orderBy: { sortOrder: "asc" } });
  const bandById = new Map(bands.map((b) => [b.id, b]));

  const acc = new Map<string, Accumulator & { country: string; branch: string; lab: string; shape: string; bandCode: string; bandLabel: string }>();
  const touch = (country: string, branch: string, lab: string, shape: string, band: { code: string; label: string }) => {
    const k = keyOf(country, branch, lab, shape, band.code);
    let cur = acc.get(k);
    if (!cur) {
      cur = {
        country,
        branch,
        lab,
        shape,
        bandCode: band.code,
        bandLabel: band.label,
        target: 0,
        available: 0,
        eligibleWip: 0,
        approvedPlanCoverage: 0,
      };
      acc.set(k, cur);
    }
    return cur;
  };

  // 1. Country demand — requirement quantities per exact category.
  const requirementGroups = await client.requirement.groupBy({
    by: ["country", "branch", "labNormalized", "shape", "weightBandId"],
    where: { status: { notIn: ["CANCELLED", "EXPIRED"] } },
    _sum: { requiredQty: true },
  });
  for (const g of requirementGroups) {
    const band = g.weightBandId ? bandById.get(g.weightBandId) : undefined;
    const row = touch(g.country, g.branch, canonicalKey(g.labNormalized), canonicalKey(g.shape), band ?? UNBANDED);
    row.target += g._sum.requiredQty ?? 0;
  }

  // 2. Availability — physical / planning-available polished stock per category.
  const polishedGroups = await client.polishedStone.groupBy({
    by: ["country", "branch", "labNormalized", "shapeNormalized", "shape", "weightBandId"],
    // Sourced from the classifier, not restated here, so an analytics filter cannot
    // drift from what the mirror writer actually produces.
    where: { planningClass: { in: [...AVAILABLE_LEGACY_PLANNING_CLASSES] } },
    _count: { _all: true },
  });
  for (const g of polishedGroups) {
    const band = g.weightBandId ? bandById.get(g.weightBandId) : undefined;
    const row = touch(
      g.country,
      g.branch,
      canonicalKey(g.labNormalized),
      canonicalKey(g.shapeNormalized || g.shape),
      band ?? UNBANDED,
    );
    row.available += g._count._all;
  }

  // 3. Eligible WIP — shared classifier, so the country view matches the demand engine.
  const wip = await classifyCurrentWip(client);
  for (const r of wip.results) {
    if (!r.countsAsCoverage || !r.weightBandCode || !r.weightBandLabel) continue;
    const row = touch(r.country, r.branch, canonicalKey(r.lab), canonicalKey(r.shape), {
      code: r.weightBandCode,
      label: r.weightBandLabel,
    });
    row.eligibleWip += r.quantity;
  }

  // 4. Approved plan coverage — attributed to the country of the rough being planned,
  //    excluding pieces already represented as WIP or polished output.
  const wipLotIds = Array.from(wip.wipLotIds);
  const planGroups = await client.$queryRaw<
    Array<{ country: string; branch: string; lab: string; shape: string; band_code: string | null; band_label: string | null; pieces: number }>
  >(Prisma.sql`
    SELECT rs.country AS country,
           rs.branch AS branch,
           TRIM(pp."certificationIntent") AS lab,
           UPPER(TRIM(pp."expectedShape")) AS shape,
           wb.code AS band_code,
           wb.label AS band_label,
           COUNT(*)::int AS pieces
    FROM "PlanOptionPiece" pp
    JOIN "PlanOption" po ON po.id = pp."planOptionId"
    JOIN "PlanVersion" pv ON pv.id = po."versionId"
    JOIN "PlanningCase" pc ON pc.id = pv."planningCaseId"
    JOIN "RoughStone" rs ON rs.id = pc."roughId"
    LEFT JOIN "WeightBand" wb
      ON wb.active = true
     AND pp."expectedWeight" >= wb."minCt"
     AND pp."expectedWeight" <= wb."maxCt"
    WHERE po.selected = true
      AND po."approvalStatus" = 'APPROVED'
      AND pv.status <> 'SUPERSEDED'
      AND pc.status IN ('APPROVED', 'PLAN_APPROVED', 'RELEASED', 'SELECTED')
      AND pp.fulfilled = false
      AND pp."actualPolishedLotId" IS NULL
      AND (pp."fantasyChildId" IS NULL OR NOT (pp."fantasyChildId" = ANY(${wipLotIds}::text[])))
      AND pp."certificationIntent" IS NOT NULL
      AND TRIM(pp."certificationIntent") <> ''
    GROUP BY 1, 2, 3, 4, 5, 6
  `);
  for (const g of planGroups) {
    const row = touch(g.country, g.branch, canonicalKey(g.lab), canonicalKey(g.shape), {
      code: g.band_code ?? UNBANDED.code,
      label: g.band_label ?? UNBANDED.label,
    });
    row.approvedPlanCoverage += g.pieces;
  }

  const positions: CategoryPosition[] = Array.from(acc.values()).map((r) => {
    const physicalShortage = Math.max(0, r.target - r.available);
    const pipelineRequirement = Math.max(0, physicalShortage - r.eligibleWip);
    const remainingUnplanned = Math.max(0, pipelineRequirement - r.approvedPlanCoverage);
    return {
      country: r.country,
      branch: r.branch,
      lab: r.lab,
      shape: r.shape,
      weightBandCode: r.bandCode,
      weightBandLabel: r.bandLabel,
      category: `${r.lab}|${r.shape}|${r.bandLabel}`,
      target: r.target,
      available: r.available,
      physicalShortage,
      eligibleWip: r.eligibleWip,
      approvedPlanCoverage: r.approvedPlanCoverage,
      pipelineRequirement,
      remainingUnplanned,
      excess: Math.max(0, r.available - r.target),
    };
  });

  positions.sort(
    (a, b) =>
      a.country.localeCompare(b.country) ||
      a.branch.localeCompare(b.branch) ||
      a.category.localeCompare(b.category),
  );

  return { positions, wipPolicy: wip.policy, wipCoverageUnavailable: !wip.policy.appliesCoverage };
}

function emptyRollup<T extends { country: string }>(seed: T): CountryRollup & T {
  return {
    ...seed,
    target: 0,
    available: 0,
    physicalShortage: 0,
    eligibleWip: 0,
    approvedPlanCoverage: 0,
    pipelineRequirement: 0,
    remainingUnplanned: 0,
    excess: 0,
    categories: 0,
    categoriesWithShortage: 0,
    categoriesWithExcess: 0,
  };
}

function addPosition(target: CountryRollup, p: CategoryPosition) {
  target.target += p.target;
  target.available += p.available;
  target.physicalShortage += p.physicalShortage;
  target.eligibleWip += p.eligibleWip;
  target.approvedPlanCoverage += p.approvedPlanCoverage;
  target.pipelineRequirement += p.pipelineRequirement;
  target.remainingUnplanned += p.remainingUnplanned;
  target.excess += p.excess;
  target.categories += 1;
  if (p.physicalShortage > 0) target.categoriesWithShortage += 1;
  if (p.excess > 0) target.categoriesWithExcess += 1;
}

/** Country totals built by summing exact category results — never netted across categories. */
export function rollupByCountry(positions: CategoryPosition[]): CountryRollup[] {
  const out = new Map<string, CountryRollup>();
  for (const p of positions) {
    let cur = out.get(p.country);
    if (!cur) {
      cur = emptyRollup({ country: p.country });
      out.set(p.country, cur);
    }
    addPosition(cur, p);
  }
  return Array.from(out.values()).sort((a, b) => b.physicalShortage - a.physicalShortage || a.country.localeCompare(b.country));
}

/** Branch totals built the same way. */
export function rollupByBranch(positions: CategoryPosition[]): BranchRollup[] {
  const out = new Map<string, BranchRollup>();
  for (const p of positions) {
    const key = `${p.country}\u0001${p.branch}`;
    let cur = out.get(key);
    if (!cur) {
      cur = emptyRollup({ country: p.country, branch: p.branch });
      out.set(key, cur);
    }
    addPosition(cur, p);
  }
  return Array.from(out.values()).sort(
    (a, b) => b.physicalShortage - a.physicalShortage || a.country.localeCompare(b.country) || a.branch.localeCompare(b.branch),
  );
}

export type TransferStatus = "ADVISORY_UNCONFIRMED" | "ADVISORY_CONFIRMED_RULE" | "UNAVAILABLE";

export interface TransferCandidate {
  category: string;
  lab: string;
  shape: string;
  weightBand: string;
  fromCountry: string;
  toCountry: string;
  sourceExcess: number;
  destinationShortage: number;
  transferQty: number;
  potentialCoveragePct: number;
}

export interface TransferAnalysis {
  status: TransferStatus;
  ruleId: string;
  ruleStatus: string | null;
  /** Real count of candidate pairs, or null when the analysis could not run. */
  candidateCount: number | null;
  candidates: TransferCandidate[];
  totalTransferQty: number;
  countriesWithExcess: number;
  countriesWithShortage: number;
  message: string;
  /** Always false: nothing here moves stock. */
  autoExecuted: false;
}

/**
 * Pairs source excess with destination remaining shortage inside one exact category.
 * The quantity is limited by both sides. Nothing is executed.
 */
export function computeTransferCandidates(
  positions: CategoryPosition[],
  rule: { status: string } | null,
): TransferAnalysis {
  const ruleStatus = rule?.status ?? null;
  const base = {
    ruleId: TRANSFER_RULE_ID,
    ruleStatus,
    autoExecuted: false as const,
  };

  if (positions.length === 0) {
    return {
      ...base,
      status: "UNAVAILABLE",
      candidateCount: null,
      candidates: [],
      totalTransferQty: 0,
      countriesWithExcess: 0,
      countriesWithShortage: 0,
      message:
        "Transfer analysis is unavailable: no country category positions could be derived. Requirements and polished stock are needed before cross-country candidates can be identified.",
    };
  }

  // Excess and shortage are aggregated per country inside one exact category only.
  const byCategory = new Map<string, Map<string, { excess: number; shortage: number; lab: string; shape: string; band: string }>>();
  for (const p of positions) {
    if (p.weightBandCode === UNBANDED.code) continue; // unbanded stock cannot be matched safely
    let countries = byCategory.get(p.category);
    if (!countries) {
      countries = new Map();
      byCategory.set(p.category, countries);
    }
    const cur = countries.get(p.country) ?? { excess: 0, shortage: 0, lab: p.lab, shape: p.shape, band: p.weightBandLabel };
    cur.excess += p.excess;
    cur.shortage += p.remainingUnplanned;
    countries.set(p.country, cur);
  }

  const candidates: TransferCandidate[] = [];
  for (const [category, countries] of byCategory) {
    const sources = Array.from(countries.entries())
      .filter(([, v]) => v.excess > 0)
      .map(([country, v]) => ({ country, remaining: v.excess, lab: v.lab, shape: v.shape, band: v.band }))
      .sort((a, b) => b.remaining - a.remaining || a.country.localeCompare(b.country));
    const destinations = Array.from(countries.entries())
      .filter(([, v]) => v.shortage > 0)
      .map(([country, v]) => ({ country, remaining: v.shortage }))
      .sort((a, b) => b.remaining - a.remaining || a.country.localeCompare(b.country));

    if (!sources.length || !destinations.length) continue;

    for (const dest of destinations) {
      let outstanding = dest.remaining;
      for (const src of sources) {
        if (outstanding <= 0) break;
        if (src.country === dest.country || src.remaining <= 0) continue;
        const qty = Math.min(src.remaining, outstanding);
        if (qty <= 0) continue;
        candidates.push({
          category,
          lab: src.lab,
          shape: src.shape,
          weightBand: src.band,
          fromCountry: src.country,
          toCountry: dest.country,
          sourceExcess: src.remaining,
          destinationShortage: dest.remaining,
          transferQty: qty,
          potentialCoveragePct: Math.round((qty / dest.remaining) * 1000) / 10,
        });
        src.remaining -= qty;
        outstanding -= qty;
      }
    }
  }

  candidates.sort(
    (a, b) =>
      b.transferQty - a.transferQty ||
      b.potentialCoveragePct - a.potentialCoveragePct ||
      a.category.localeCompare(b.category),
  );

  const confirmed = ruleStatus === "CONFIRMED";
  return {
    ...base,
    status: confirmed ? "ADVISORY_CONFIRMED_RULE" : "ADVISORY_UNCONFIRMED",
    candidateCount: candidates.length,
    candidates,
    totalTransferQty: candidates.reduce((s, c) => s + c.transferQty, 0),
    countriesWithExcess: new Set(candidates.map((c) => c.fromCountry)).size,
    countriesWithShortage: new Set(candidates.map((c) => c.toCountry)).size,
    message: confirmed
      ? `Advisory candidates matched per confirmed rule ${TRANSFER_RULE_ID}. Transfers are never executed automatically.`
      : `Advisory only: cross-country transfer eligibility (${TRANSFER_RULE_ID}) is ${ruleStatus ?? "not defined"}, not client-confirmed. Candidate pairs are shown for review and no transfer is created.`,
  };
}

/** Convenience: positions + transfer analysis in one call, used by both consumers. */
export async function analyzeTransfers(client: DbClient = db) {
  const [position, rule] = await Promise.all([
    computeCountryCategoryPositions(client),
    client.businessRule.findUnique({ where: { ruleId: TRANSFER_RULE_ID } }),
  ]);
  return { ...position, transfers: computeTransferCandidates(position.positions, rule) };
}
