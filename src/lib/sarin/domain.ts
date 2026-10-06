export const SARIN_PACKET_TYPES = ["BLUE", "WHITE", "PINK"] as const;
export type SarinPacketType = (typeof SARIN_PACKET_TYPES)[number];

export const SARIN_IMPORT_STATUSES = ["UPLOADED", "VALIDATING", "NEEDS_REVIEW", "VALIDATED", "FAILED", "ARCHIVED"] as const;
export type SarinImportStatus = (typeof SARIN_IMPORT_STATUSES)[number];

export const SARIN_SOURCE_ROW_OUTCOMES = ["ACCEPTED", "QUARANTINED", "REJECTED_STRUCTURE"] as const;
export type SarinSourceRowOutcome = (typeof SARIN_SOURCE_ROW_OUTCOMES)[number];

export const SARIN_STONE_BLOCK_PARSE_STATUSES = ["PENDING", "PARSED", "QUARANTINED"] as const;
export type SarinStoneBlockParseStatus = (typeof SARIN_STONE_BLOCK_PARSE_STATUSES)[number];

export const SARIN_VALIDATION_SEVERITIES = ["BLOCKING", "ERROR", "WARNING", "INFO"] as const;
export type SarinValidationSeverity = (typeof SARIN_VALIDATION_SEVERITIES)[number];

export const SARIN_VALIDATION_ISSUE_STATUSES = ["OPEN", "OVERRIDDEN", "RESOLVED", "SUPERSEDED"] as const;
export type SarinValidationIssueStatus = (typeof SARIN_VALIDATION_ISSUE_STATUSES)[number];

export const SARIN_OVERRIDE_KINDS = ["ACKNOWLEDGE_WARNING", "ASSIGN_NORMALIZED_SHAPE", "REVOCATION"] as const;
export type SarinOverrideKind = (typeof SARIN_OVERRIDE_KINDS)[number];

export const SARIN_SHAPE_MAPPING_SET_STATUSES = ["DRAFT", "APPROVED", "RETIRED", "EFFECTIVE", "SUPERSEDED", "ARCHIVED"] as const;
export type SarinShapeMappingSetStatus = (typeof SARIN_SHAPE_MAPPING_SET_STATUSES)[number];

export const SARIN_MAPPING_LINEAGE_STATUSES: readonly string[] = ["EFFECTIVE", "SUPERSEDED", "APPROVED"];

export const SARIN_SHAPE_MAPPING_CONDITION_KINDS = ["NONE", "RATIO_RANGE"] as const;
export type SarinShapeMappingConditionKind = (typeof SARIN_SHAPE_MAPPING_CONDITION_KINDS)[number];

export const SARIN_SHAPE_MAPPING_RESULTS = ["MAPPED", "CONDITIONALLY_MAPPED", "UNMAPPED", "AMBIGUOUS", "OVERRIDDEN"] as const;
export type SarinShapeMappingResult = (typeof SARIN_SHAPE_MAPPING_RESULTS)[number];

export const SARIN_VALIDATION_ATTEMPT_STATUSES = ["RUNNING", "COMPLETED", "FAILED", "ABANDONED"] as const;
export type SarinValidationAttemptStatus = (typeof SARIN_VALIDATION_ATTEMPT_STATUSES)[number];

export const SARIN_PLAN_OPTION_KINDS = ["MAIN", "ADDITIONAL", "MK", "SL", "BP", "BT"] as const;
export type SarinPlanOptionKind = (typeof SARIN_PLAN_OPTION_KINDS)[number];

export const SARIN_VALIDATION_RESULTS = ["VALIDATED", "NEEDS_REVIEW"] as const;
export type SarinValidationResult = (typeof SARIN_VALIDATION_RESULTS)[number];

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

export const outputShape = (piece: { readonly normalizedShape: string | null; readonly rawShape: string }): string => piece.normalizedShape ?? piece.rawShape.trim();

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
