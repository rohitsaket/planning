// Sarin import vocabulary — the single list of values each Sarin column may hold.
//
// The database enforces these same lists with CHECK constraints (migration
// 20260926090000_sarin_import_foundation); tests/security/sarin-foundation.test.ts proves
// every value here is accepted and an unlisted value is refused, so the two cannot drift.
// Pure constants: safe to import from client and server code alike.

/** Declared by the uploader for the whole batch. Never inferred from Stone Name. */
export const SARIN_PACKET_TYPES = ["BLUE", "WHITE", "PINK"] as const;
export type SarinPacketType = (typeof SARIN_PACKET_TYPES)[number];

/**
 * Import batch lifecycle. There is no success state before validation has actually run,
 * and a failure is always FAILED with a diagnostic code, never a quiet partial success.
 *
 *   UPLOADED     -> VALIDATING | FAILED | ARCHIVED
 *   VALIDATING   -> NEEDS_REVIEW | VALIDATED | FAILED
 *   NEEDS_REVIEW -> VALIDATING | ARCHIVED
 *   VALIDATED    -> VALIDATING | ARCHIVED
 *   FAILED       -> VALIDATING | ARCHIVED
 *   ARCHIVED     (terminal)
 *
 * The transitions are enforced by the database trigger, not by this comment.
 */
export const SARIN_IMPORT_STATUSES = ["UPLOADED", "VALIDATING", "NEEDS_REVIEW", "VALIDATED", "FAILED", "ARCHIVED"] as const;
export type SarinImportStatus = (typeof SARIN_IMPORT_STATUSES)[number];

/** What reading one physical source line produced. Decided once, when the row is stored. */
export const SARIN_SOURCE_ROW_OUTCOMES = ["ACCEPTED", "QUARANTINED", "REJECTED_STRUCTURE"] as const;
export type SarinSourceRowOutcome = (typeof SARIN_SOURCE_ROW_OUTCOMES)[number];

/** Stone Name parsing state of a block. PENDING until parsing runs; then fixed. */
export const SARIN_STONE_BLOCK_PARSE_STATUSES = ["PENDING", "PARSED", "QUARANTINED"] as const;
export type SarinStoneBlockParseStatus = (typeof SARIN_STONE_BLOCK_PARSE_STATUSES)[number];

/** BLOCKING always blocks, WARNING and INFO never do, ERROR is decided per issue code. */
export const SARIN_VALIDATION_SEVERITIES = ["BLOCKING", "ERROR", "WARNING", "INFO"] as const;
export type SarinValidationSeverity = (typeof SARIN_VALIDATION_SEVERITIES)[number];

/** OPEN -> OVERRIDDEN | RESOLVED | SUPERSEDED; OVERRIDDEN -> OPEN (after revocation) | SUPERSEDED. */
export const SARIN_VALIDATION_ISSUE_STATUSES = ["OPEN", "OVERRIDDEN", "RESOLVED", "SUPERSEDED"] as const;
export type SarinValidationIssueStatus = (typeof SARIN_VALIDATION_ISSUE_STATUSES)[number];

/**
 * Kinds of append-only review decision. Which issue codes accept which kind is review
 * policy, decided with the review workflow; the database already refuses acknowledging a
 * blocking issue and revoking a revocation.
 */
export const SARIN_OVERRIDE_KINDS = ["ACKNOWLEDGE_WARNING", "ASSIGN_NORMALIZED_SHAPE", "REVOCATION"] as const;
export type SarinOverrideKind = (typeof SARIN_OVERRIDE_KINDS)[number];

/**
 * DRAFT -> EFFECTIVE -> SUPERSEDED for saved catalog snapshots; DRAFT -> ARCHIVED for a
 * draft that was never used. APPROVED and RETIRED are records of the former approval
 * workflow. Rules are editable only while DRAFT.
 */
export const SARIN_SHAPE_MAPPING_SET_STATUSES = ["DRAFT", "APPROVED", "RETIRED", "EFFECTIVE", "SUPERSEDED", "ARCHIVED"] as const;
export type SarinShapeMappingSetStatus = (typeof SARIN_SHAPE_MAPPING_SET_STATUSES)[number];

/**
 * Mapping sets a completed validation can stand on for output: the snapshot it captured
 * stays valid lineage after a newer one replaces it, as does a set approved under the former
 * workflow. A RETIRED set was withdrawn, so its validations must be processed again.
 */
export const SARIN_MAPPING_LINEAGE_STATUSES: readonly string[] = ["EFFECTIVE", "SUPERSEDED", "APPROVED"];

/** How a mapping rule applies: always, or only within an inclusive Ratio range. */
export const SARIN_SHAPE_MAPPING_CONDITION_KINDS = ["NONE", "RATIO_RANGE"] as const;
export type SarinShapeMappingConditionKind = (typeof SARIN_SHAPE_MAPPING_CONDITION_KINDS)[number];

/**
 * How one source shape resolved against a mapping set, recorded per row per validation
 * attempt (SarinRowInterpretation) because it depends on the mapping version rather than
 * on the immutable source row. UNMAPPED and AMBIGUOUS are review outcomes, never a
 * fallback shape; OVERRIDDEN is reserved for a reviewed decision.
 */
