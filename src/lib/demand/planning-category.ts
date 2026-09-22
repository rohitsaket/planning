/**
 * PLANNING CATEGORY RESOLUTION — single shared implementation.
 *
 * A planning category is Lab + Shape + Weight Band (BR-CAT-001). Every consumer
 * (demand calculation, WIP classification, country position, transfer analysis)
 * must resolve categories the same way, or the same lot lands in two different
 * buckets depending on which screen the user opens.
 *
 * Unmapped source values are never coerced into a valid category: resolution
 * fails with an explicit reason so the caller can quarantine the record.
 */

import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { resolveLabNormalization } from "@/lib/fantasy/canonical";

export interface WeightBandRef {
  id: string;
  code: string;
  label: string;
  minCt: Prisma.Decimal | number;
  maxCt: Prisma.Decimal | number;
}

export interface CategoryMappings {
  labMappings: Map<string, string>;
  shapeMappings: Map<string, string>;
  weightBands: WeightBandRef[];
}

type DbClient = Prisma.TransactionClient | typeof db;

/** Loads the active lab mappings, shape mappings and weight bands used for category resolution. */
export async function loadCategoryMappings(client: DbClient = db): Promise<CategoryMappings> {
  const [labs, shapes, bands] = await Promise.all([
    client.labMapping.findMany({ where: { active: true } }),
    client.shapeMapping.findMany({ where: { active: true } }),
    client.weightBand.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }),
  ]);

  const labMappings = new Map<string, string>();
  for (const m of labs) labMappings.set(m.rawLab.trim().toUpperCase(), m.normalizedLab);

  const shapeMappings = new Map<string, string>();
  for (const m of shapes) shapeMappings.set(m.rawShape.trim().toUpperCase(), m.normalizedShape.toUpperCase());

  return { labMappings, shapeMappings, weightBands: bands };
}

/** Resolves exactly one active WeightBand for a carat weight, or null when the weight is out of scope. */
export function resolveWeightBand(weight: number, bands: WeightBandRef[]): WeightBandRef | null {
  if (!Number.isFinite(weight)) return null;
  for (const b of bands) {
    if (weight >= Number(b.minCt) && weight <= Number(b.maxCt)) return b;
  }
  return null;
}

/** Maps a raw shape to its approved normalized shape. Unknown shapes stay UNKNOWN — never guessed. */
export function resolveApprovedShape(rawShape: string | null | undefined, shapeMap: Map<string, string>): string {
  if (!rawShape) return "UNKNOWN";
  return shapeMap.get(rawShape.trim().toUpperCase()) || "UNKNOWN";
}

/** The canonical category key used by DemandMetric.planningCategory and every trace row. */
export function categoryCode(lab: string, shape: string, weightBandLabel: string): string {
  return `${lab}|${shape}|${weightBandLabel}`;
}

/**
 * Bucket for records that cannot be attributed to a planning category. Trace rows use it
 * so unmapped stock stays visible and reviewable without polluting a real category.
 */
export const QUARANTINE_CATEGORY = "UNMAPPED_QUARANTINE";

export type CategoryFailureReason =
  | "UNMAPPED_LAB"
  | "UNMAPPED_SHAPE"
  | "UNMAPPED_WEIGHT_BAND"
  | "LAB_REQUIRES_REVIEW";

export type CategoryResolution =
  | { resolved: true; category: string; lab: string; shape: string; weightBand: WeightBandRef }
  | { resolved: false; reason: CategoryFailureReason; lab: string; shape: string; weightBand: WeightBandRef | null };

export interface CategoryInput {
  /** Pre-normalized lab from the canonical record, when the source already resolved it. */
  labNormalized?: string | null;
  labRaw?: string | null;
  shape?: string | null;
  weight: number;
}

/**
 * Resolves a source record to its planning category. Returns an explicit failure
 * reason instead of a fallback category when any dimension is unmapped.
 */
export function resolvePlanningCategory(input: CategoryInput, mappings: CategoryMappings): CategoryResolution {
  const resolvedLab = input.labNormalized
    ? { normalized: input.labNormalized, requiresReview: false }
    : resolveLabNormalization(input.labRaw, mappings.labMappings);
  const lab = resolvedLab.normalized;
  const shape = resolveApprovedShape(input.shape, mappings.shapeMappings);
  const band = resolveWeightBand(input.weight, mappings.weightBands);

  if (!band) return { resolved: false, reason: "UNMAPPED_WEIGHT_BAND", lab, shape, weightBand: null };
  if (shape === "UNKNOWN") return { resolved: false, reason: "UNMAPPED_SHAPE", lab, shape, weightBand: band };
  if (lab === "UNKNOWN") return { resolved: false, reason: "UNMAPPED_LAB", lab, shape, weightBand: band };
  if (resolvedLab.requiresReview) return { resolved: false, reason: "LAB_REQUIRES_REVIEW", lab, shape, weightBand: band };

  return { resolved: true, category: categoryCode(lab, shape, band.label), lab, shape, weightBand: band };
}
