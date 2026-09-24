/**
 * CANONICAL CATEGORY CLASSIFICATION — one decision, made once, at projection time.
 *
 * A planning category is `Lab | Shape | Weight Band`. Deciding whether a record has one
 * used to happen twice: the synchronizer normalized the lab and shape onto the canonical
 * record, and then the demand calculation normalized them again from the raw columns
 * using whatever the mapping tables held at the moment it ran. The two answers could
 * differ, and they did — canonical inventory grouped a lot under lab `Other` while the
 * demand result grouped the same lot under `IGI`. Inventory, Aging and lab scope read one
 * vocabulary; Stockout and Excess read the other.
 *
 * Worse, re-deriving at run time made a committed demand run retroactively mutable: edit
 * a `LabMapping` row and yesterday's categorisation silently changes meaning.
 *
 * So the decision is made here, once, and persisted. Demand consumes the persisted result
 * and never reinterprets a raw source value.
 *
 * ## What "approved" means
 *
 * A dimension is approved only when it resolves to a value the business has actually
 * confirmed. Two things are deliberately NOT approval:
 *
 *   - A passthrough. `resolveLabNormalization` returns the raw text as `normalized` with
 *     `requiresReview: true` when it recognises nothing. That value is not a lab; it is
 *     the absence of one. It must never be stored in `labNormalized` and must never key a
 *     category, or `EGL_UNAPPROVED|ROUND|1.00-1.09` becomes a planning category that
 *     looks exactly like a real one.
 *   - A placeholder target. Normalising an unrecognised lab to `Other` or `UNKNOWN`
 *     merges genuinely different labs into one valid-looking bucket. Two labs nobody has
 *     mapped are not the same lab.
 *
 * An unapproved dimension leaves its normalized column null, preserves the raw value, and
 * marks the record for review. Existing confirmed policy then blocks or excludes it — this
 * module decides nothing about what happens next.
 *
 * Server-safe and pure: no database access, so the synchronizer, the reconciliation
 * service and the tests all reach the same conclusion from the same inputs.
 */

import { resolveLabNormalization } from "./canonical";

export const CATEGORY_DIMENSION_STATES = ["APPROVED", "UNMAPPED", "UNRESOLVED"] as const;
export type CategoryDimensionState = (typeof CATEGORY_DIMENSION_STATES)[number];

export const CATEGORY_STATES = ["APPROVED", "REVIEW_REQUIRED"] as const;
export type CategoryState = (typeof CATEGORY_STATES)[number];

/** Fixed codes. A reader sees a reason, never a formula or a mapping-table dump. */
export const CATEGORY_REVIEW_REASONS = [
  "LAB_NOT_APPROVED",
  "SHAPE_NOT_APPROVED",
  "WEIGHT_BAND_UNRESOLVED",
] as const;
export type CategoryReviewReason = (typeof CATEGORY_REVIEW_REASONS)[number];

/**
 * Normalization targets that are not business categories.
 *
 * Mapping an unrecognised lab or shape onto one of these produces a bucket that looks
 * like a category and is not: every unmapped value lands in it and stops being
 * distinguishable. Treated as unapproved so the record is quarantined instead.
 */
export const PLACEHOLDER_NORMALIZATIONS: readonly string[] = ["OTHER", "UNKNOWN", "N/A", "NA", "TBD", "PENDING"];

function isPlaceholder(value: string | null): boolean {
  return value !== null && PLACEHOLDER_NORMALIZATIONS.includes(value.trim().toUpperCase());
}

export interface CategoryClassificationInput {
  readonly labRaw: string | null | undefined;
  readonly shapeRaw: string | null | undefined;
  /** Measured carats. Null when the source never established a usable weight. */
  readonly weightCt: number | null;
}

export interface CategoryClassificationContext {
  /** Configured raw→normalized lab mappings, keyed by raw value. */
  readonly labMappings?: Map<string, string>;
  /** Configured raw→normalized shape mappings, keyed by UPPERCASE raw value. */
  readonly shapeMappings: Map<string, string>;
  /** Active weight bands, ascending. */
  readonly weightBands: ReadonlyArray<{ id: string; label: string; minCt: number; maxCt: number }>;
}