export const SARIN_SHAPE_MAPPING_RESULTS = ["MAPPED", "CONDITIONALLY_MAPPED", "UNMAPPED", "AMBIGUOUS", "OVERRIDDEN"] as const;
export type SarinShapeMappingResult = (typeof SARIN_SHAPE_MAPPING_RESULTS)[number];

/** RUNNING until finalized once: COMPLETED with a result, FAILED, or ABANDONED (lease expired). */
export const SARIN_VALIDATION_ATTEMPT_STATUSES = ["RUNNING", "COMPLETED", "FAILED", "ABANDONED"] as const;
export type SarinValidationAttemptStatus = (typeof SARIN_VALIDATION_ATTEMPT_STATUSES)[number];

/**
 * Kinds of plan option in a structured output. Blue/White: MAIN and ADDITIONAL. Pink: MK
 * (Makeable), SL (Solace), BP (Best Pair) and BT (Best Twin), derived from record positions.
 */
export const SARIN_PLAN_OPTION_KINDS = ["MAIN", "ADDITIONAL", "MK", "SL", "BP", "BT"] as const;
export type SarinPlanOptionKind = (typeof SARIN_PLAN_OPTION_KINDS)[number];

/** The outcome of a COMPLETED attempt: no blocking finding, or findings a person must review. */
export const SARIN_VALIDATION_RESULTS = ["VALIDATED", "NEEDS_REVIEW"] as const;
export type SarinValidationResult = (typeof SARIN_VALIDATION_RESULTS)[number];

/**
 * The ecosystem shape vocabulary a Sarin mapping may produce: the target column of the
 * confirmed Sarin shape master (SARIN SHAPE workbook; design v1.7 §15.10), spelling included,
 * plus shapes the client has confirmed since (Kriss Cut, for RAD MODIFIED). A mapping rule
 * naming anything else is refused. Extending it is a business decision, made here
 * deliberately, never by a mapping edit.
 */
export const SARIN_ECOSYSTEM_SHAPES = [
  "Round",
  "Old European Brilliant",
  "Marquise",
  "Antique Marquise",
  "Pear",
  "Oval",
  "Asscher",
  "Emerald",
  "Radiant Modified",
  "Radiant",
  "Square Cushion Brilliant",
  "Square Cushion Modified",
  "Cushion Brilliant",
  "Cushion Modified",
  "Square Antique Cushion",
  "Antique Cushion",
  "Princess",
  "Heart",
  "KRISS OVAL",
  // Client-confirmed Fantasy shape for the Sarin shape RAD MODIFIED.
  "Kriss Cut",
  "Step Marquise",
  "Antique Oval",
  "Moval",
  "Febrizio",
  "Lozenge Step Cut",
  "Kite",
  "Triangle",
  "Cadillacs",
  "Trapper Baguette",
  "Trapezoid",
  "BRILLANT TRAPEZOID",
  "Moon Half",
  "Baguette",
] as const;
export type SarinEcosystemShape = (typeof SARIN_ECOSYSTEM_SHAPES)[number];

/**
 * The shape an output row shows (column I): its canonical Fantasy shape when mapped, or the
 * trimmed raw Sarin shape where the mapping set has none (design v1.7 §15.10). A raw value is
 * never presented as a canonical shape: callers keep `shapeResolution` beside it.
 */
export const outputShape = (piece: { readonly normalizedShape: string | null; readonly rawShape: string }): string => piece.normalizedShape ?? piece.rawShape.trim();

/**
 * The Fantasy shape code of each ecosystem shape: the ID column of the confirmed Sarin shape
 * master (SARIN SHAPE workbook). Shown to mapping administrators beside the shape name; the
 * output workbook writes the name, never the code (design v1.7 §15.10). null where no
 * authoritative source gives the code yet: it is never invented.
 */
export const SARIN_FANTASY_SHAPE_CODES: Readonly<Record<SarinEcosystemShape, string | null>> = {
  Round: "BR",
  "Old European Brilliant": "EURO",
  Marquise: "MQ",
  "Antique Marquise": "ANMQ",
  Pear: "PS",
  Oval: "OV",
  Asscher: "AS",
  Emerald: "EM",
  "Radiant Modified": "MORAD",
  Radiant: "RAD",
  "Square Cushion Brilliant": "SCB",
  "Square Cushion Modified": "SQMOCU",
  "Cushion Brilliant": "BECU",
  "Cushion Modified": "MOCU",
  "Square Antique Cushion": "SQANCU",
  "Antique Cushion": "ANCU",
  Princess: "PR",
  Heart: "HS",
  "KRISS OVAL": "KOV",
  // Not in the SARIN SHAPE master, the design document or the Fantasy shape data: pending.
  "Kriss Cut": null,
  "Step Marquise": "SM",
  "Antique Oval": "ANOV",
  Moval: "MOV",
  Febrizio: "FBZ",
  "Lozenge Step Cut": "LSC",
  Kite: "KITE",
  Triangle: "TRI",
  Cadillacs: "CAD",
  "Trapper Baguette": "TP",
  Trapezoid: "TRA",
  "BRILLANT TRAPEZOID": "BETR",
  "Moon Half": "HM",
  Baguette: "BAG",
};
