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

export function resolveWeightBand(weight: number, bands: WeightBandRef[]): WeightBandRef | null {
  if (!Number.isFinite(weight)) return null;
  for (const b of bands) {
    if (weight >= Number(b.minCt) && weight <= Number(b.maxCt)) return b;
  }
  return null;
}

export function resolveApprovedShape(rawShape: string | null | undefined, shapeMap: Map<string, string>): string {
  if (!rawShape) return "UNKNOWN";
  return shapeMap.get(rawShape.trim().toUpperCase()) || "UNKNOWN";
}

export function categoryCode(lab: string, shape: string, weightBandLabel: string): string {
  return `${lab}|${shape}|${weightBandLabel}`;
}

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
  labNormalized?: string | null;
  labRaw?: string | null;
  shape?: string | null;
  weight: number;
}

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
