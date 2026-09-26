// Sarin import vocabulary — the single list of values each Sarin column may hold.
//
// The database enforces these same lists with CHECK constraints (migration
// 20260926090000_sarin_import_foundation); tests/security/sarin-foundation.test.ts proves
// every value here is accepted and an unlisted value is refused, so the two cannot drift.
// Pure constants: safe to import from client and server code alike.

/** Declared by the uploader for the whole batch. Never inferred from Stone Name. */
export const SARIN_STONE_TYPES = ["BLUE", "WHITE", "PINK"] as const;
export type SarinStoneType = (typeof SARIN_STONE_TYPES)[number];

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

/** DRAFT -> APPROVED | RETIRED; APPROVED -> RETIRED. Rules are editable only while DRAFT. */
export const SARIN_SHAPE_MAPPING_SET_STATUSES = ["DRAFT", "APPROVED", "RETIRED"] as const;
export type SarinShapeMappingSetStatus = (typeof SARIN_SHAPE_MAPPING_SET_STATUSES)[number];

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
 * The ecosystem shape vocabulary a Sarin mapping may produce: exactly the target column of
 * the confirmed Sarin shape master (SARIN SHAPE workbook; design v1.7 §15.10), spelling
 * included. A mapping rule naming anything else is refused. Extending it is a business
 * decision, made here deliberately, never by a mapping edit.
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
