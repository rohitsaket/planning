import { resolveLabNormalization } from "./canonical";

export const CATEGORY_DIMENSION_STATES = ["APPROVED", "UNMAPPED", "UNRESOLVED"] as const;
export type CategoryDimensionState = (typeof CATEGORY_DIMENSION_STATES)[number];

export const CATEGORY_STATES = ["APPROVED", "REVIEW_REQUIRED"] as const;
export type CategoryState = (typeof CATEGORY_STATES)[number];

export const CATEGORY_REVIEW_REASONS = [
  "LAB_NOT_APPROVED",
  "SHAPE_NOT_APPROVED",
  "WEIGHT_BAND_UNRESOLVED",
] as const;
export type CategoryReviewReason = (typeof CATEGORY_REVIEW_REASONS)[number];

export const PLACEHOLDER_NORMALIZATIONS: readonly string[] = ["OTHER", "UNKNOWN", "N/A", "NA", "TBD", "PENDING"];

function isPlaceholder(value: string | null): boolean {
  return value !== null && PLACEHOLDER_NORMALIZATIONS.includes(value.trim().toUpperCase());
}

export interface CategoryClassificationInput {
  readonly labRaw: string | null | undefined;
  readonly shapeRaw: string | null | undefined;
  readonly weightCt: number | null;
}

export interface CategoryClassificationContext {
  readonly labMappings?: Map<string, string>;
  readonly shapeMappings: Map<string, string>;
  readonly weightBands: ReadonlyArray<{ id: string; label: string; minCt: number; maxCt: number }>;
}

export interface CanonicalCategoryClassification {
  readonly labNormalized: string | null;
  readonly labState: CategoryDimensionState;
  readonly shapeNormalized: string | null;
  readonly shapeState: CategoryDimensionState;
  readonly weightBandId: string | null;
  readonly weightBandLabel: string | null;
  readonly weightBandState: CategoryDimensionState;
  readonly categoryKey: string | null;
  readonly state: CategoryState;
  readonly reviewReasons: CategoryReviewReason[];
}

export function resolveApprovedWeightBand(
  weightCt: number | null,
  bands: CategoryClassificationContext["weightBands"],
): { id: string; label: string } | null {
  if (weightCt === null || !Number.isFinite(weightCt) || weightCt <= 0) return null;
  const band = bands.find((b) => weightCt >= b.minCt && weightCt <= b.maxCt);
  return band ? { id: band.id, label: band.label } : null;
}

export function classifyCanonicalCategory(
  input: CategoryClassificationInput,
  ctx: CategoryClassificationContext,
): CanonicalCategoryClassification {
  const reviewReasons: CategoryReviewReason[] = [];

  const lab = resolveLabNormalization(input.labRaw, ctx.labMappings);
  const labApproved = lab.isRecognized && !lab.requiresReview && !isPlaceholder(lab.normalized);
  const labNormalized = labApproved ? lab.normalized : null;
  const labState: CategoryDimensionState = labApproved ? "APPROVED" : "UNMAPPED";
  if (!labApproved) reviewReasons.push("LAB_NOT_APPROVED");

  const rawShape = input.shapeRaw?.trim() ?? "";
  const mappedShape = rawShape ? ctx.shapeMappings.get(rawShape.toUpperCase()) ?? null : null;
  const shapeApproved = mappedShape !== null && !isPlaceholder(mappedShape);
  const shapeNormalized = shapeApproved ? mappedShape : null;
  const shapeState: CategoryDimensionState = shapeApproved ? "APPROVED" : "UNMAPPED";
  if (!shapeApproved) reviewReasons.push("SHAPE_NOT_APPROVED");

  const band = resolveApprovedWeightBand(input.weightCt, ctx.weightBands);
  const bandState: CategoryDimensionState = band ? "APPROVED" : "UNRESOLVED";
  if (!band) reviewReasons.push("WEIGHT_BAND_UNRESOLVED");

  const approved = labApproved && shapeApproved && band !== null;

  return {
    labNormalized,
    labState,
    shapeNormalized,
    shapeState,
    weightBandId: band?.id ?? null,
    weightBandLabel: band?.label ?? null,
    weightBandState: bandState,
    categoryKey: approved ? `${labNormalized}|${shapeNormalized}|${band!.label}` : null,
    state: approved ? "APPROVED" : "REVIEW_REQUIRED",
    reviewReasons,
  };
}

export function categoryClassificationColumns(c: CanonicalCategoryClassification) {
  return {
    labNormalized: c.labNormalized,
    shapeNormalized: c.shapeNormalized,
    weightBandId: c.weightBandId,
    weightBandLabel: c.weightBandLabel,
    categoryLabState: c.labState,
    categoryShapeState: c.shapeState,
    categoryWeightBandState: c.weightBandState,
    categoryKey: c.categoryKey,
    categoryState: c.state,
    categoryReviewReasons: c.reviewReasons.length ? c.reviewReasons.join(",") : null,
  };
}

export interface PersistedCategoryClassification {
  readonly labNormalized: string | null;
  readonly shapeNormalized: string | null;
  readonly weightBandLabel: string | null;
  readonly categoryKey: string | null;
  readonly categoryState: string | null;
}

export function hasApprovedCategory(r: PersistedCategoryClassification): boolean {
  return (
    r.categoryState === "APPROVED" &&
    r.categoryKey !== null &&
    r.labNormalized !== null &&
    r.shapeNormalized !== null &&
    r.weightBandLabel !== null
  );
}

export interface CategoryReferenceClient {
  shapeMapping: {
    findMany(args: {
      where: { active: boolean };
      select: { rawShape: true; normalizedShape: true };
    }): Promise<Array<{ rawShape: string; normalizedShape: string }>>;
  };
  weightBand: {
    findMany(args: {
      where: { active: boolean };
      orderBy: { sortOrder: "asc" };
      select: { id: true; label: true; minCt: true; maxCt: true };
    }): Promise<Array<{ id: string; label: string; minCt: unknown; maxCt: unknown }>>;
  };
}

export async function loadCategoryClassificationContext(
  client: CategoryReferenceClient,
  labMappings?: Map<string, string>,
): Promise<CategoryClassificationContext> {
  const [shapes, bands] = await Promise.all([
    client.shapeMapping.findMany({ where: { active: true }, select: { rawShape: true, normalizedShape: true } }),
    client.weightBand.findMany({
      where: { active: true },
      orderBy: { sortOrder: "asc" },
      select: { id: true, label: true, minCt: true, maxCt: true },
    }),
  ]);

  const shapeMappings = new Map<string, string>();
  for (const m of shapes) shapeMappings.set(m.rawShape.trim().toUpperCase(), m.normalizedShape);

  return {
    labMappings,
    shapeMappings,
    weightBands: bands.map((b) => ({
      id: b.id,
      label: b.label,
      minCt: Number(b.minCt),
      maxCt: Number(b.maxCt),
    })),
  };
}