export interface CanonicalCategoryClassification {
  /** Approved normalized lab, or null when the source value is not approved. */
  readonly labNormalized: string | null;
  readonly labState: CategoryDimensionState;
  readonly shapeNormalized: string | null;
  readonly shapeState: CategoryDimensionState;
  readonly weightBandId: string | null;
  readonly weightBandLabel: string | null;
  readonly weightBandState: CategoryDimensionState;
  /** `Lab|Shape|Band`, set only when every dimension is approved. */
  readonly categoryKey: string | null;
  readonly state: CategoryState;
  readonly reviewReasons: CategoryReviewReason[];
}

/** The band a measured weight falls in, or null when it falls in none. */
export function resolveApprovedWeightBand(
  weightCt: number | null,
  bands: CategoryClassificationContext["weightBands"],
): { id: string; label: string } | null {
  if (weightCt === null || !Number.isFinite(weightCt) || weightCt <= 0) return null;
  const band = bands.find((b) => weightCt >= b.minCt && weightCt <= b.maxCt);
  return band ? { id: band.id, label: band.label } : null;
}

/**
 * The one place a canonical record's planning category is decided.
 *
 * Returns approved values or nulls — never a raw passthrough dressed up as normalized.
 */
export function classifyCanonicalCategory(
  input: CategoryClassificationInput,
  ctx: CategoryClassificationContext,
): CanonicalCategoryClassification {
  const reviewReasons: CategoryReviewReason[] = [];

  // --- Lab -----------------------------------------------------------------
  const lab = resolveLabNormalization(input.labRaw, ctx.labMappings);
  const labApproved = lab.isRecognized && !lab.requiresReview && !isPlaceholder(lab.normalized);
  const labNormalized = labApproved ? lab.normalized : null;
  const labState: CategoryDimensionState = labApproved ? "APPROVED" : "UNMAPPED";
  if (!labApproved) reviewReasons.push("LAB_NOT_APPROVED");

  // --- Shape ---------------------------------------------------------------
  const rawShape = input.shapeRaw?.trim() ?? "";
  const mappedShape = rawShape ? ctx.shapeMappings.get(rawShape.toUpperCase()) ?? null : null;
  const shapeApproved = mappedShape !== null && !isPlaceholder(mappedShape);
  const shapeNormalized = shapeApproved ? mappedShape : null;
  const shapeState: CategoryDimensionState = shapeApproved ? "APPROVED" : "UNMAPPED";
  if (!shapeApproved) reviewReasons.push("SHAPE_NOT_APPROVED");

  // --- Weight band ---------------------------------------------------------
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
    // A category key exists only when all three dimensions are approved. There is no
    // partial key: a category identified by two confirmed dimensions and one guess is
    // not a category.
    categoryKey: approved ? `${labNormalized}|${shapeNormalized}|${band!.label}` : null,
    state: approved ? "APPROVED" : "REVIEW_REQUIRED",
    reviewReasons,
  };
}

/** The columns a canonical record stores for this decision. */
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

/** The persisted shape a consumer reads back. */
export interface PersistedCategoryClassification {
  readonly labNormalized: string | null;
  readonly shapeNormalized: string | null;
  readonly weightBandLabel: string | null;
  readonly categoryKey: string | null;
  readonly categoryState: string | null;
}

/**
 * Whether a persisted record may enter a planning category.
 *
 * A record written before this classification existed carries nulls. It is treated as
 * requiring review — never as approved by default, which would let unclassified stock
 * into a category on the strength of a missing column.
 */
export function hasApprovedCategory(r: PersistedCategoryClassification): boolean {
  return (
    r.categoryState === "APPROVED" &&
    r.categoryKey !== null &&
    r.labNormalized !== null &&
    r.shapeNormalized !== null &&
    r.weightBandLabel !== null
  );
}

/**
 * The reference reads the classifier needs, structurally typed so the Prisma client, a
 * transaction client and a test double all satisfy it without a cast.
 */
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

/**
 * Loads the reference data the classifier needs.
 *
 * Kept here so the synchronizer, the reconciliation service and the tests build the
 * context the same way and therefore reach the same conclusion.
 */
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
