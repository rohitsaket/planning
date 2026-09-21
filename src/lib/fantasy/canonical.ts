/**
 * Canonical Source-Data Contract for Fantasy ERP integration.
 * Defines provider-independent record representations, enums, and normalization rules.
 */

export type CanonicalSourceMode = "FIXTURE" | "FILE_IMPORT" | "FANTASY_API";

export type CanonicalEntityType =
  | "POLISHED"
  | "ROUGH"
  | "WIP"
  | "MEMO"
  | "INVOICE"
  | "DEPARTMENT"
  | "LOCATION";

export type CanonicalLotStatus =
  | "STOCK"
  | "MEMO"
  | "INVOICE"
  | "SOLD"
  | "TRANSFERRED"
  | "ARCHIVED"
  | "CANCELLED"
  | "WIP_PLANNING"
  | "WIP_LASER"
  | "WIP_POLISHING"
  | "WIP_GRADING"
  | "WIP_COMPLETED"
  | "REMOVED_UNKNOWN";

export type CanonicalRemovalReason =
  | "EXPLICIT_SALE"
  | "MEMO_RETURN"
  | "TRANSFERRED"
  | "ARCHIVED"
  | "CANCELLED"
  | "COMPLETED"
  | "CORRECTION"
  | "SOURCE_DISAPPEARANCE_UNKNOWN";

export interface CanonicalRecord {
  sourceType: CanonicalSourceMode;
  sourceRecordId: string;
  lotId: string;
  entityType: CanonicalEntityType;
  currentStatus: CanonicalLotStatus;
  previousStatus?: CanonicalLotStatus | null;
  statusEffectiveDate: string; // ISO UTC
  docDate: string; // ISO UTC
  quantity: number;
  shape: string;
  shapeNormalized?: string | null;
  weight: number;
  color?: string | null;
  clarity?: string | null;
  labRaw?: string | null;
  labNormalized?: string | null;
  certificate?: string | null;
  treatment?: string | null;
  saleTotalUsd?: number | null;
  customerId?: string | null;
  customerCode?: string | null;
  customerName?: string | null;
  departmentId?: string | null;
  departmentName?: string | null;
  locationId?: string | null;
  locationName?: string | null;
  country: string;
  branch: string;
  roughOrPolished: "ROUGH" | "POLISHED" | "WIP" | "OTHER";
  wipStage?: string | null;
  parentRoughId?: string | null;
  kapan?: string | null;
  stoneName?: string | null;
  sourceCreatedAt: string; // ISO UTC
  sourceUpdatedAt: string; // ISO UTC
  firstSeenAt: string; // ISO UTC
  lastSeenAt: string; // ISO UTC
  removedFromLiveAt?: string | null; // ISO UTC
  removalReason?: CanonicalRemovalReason | null;
  isCurrent: boolean;
  checkpoint: number;
  syncBatchId: string;
  recordVersion: number;
  isSimulated: boolean;
  metadata?: Record<string, unknown>;
}

export interface CanonicalRemovalEvent {
  lotId: string;
  removalReason: CanonicalRemovalReason;
  removedFromLiveAt: string; // ISO UTC
  docDate?: string;
  saleTotalUsd?: number | null;
  customerName?: string | null;
  notes?: string;
}

export interface BatchValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Normalizes diamond shape string to standardized uppercase representation.
 */
export function normalizeShape(raw: string | null | undefined): string {
  if (!raw) return "UNKNOWN";
  const trimmed = raw.trim().toUpperCase();
  if (trimmed.includes("ROUND") || trimmed === "RD" || trimmed === "RBC") return "ROUND";
  if (trimmed.includes("EMERALD") || trimmed === "EM") return "EMERALD";
  if (trimmed.includes("OVAL") || trimmed === "OV") return "OVAL";
  if (trimmed.includes("PEAR") || trimmed === "PS") return "PEAR";
  if (trimmed.includes("CUSHION") || trimmed === "CU" || trimmed === "CUSH") return "CUSHION";
  if (trimmed.includes("PRINCESS") || trimmed === "PR") return "PRINCESS";
  if (trimmed.includes("RADIANT") || trimmed === "RAD") return "RADIANT";
  if (trimmed.includes("MARQUISE") || trimmed === "MQ") return "MARQUISE";
  if (trimmed.includes("HEART") || trimmed === "HT") return "HEART";
  return trimmed;
}

