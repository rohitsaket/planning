/**
 * The stable finding codes a Sarin validation attempt can raise, with the wording shown to
 * reviewers. Wording explains what is wrong and what to check; it deliberately names no
 * pattern, threshold, formula or query, because it is displayed as-is.
 *
 * A BLOCKING finding keeps the batch in NEEDS_REVIEW until it is resolved, reviewed or the
 * source is corrected. A WARNING is an advisory: it stays visible on the validation but
 * does not block output. Nothing is ever repaired automatically.
 *
 * Server-only.
 */

if (typeof window !== "undefined") {
  throw new Error("sarin/issue-catalog is server-only and must not be imported by client code.");
}

interface IssueDefinition {
  readonly title: string;
  readonly explanation: string;
  readonly severity: "BLOCKING" | "WARNING";
}

const blocking = (title: string, explanation: string): IssueDefinition => ({ title, explanation, severity: "BLOCKING" });
const advisory = (title: string, explanation: string): IssueDefinition => ({ title, explanation, severity: "WARNING" });

export const SARIN_ISSUE_CATALOG = {
  SOURCE_ROW_STRUCTURALLY_REJECTED: blocking("Unreadable source record", "This record could not be read as a complete Sarin record, so it belongs to no stone."),
  SOURCE_VALUE_QUARANTINED: blocking("Source value not usable", "A value in this record is missing or not written in the expected form."),
  STONE_NAME_INVALID: blocking("Stone Name not recognised", "The Stone Name does not follow the naming form for the declared stone type."),
  STONE_NAME_TYPE_MISMATCH: blocking("Stone Name looks like another stone type", "The Stone Name follows the naming form of a different stone type than the one declared for this import."),
  STONE_NAME_KAPAN_MISSING: blocking("Kapan missing from Stone Name", "The Stone Name has no Kapan before its first separator."),
  STONE_NAME_PACKET_MISSING: blocking("Packet missing from Stone Name", "The Stone Name has no Packet between its separators."),
  STONE_NAME_SIGNER_MISSING: blocking("Signer missing from Stone Name", "The Stone Name has no Signer after its Packet."),
  STONE_NAME_SURROUNDING_WHITESPACE: blocking("Stone Name has leading or trailing spaces", "The Stone Name starts or ends with a space. The source is kept as uploaded; correct the export if the space is not intended."),
  STONE_NAME_REPEATED_NON_CONSECUTIVE: blocking("Stone Name appears again later", "This Stone Name already appeared earlier in the file, separated by other records. Each stone's records must be together."),
  ROUGH_WEIGHT_INVALID: blocking("Rough Weight not usable", "This record's Rough Weight is missing or not a valid weight, so the stone has no confirmed Rough Weight."),
  ROUGH_WEIGHT_INCONSISTENT: blocking("Rough Weight differs within the stone", "Records of the same stone carry different Rough Weights. Every record of a stone must carry the same Rough Weight."),
  SHAPE_MISSING: blocking("Shape missing", "This record has no shape value."),
  SHAPE_UNMAPPED: blocking("Shape has no approved mapping", "This Sarin shape is not in the approved shape mapping. It needs a confirmed mapping before it can be used."),
  MAPPING_RATIO_MISSING: blocking("Ratio needed to map this shape", "This shape is mapped according to its Ratio, and this record has no Ratio."),
  MAPPING_NO_CONDITIONAL_RULE: blocking("Ratio outside the mapped ranges", "This shape is mapped according to its Ratio, and this record's Ratio is outside every approved range."),
  MAPPING_MULTIPLE_RULES: blocking("More than one mapping applies", "More than one approved mapping rule applies to this shape, so it cannot be resolved."),
  MAPPING_NORMALIZED_SHAPE_INVALID: blocking("Mapping gives an unknown shape", "The approved mapping names a shape that is not in the ecosystem shape list."),
  COUNTRY_NOT_IN_REGISTRY: blocking("Country not in the country registry", "The country declared for this import is not in the company's country registry."),
  LAB_NOT_IN_REGISTRY: blocking("Lab not in the lab registry", "The lab declared for this import is not an active lab in the lab registry."),
  STONE_BLOCK_SHORTER_THAN_MAIN_LIMIT: blocking("Stone has too few plans", "This stone has fewer plan records than its stone type requires for its main plans."),
  MAIN_PLAN_ROW_UNUSABLE: blocking("Main plan cannot be built", "This record is one of the stone's main plans, but it could not be read completely, so the plan cannot be built."),
  ADDITIONAL_PLAN_ROW_UNUSABLE: blocking("Additional plan cannot be built", "This record belongs to the stone's additional plans, but it could not be read completely, so the plan cannot be built."),
  NORMALIZED_SHAPE_MISSING: blocking("Plan has no confirmed shape", "This record's shape has no confirmed ecosystem shape, so its plan cannot be built."),
  ESTIMATED_WEIGHT_MISSING: blocking("Plan has no Estimated Weight", "This plan record has no usable Estimated Weight."),
  GROUPING_INPUT_INVALID: blocking("Additional plan cannot be grouped", "This additional plan record has no usable Estimated Weight, so it cannot be placed in a plan group."),
  OUTPUT_FIELD_UNAVAILABLE: blocking("Plan value missing", "A value the structured output shows for every plan is missing from this record."),
  PINK_BLOCK_ROW_COUNT_INVALID: blocking("Pink stone does not have 45 plan records", "A Pink stone must have exactly 45 plan records in the confirmed order. Records are missing or extra, so no plan position can be trusted."),
  PINK_PLAN_ROW_UNUSABLE: blocking("Pink plan cannot be built", "This record holds a Pink plan position, but it could not be read completely, so the plan cannot be built."),
  PINK_MK_SHAPE_MISMATCH: blocking("Makeable plan has an unexpected shape", "This Makeable (MK) position must hold its shape family, but the record's confirmed shape is different."),
  PINK_SL_PRIMARY_MISMATCH: blocking("Solace plan does not repeat its Makeable candidate", "The first piece of a Solace (SL) plan must be the same candidate as the Makeable plan before it, but some of its values differ."),
  PINK_SL_REMAINDER_NOT_ROUND: blocking("Solace remainder is not Round", "The second piece of a Solace (SL) plan must be a Round candidate from the remaining rough."),
  PINK_BP_SHAPE_MISMATCH: blocking("Best Pair has an unexpected shape", "This Best Pair (BP) position holds a different shape than the confirmed pair requires."),
  PINK_BT_SHAPE_MISMATCH: blocking("Best Twin has an unexpected shape", "Both pieces of a Best Twin (BT) plan must be the twin's shape, but this record's confirmed shape is different."),
  BT_WEIGHT_VARIANCE_UNCONFIRMED: advisory("Best Twin weights differ slightly", "The two pieces of this Best Twin plan differ in Estimated Weight. No tolerance has been confirmed, so the difference is shown for review and does not block the plan."),
} as const satisfies Record<string, IssueDefinition>;

export type SarinIssueCode = keyof typeof SARIN_ISSUE_CATALOG;

export function describeIssue(code: string): { title: string; explanation: string } {
  const d = (SARIN_ISSUE_CATALOG as Record<string, IssueDefinition>)[code];
  return d ? { title: d.title, explanation: d.explanation } : { title: "Validation finding", explanation: "A validation finding was recorded for this import." };
}

/** Positional field (1–11) named by a Phase 3 row rejection code, for issue lineage. */
export const REJECTION_FIELD_POSITION: Record<string, { position: number; field: string }> = {
  STONE_NAME: { position: 1, field: "stoneName" },
  ROUGH_WEIGHT: { position: 2, field: "roughWeight" },
  SHAPE: { position: 3, field: "shape" },
  ESTIMATED_WEIGHT: { position: 4, field: "estimatedWeight" },
  DEPTH_PCT: { position: 7, field: "depthPct" },
  RATIO: { position: 8, field: "ratio" },
  LENGTH: { position: 9, field: "length" },
  WIDTH: { position: 10, field: "width" },
  DEPTH_MM: { position: 11, field: "depthMm" },
};
