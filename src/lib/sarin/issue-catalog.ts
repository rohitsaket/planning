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
  SOURCE_ROW_STRUCTURALLY_REJECTED: blocking("Record could not be read", "This record could not be read as a complete Sarin record, so it belongs to no stone."),
  SOURCE_VALUE_QUARANTINED: blocking("A value could not be read", "A value in this record is missing or not written in the expected form."),
  STONE_NAME_INVALID: blocking("Stone name could not be read", "The stone name does not follow the naming form for the selected packet type."),
  STONE_NAME_TYPE_MISMATCH: blocking("Stone name belongs to another packet type", "The stone name follows the naming form of a different packet type than the one selected for this file."),
  STONE_NAME_KAPAN_MISSING: blocking("Kapan is missing from the stone name", "The stone name has no Kapan before its first separator."),
  STONE_NAME_PACKET_MISSING: blocking("Packet is missing from the stone name", "The stone name has no Packet between its separators."),
  STONE_NAME_SIGNER_MISSING: blocking("Signer is missing from the stone name", "The stone name has no Signer after its Packet."),
  STONE_NAME_SURROUNDING_WHITESPACE: blocking("Stone name has extra spaces", "The stone name starts or ends with a space. The file is kept as uploaded; correct the export if the space is not intended."),
  STONE_NAME_REPEATED_NON_CONSECUTIVE: blocking("Stone name appears again later", "This stone name already appeared earlier in the file, separated by other records. Each stone's records must be together."),
  ROUGH_WEIGHT_INVALID: blocking("Rough weight could not be read", "This record's rough weight is missing or not a valid weight, so the stone has no confirmed rough weight."),
  ROUGH_WEIGHT_INCONSISTENT: blocking("Rough weight differs within the stone", "Records of the same stone carry different rough weights. Every record of a stone must carry the same rough weight."),
  SHAPE_MISSING: blocking("Shape is missing", "This record has no shape value."),
  SHAPE_UNMAPPED: blocking("Shape mapping is missing", "This Sarin shape has no mapping yet. It needs a mapping before it can be used."),
  MAPPING_RATIO_MISSING: blocking("Ratio is needed to map this shape", "This shape is mapped according to its Ratio, and this record has no Ratio."),
  MAPPING_NO_CONDITIONAL_RULE: blocking("Ratio is outside the mapped ranges", "This shape is mapped according to its Ratio, and this record's Ratio is outside every mapped range."),
  MAPPING_MULTIPLE_RULES: blocking("More than one shape mapping applies", "More than one mapping applies to this shape, so it cannot be resolved."),
  MAPPING_NORMALIZED_SHAPE_INVALID: blocking("Shape mapping gives an unknown shape", "The mapping names a shape that is not in the ecosystem shape list."),
  // Historical only: raised by validations before Sarin imports stopped carrying a country.
  COUNTRY_NOT_IN_REGISTRY: blocking("Country is not recognised", "The country selected for this file is not in the company's country registry."),
  LAB_NOT_IN_REGISTRY: blocking("Lab is not recognised", "The lab selected for this file is not an active lab in the lab registry."),
  STONE_BLOCK_SHORTER_THAN_MAIN_LIMIT: blocking("Stone has too few plans", "This stone has fewer plan records than its packet type requires for its main plans."),
  MAIN_PLAN_ROW_UNUSABLE: blocking("Main plan could not be built", "This record is one of the stone's main plans, but it could not be read completely."),
  ADDITIONAL_PLAN_ROW_UNUSABLE: blocking("Additional plan could not be built", "This record belongs to the stone's additional plans, but it could not be read completely."),
  NORMALIZED_SHAPE_MISSING: blocking("Plan has no confirmed shape", "This record's shape has no confirmed ecosystem shape, so its plan cannot be built."),
  ESTIMATED_WEIGHT_MISSING: blocking("Estimated weight is missing", "This plan record has no usable estimated weight."),
  GROUPING_INPUT_INVALID: blocking("Additional plan could not be grouped", "This additional plan record has no usable estimated weight, so it cannot be placed in a plan group."),
  OUTPUT_FIELD_UNAVAILABLE: blocking("Plan value is missing", "A value the output shows for every plan is missing from this record."),
  PINK_BLOCK_ROW_COUNT_INVALID: blocking("Expected 45 rows for this Pink stone", "A Pink stone must have exactly 45 plan records in the confirmed order. Records are missing or extra."),
  PINK_PLAN_ROW_UNUSABLE: blocking("Pink plan could not be built", "This record holds a Pink plan position, but it could not be read completely."),
  PINK_MK_SHAPE_MISMATCH: blocking("Shape combination does not match the expected Pink structure", "This Makeable (MK) position must hold its shape family, but the record's shape is different."),
  PINK_SL_PRIMARY_MISMATCH: blocking("Solace plan does not repeat its Makeable plan", "The first piece of a Solace (SL) plan must be the same candidate as the Makeable plan before it, but some of its values differ."),
  PINK_SL_REMAINDER_NOT_ROUND: blocking("Solace remainder is not Round", "The second piece of a Solace (SL) plan must be a Round candidate from the remaining rough."),
  PINK_BP_SHAPE_MISMATCH: blocking("Shape combination does not match the expected Pink structure", "This Best Pair (BP) position holds a different shape than the pair requires."),
  PINK_BT_SHAPE_MISMATCH: blocking("Shape combination does not match the expected Pink structure", "Both pieces of a Best Twin (BT) plan must be the twin's shape, but this record's shape is different."),
  BT_WEIGHT_VARIANCE_UNCONFIRMED: advisory("Best Twin weights differ", "The two pieces of this Best Twin plan differ in estimated weight. This does not block output."),
  // Design v1.7 §15.10: a present Sarin shape with no confirmed mapping is written unchanged, with a warning.
  SHAPE_NOT_MAPPED: advisory("Shape is not mapped", "This Sarin shape has no confirmed mapping, so the output shows it as it appears in the Sarin file."),
} as const satisfies Record<string, IssueDefinition>;

export type SarinIssueCode = keyof typeof SARIN_ISSUE_CATALOG;

const NEXT_STEP = {
  correctSource: "Correct this record in the Sarin export, then process the corrected file.",
  mapping: "Add a mapping for this shape in Mappings, then process the file again.",
  registry: "Ask an administrator to restore the country or lab, then process the file again.",
  advisory: "Weight difference requires review.",
} as const;

/** What a reviewer can do about a finding. Never a repair: every step is a person's decision. */
function nextStepFor(code: string): string {
  if (code === "BT_WEIGHT_VARIANCE_UNCONFIRMED") return NEXT_STEP.advisory;
  if (code === "COUNTRY_NOT_IN_REGISTRY" || code === "LAB_NOT_IN_REGISTRY") return NEXT_STEP.registry;
  if (code === "SHAPE_UNMAPPED" || code === "SHAPE_NOT_MAPPED" || code === "NORMALIZED_SHAPE_MISSING" || code.startsWith("MAPPING_")) return NEXT_STEP.mapping;
  return NEXT_STEP.correctSource;
}

export function describeIssue(code: string): { title: string; explanation: string; nextStep: string } {
  const d = (SARIN_ISSUE_CATALOG as Record<string, IssueDefinition>)[code];
  return d
    ? { title: d.title, explanation: d.explanation, nextStep: nextStepFor(code) }
    : { title: "Issue found", explanation: "An issue was recorded for this file.", nextStep: NEXT_STEP.correctSource };
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