export interface LabNormalizationResult {
  normalized: string;
  raw: string | null;
  isRecognized: boolean;
  isNonCert: boolean;
  requiresReview: boolean;
  warning?: string;
}

/**
 * Resolves diamond lab certification with recognition status and configurable mappings.
 * Client Rules:
 * - Blank, null, NONE, UNCERTIFIED -> Non-Cert
 * - Recognized GIA variants -> GIA
 * - Unconfirmed labs (IGI, HRD, etc.) retain raw value unless in configuredMappings, and raise review warning.
 */
export function resolveLabNormalization(
  raw: string | null | undefined,
  configuredMappings?: Map<string, string> | Record<string, string>
): LabNormalizationResult {
  if (!raw || raw.trim() === "") {
    return {
      normalized: "Non-Cert",
      raw: raw ?? null,
      isRecognized: true,
      isNonCert: true,
      requiresReview: false,
    };
  }

  const rawTrimmed = raw.trim();
  const upper = rawTrimmed.toUpperCase();

  // 1. Non-certified representations
  if (
    upper === "NONE" ||
    upper === "NON-CERT" ||
    upper === "NON CERT" ||
    upper === "UNCERTIFIED" ||
    upper === "NO CERT" ||
    upper === "NO-CERT" ||
    upper === "NIL" ||
    upper === "NA" ||
    upper === "N/A"
  ) {
    return {
      normalized: "Non-Cert",
      raw: rawTrimmed,
      isRecognized: true,
      isNonCert: true,
      requiresReview: false,
    };
  }

  // 2. Configured database mappings
  if (configuredMappings) {
    let mapped: string | undefined;
    if (configuredMappings instanceof Map) {
      mapped = configuredMappings.get(rawTrimmed) ?? configuredMappings.get(upper);
    } else {
      mapped = configuredMappings[rawTrimmed] ?? configuredMappings[upper];
    }
    if (mapped) {
      return {
        normalized: mapped,
        raw: rawTrimmed,
        isRecognized: true,
        isNonCert: mapped === "Non-Cert",
        requiresReview: false,
      };
    }
  }

  // 3. Recognized GIA variants
  if (
    upper === "GIA" ||
    upper === "G.I.A." ||
    upper === "GIA CERT" ||
    upper === "GIA REPORT" ||
    upper === "GIA-DOSSIER" ||
    upper === "GIA DOSSIER" ||
    upper.startsWith("GIA ") ||
    upper.endsWith(" GIA") ||
    /^GIA\b/.test(upper)
  ) {
    return {
      normalized: "GIA",
      raw: rawTrimmed,
      isRecognized: true,
      isNonCert: false,
      requiresReview: false,
    };
  }

  // 4. Unconfirmed lab values (IGI, HRD, or new unmapped values)
  // Retain raw value without silently asserting an approved classification, flag for review.
  return {
    normalized: rawTrimmed,
    raw: rawTrimmed,
    isRecognized: false,
    isNonCert: false,
    requiresReview: true,
    warning: `Unconfirmed lab certification "${rawTrimmed}" requires mapping review.`,
  };
}

/**
 * Normalizes diamond lab certification string.
 */
export function normalizeLab(
  raw: string | null | undefined,
  configuredMappings?: Map<string, string> | Record<string, string>
): string {
  return resolveLabNormalization(raw, configuredMappings).normalized;
}

/**
 * Validates a single canonical record for essential data integrity.
 */
export function validateCanonicalRecord(
  rec: CanonicalRecord,
  configuredMappings?: Map<string, string> | Record<string, string>
): BatchValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!rec.lotId || rec.lotId.trim() === "") {
    errors.push("Missing required lotId");
  }

  if (rec.weight === undefined || rec.weight === null || isNaN(rec.weight) || rec.weight <= 0) {
    errors.push(`Invalid weight: ${rec.weight}`);
  } else if (rec.weight > 500) {
    warnings.push(`Unusually high weight: ${rec.weight}ct`);
  }

  if (!rec.shape || rec.shape.trim() === "") {
    errors.push("Missing diamond shape");
  }

  if (!rec.docDate || isNaN(new Date(rec.docDate).getTime())) {
    errors.push(`Invalid docDate: ${rec.docDate}`);
  }

  if (rec.labRaw) {
    const labRes = resolveLabNormalization(rec.labRaw, configuredMappings);
    if (labRes.requiresReview && labRes.warning) {
      warnings.push(labRes.warning);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}
