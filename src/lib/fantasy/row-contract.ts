/**
 * FANTASY SOURCE ROW CONTRACT — version 1.
 *
 * The single authoritative definition of the 46-column Fantasy row, the only place
 * where Fantasy header strings exist, and the only boundary that turns a provider
 * row into an internal raw record.
 *
 * What this module deliberately does NOT do:
 *   - It assigns no business meaning. An internal key name is a label, not a
 *     confirmed semantic: `onHoldRaw` is not a boolean, `quantityRaw` is not a
 *     piece count, `weightRaw` has no confirmed unit, and `sizeRaw`, `m1Raw`,
 *     `m2Raw` and `m3Raw` are entirely unconfirmed.
 *   - It parses no dates, maps no statuses, merges no fields, and never infers a
 *     value that the source did not supply.
 *   - It never lets a row field act as a synchronization cursor; cursor metadata
 *     travels beside the rows, never inside them.
 *
 * Server-only: raw Fantasy rows may contain remarks, account, company and document
 * identifiers that must never reach a browser bundle.
 */

if (typeof window !== "undefined") {
  // A hard failure is better than silently shipping raw-source handling to a browser.
  // (Next.js documents the `server-only` package for a build-time error; this guard
  // keeps the same boundary without adding a dependency.)
  throw new Error("fantasy/row-contract is server-only and must not be imported by client code.");
}

// ---------------------------------------------------------------------------
// Contract version
// ---------------------------------------------------------------------------

/** Identifier recorded by sync runs, imports, audit records and diagnostics. */
export const FANTASY_ROW_CONTRACT_V1 = "FANTASY_ROW_CONTRACT_V1";

/** Every contract version this build can ingest. Older/newer versions are refused. */
export const SUPPORTED_FANTASY_CONTRACT_VERSIONS = [FANTASY_ROW_CONTRACT_V1] as const;

export type FantasyContractVersion = (typeof SUPPORTED_FANTASY_CONTRACT_VERSIONS)[number];

export function isSupportedContractVersion(version: string): version is FantasyContractVersion {
  return (SUPPORTED_FANTASY_CONTRACT_VERSIONS as readonly string[]).includes(version);
}

// ---------------------------------------------------------------------------
// The 46 headers, in source order and exact spelling
// ---------------------------------------------------------------------------

/**
 * Exact Fantasy headers. Punctuation is significant: `Fluo.` ends with a period,
 * `Met.Wgt` and `Tot.Dia.Wgt` contain periods, and `Metal Wgt` / `Met.Wgt` are two
 * different source fields.
 */
export const FANTASY_V1_HEADERS = [
  "Metal ID",
  "Metal Wgt",
  "Previous Department Account Name",
  "Process Name",
  "Remark",
  "Qty",
  "Lot ID",
  "Lot Name",
  "On Hold",
  "Lot Status DB",
  "Shape",
  "Color",
  "Clarity",
  "Size",
  "Weight",
  "Lab Name",
  "Certificate No",
  "Cut",
  "Polish",
  "Symm",
  "Fluo.",
  "M1",
  "M2",
  "M3",
  "Table",
  "Depth",
  "Ratio",
  "Tone",
  "Department Account Name",
  "Est. Clarity ID",
  "Est. Color ID",
  "Avg Weight",
  "Allocation Date",
  "Allocation Account ID",
  "Certificate ID",
  "Company ID",
  "Doc ID",
  "Est. Shape ID",
  "Est. Weight",
  "Fancy Color",
  "Metal Color",
  "Met.Wgt",
  "Original Weight",
  "Tot.Dia.Wgt",
  "Doc Date",
  "ItemName",
] as const;

export type FantasyV1Header = (typeof FANTASY_V1_HEADERS)[number];

/** Headers without which a row cannot be identified at all. */
export const FANTASY_IDENTITY_HEADERS = ["Lot ID"] as const satisfies readonly FantasyV1Header[];

// ---------------------------------------------------------------------------
// Header → internal key
// ---------------------------------------------------------------------------

/**
 * One stable internal key per header. `Raw` suffixes mark values whose type, unit,
 * encoding or business meaning is not yet confirmed by the client.
 */
export const FANTASY_V1_HEADER_TO_KEY = {
  "Metal ID": "metalId",
  "Metal Wgt": "metalWeightRaw",
  "Previous Department Account Name": "previousDepartmentAccountName",
  "Process Name": "processName",
  Remark: "remark",
  Qty: "quantityRaw",
  "Lot ID": "lotId",
  "Lot Name": "lotName",
  "On Hold": "onHoldRaw",
  "Lot Status DB": "lotStatusRaw",
  Shape: "shapeRaw",
  Color: "colorRaw",
  Clarity: "clarityRaw",
  Size: "sizeRaw",
  Weight: "weightRaw",
  "Lab Name": "labNameRaw",
  "Certificate No": "certificateNumber",
  Cut: "cutRaw",
  Polish: "polishRaw",
  Symm: "symmetryRaw",
  "Fluo.": "fluorescenceRaw",
  M1: "m1Raw",
  M2: "m2Raw",
  M3: "m3Raw",
  Table: "tableRaw",
  Depth: "depthRaw",
  Ratio: "ratioRaw",
  Tone: "toneRaw",
  "Department Account Name": "departmentAccountName",
  "Est. Clarity ID": "estimatedClarityId",
  "Est. Color ID": "estimatedColorId",
  "Avg Weight": "averageWeightRaw",
  "Allocation Date": "allocationDateRaw",
  "Allocation Account ID": "allocationAccountId",
  "Certificate ID": "certificateId",
  "Company ID": "companyId",
  "Doc ID": "documentId",
  "Est. Shape ID": "estimatedShapeId",
  "Est. Weight": "estimatedWeightRaw",
  "Fancy Color": "fancyColorRaw",
  "Metal Color": "metalColorRaw",
  "Met.Wgt": "metWeightRaw",
  "Original Weight": "originalWeightRaw",
  "Tot.Dia.Wgt": "totalDiamondWeightRaw",
  "Doc Date": "documentDateRaw",
  ItemName: "itemName",
} as const satisfies Record<FantasyV1Header, string>;

export type FantasyRawKey = (typeof FANTASY_V1_HEADER_TO_KEY)[FantasyV1Header];

/** Reverse lookup, derived from the single mapping above so the two cannot drift apart. */
export const FANTASY_V1_KEY_TO_HEADER: Readonly<Record<FantasyRawKey, FantasyV1Header>> = Object.freeze(
  Object.fromEntries(
    (Object.entries(FANTASY_V1_HEADER_TO_KEY) as Array<[FantasyV1Header, FantasyRawKey]>).map(([header, key]) => [key, header]),
  ) as Record<FantasyRawKey, FantasyV1Header>,
);

// ---------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------

/**
 * Scalar values accepted at the boundary. `undefined` means the source supplied no
 * cell for that header; `null` means the source explicitly supplied no value. Both
 * are preserved, and neither is ever turned into "", 0 or false.
 */
export type FantasySourceValue = string | number | boolean | null | undefined;

/** One normalized Fantasy row: every contract key present, no invented values. */
export type FantasyRawRecord = Readonly<Record<FantasyRawKey, FantasySourceValue>>;

/** A provider row, positional (spreadsheet) or keyed by header (API/JSON). */
export type FantasySourceRow = readonly unknown[] | Readonly<Record<string, unknown>>;

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

export type FantasyIssueSeverity = "FATAL" | "DRIFT";

export type FantasyIssueCode =
  // fatal
  | "UNSUPPORTED_CONTRACT_VERSION"
  | "MISSING_IDENTITY_HEADER"
  | "DUPLICATE_HEADER"
  | "EMPTY_HEADER"
  | "UNSUPPORTED_VALUE_TYPE"
  | "MISSING_IDENTITY_VALUE"
  // drift / review
  | "MISSING_HEADER"
  | "UNKNOWN_HEADER"
  | "HEADER_ORDER_CHANGED"
  | "HEADER_CASE_MISMATCH"
  | "HEADER_WHITESPACE_MISMATCH"
  | "HEADER_PUNCTUATION_MISMATCH"
  | "ROW_TOO_SHORT"
  | "ROW_TOO_LONG";

/**
 * A diagnostic that is safe to log, audit and return from an API: it names the
 * header, position and code, and never carries a source value.
 */
export interface FantasyContractIssue {
  readonly code: FantasyIssueCode;
  readonly severity: FantasyIssueSeverity;
  /** Header name involved, when the issue concerns a known or supplied header. */
  readonly header?: string;
  /** Internal key involved, when the issue concerns a mapped field. */
  readonly key?: FantasyRawKey;
  /** Zero-based column position in the supplied header list. */
  readonly column?: number;
  /** One-based row number within the batch. */
  readonly row?: number;
  /** Fixed explanatory text. Never contains a source value. */
  readonly message: string;
}

const FATAL_CODES: ReadonlySet<FantasyIssueCode> = new Set<FantasyIssueCode>([
  "UNSUPPORTED_CONTRACT_VERSION",
  "MISSING_IDENTITY_HEADER",
  "DUPLICATE_HEADER",
  "EMPTY_HEADER",
  "UNSUPPORTED_VALUE_TYPE",
  "MISSING_IDENTITY_VALUE",
]);

function issue(
  code: FantasyIssueCode,
  message: string,
  where: { header?: string; key?: FantasyRawKey; column?: number; row?: number } = {},
): FantasyContractIssue {
  return { code, severity: FATAL_CODES.has(code) ? "FATAL" : "DRIFT", message, ...where };
}

// ---------------------------------------------------------------------------
// Header validation
// ---------------------------------------------------------------------------

/** Case-folded comparison form. */
const foldCase = (h: string) => h.toLowerCase();
/** Whitespace-insensitive comparison form (collapsed and trimmed, case kept). */
const foldWhitespace = (h: string) => h.replace(/\s+/g, " ").trim();
/** Punctuation- and whitespace-insensitive comparison form. */
const foldPunctuation = (h: string) => h.replace(/[^A-Za-z0-9]/g, "").toLowerCase();

const EXPECTED_BY_EXACT = new Map<string, FantasyV1Header>(FANTASY_V1_HEADERS.map((h) => [h, h]));
const EXPECTED_BY_CASE = new Map<string, FantasyV1Header>(FANTASY_V1_HEADERS.map((h) => [foldCase(h), h]));
const EXPECTED_BY_WHITESPACE = new Map<string, FantasyV1Header>(FANTASY_V1_HEADERS.map((h) => [foldWhitespace(h), h]));
const EXPECTED_BY_PUNCTUATION = new Map<string, FantasyV1Header>(FANTASY_V1_HEADERS.map((h) => [foldPunctuation(h), h]));

export interface FantasyHeaderValidation {
  readonly contractVersion: string;
  /** True when no fatal issue was found; drift may still be present. */
  readonly ok: boolean;
  /** Positional plan: the internal key for each supplied column, or null when unmapped. */
  readonly columnKeys: readonly (FantasyRawKey | null)[];
  /** Expected headers that were not supplied exactly. */
  readonly missingHeaders: readonly FantasyV1Header[];
  readonly issues: readonly FantasyContractIssue[];
}

/**
 * Validates a supplied header row against contract v1.
 *
 * Only an exact header match is mapped. A case, whitespace or punctuation variant is
 * reported so a later, explicitly versioned adapter can decide what to do with it —
 * it is never silently accepted as the expected header.
 */
export function validateFantasyHeaders(
  headers: readonly unknown[],
  options: { contractVersion?: string } = {},
): FantasyHeaderValidation {
  const contractVersion = options.contractVersion ?? FANTASY_ROW_CONTRACT_V1;
  const issues: FantasyContractIssue[] = [];

  if (!isSupportedContractVersion(contractVersion)) {
    return {
      contractVersion,
      ok: false,
      columnKeys: [],
      missingHeaders: [...FANTASY_V1_HEADERS],
      issues: [
        issue(
          "UNSUPPORTED_CONTRACT_VERSION",
          `Contract version is not supported by this build. Supported: ${SUPPORTED_FANTASY_CONTRACT_VERSIONS.join(", ")}.`,
        ),
      ],
    };
  }

  const columnKeys: (FantasyRawKey | null)[] = [];
  const matchedAtColumn = new Map<FantasyV1Header, number>();

  headers.forEach((supplied, column) => {
    if (typeof supplied !== "string" || supplied.trim() === "") {
      issues.push(issue("EMPTY_HEADER", "Header name is empty or not text.", { column }));
      columnKeys.push(null);
      return;
    }

    const exact = EXPECTED_BY_EXACT.get(supplied);
    if (exact) {
      if (matchedAtColumn.has(exact)) {
        issues.push(
          issue("DUPLICATE_HEADER", "Expected header appears more than once.", { header: exact, column }),
        );
        columnKeys.push(null);
        return;
      }
      matchedAtColumn.set(exact, column);
      columnKeys.push(FANTASY_V1_HEADER_TO_KEY[exact]);
      return;
    }

    // Not exact: diagnose how it differs, but do not map it.
    const byWhitespace = EXPECTED_BY_WHITESPACE.get(foldWhitespace(supplied));
    const byCase = EXPECTED_BY_CASE.get(foldCase(supplied));
    const byPunctuation = EXPECTED_BY_PUNCTUATION.get(foldPunctuation(supplied));

    if (byWhitespace) {
      issues.push(
        issue("HEADER_WHITESPACE_MISMATCH", "Header differs from the contract only by whitespace.", {
          header: byWhitespace,
          column,
        }),
      );
    } else if (byCase) {
      issues.push(
        issue("HEADER_CASE_MISMATCH", "Header differs from the contract only by letter case.", {
          header: byCase,
          column,
        }),
      );
    } else if (byPunctuation) {
      issues.push(
        issue("HEADER_PUNCTUATION_MISMATCH", "Header differs from the contract only by punctuation or spacing.", {
          header: byPunctuation,
          column,
        }),
      );
    } else {
      issues.push(issue("UNKNOWN_HEADER", "Header is not part of this contract version.", { column }));
    }
    columnKeys.push(null);
  });

  const missingHeaders = FANTASY_V1_HEADERS.filter((h) => !matchedAtColumn.has(h));
  for (const header of missingHeaders) {
    const identity = (FANTASY_IDENTITY_HEADERS as readonly string[]).includes(header);
    issues.push(
      issue(
        identity ? "MISSING_IDENTITY_HEADER" : "MISSING_HEADER",
        identity
          ? "Identity header is missing; rows cannot be identified safely."
          : "Expected header was not supplied.",
        { header },
      ),
    );
  }

  // Order is only meaningful once every header is present exactly.
  if (missingHeaders.length === 0) {
    const suppliedOrder = FANTASY_V1_HEADERS.map((h) => matchedAtColumn.get(h)!);
    const inOrder = suppliedOrder.every((column, i) => column === i);
    if (!inOrder) {
      issues.push(issue("HEADER_ORDER_CHANGED", "All expected headers are present but their order changed."));
    }
  }

  return {
    contractVersion,
    ok: !issues.some((i) => i.severity === "FATAL"),
    columnKeys,
    missingHeaders,
    issues,
  };
}

// ---------------------------------------------------------------------------
// Row normalization
// ---------------------------------------------------------------------------

/** An empty record with every contract key present and no value supplied. */
function emptyRecord(): Record<FantasyRawKey, FantasySourceValue> {
  const record = {} as Record<FantasyRawKey, FantasySourceValue>;
  for (const header of FANTASY_V1_HEADERS) record[FANTASY_V1_HEADER_TO_KEY[header]] = undefined;
  return record;
}

/**
 * Conservative value normalization: strings lose only surrounding whitespace, and
 * numbers, booleans, null and undefined pass through untouched. Nothing is coerced,
 * cased or parsed.
 */
function normalizeValue(value: unknown): { ok: true; value: FantasySourceValue } | { ok: false } {
  if (value === null || value === undefined) return { ok: true, value };
  if (typeof value === "string") return { ok: true, value: value.trim() };
  if (typeof value === "boolean") return { ok: true, value };
  if (typeof value === "number") return Number.isFinite(value) ? { ok: true, value } : { ok: false };
  return { ok: false };
}

export interface FantasyRowResult {
  /** One-based row number within the batch. */
  readonly row: number;
  /** True when the row carries no fatal issue. */
  readonly ok: boolean;
  /** Normalized record, or null when the row could not be associated safely. */
  readonly record: FantasyRawRecord | null;
  /**
   * The untouched provider row, kept in memory for staging and quarantine in a later
   * phase. It is never part of diagnostics and must never be serialized to a browser.
   */
  readonly rawSourceRow: FantasySourceRow;
  readonly issues: readonly FantasyContractIssue[];
}

/**
 * Turns one provider row into a normalized raw record using a validated header plan.
 * Structure only: no enum, date, unit or quantity interpretation happens here.
 */
export function normalizeFantasyRow(
  row: FantasySourceRow,
  headerValidation: FantasyHeaderValidation,
  rowNumber: number,
): FantasyRowResult {
  const issues: FantasyContractIssue[] = [];
  const record = emptyRecord();
  const assigned = new Set<FantasyRawKey>();

  const assign = (key: FantasyRawKey, value: unknown, column?: number) => {
    const normalized = normalizeValue(value);
    if (!normalized.ok) {
      issues.push(
        issue("UNSUPPORTED_VALUE_TYPE", `Value type "${describeType(value)}" is not supported at the boundary.`, {
          key,
          header: FANTASY_V1_KEY_TO_HEADER[key],
          column,
          row: rowNumber,
        }),
      );
      return;
    }
    record[key] = normalized.value;
    assigned.add(key);
  };

  if (Array.isArray(row)) {
    const plan = headerValidation.columnKeys;
    if (row.length < plan.length) {
      issues.push(
        issue("ROW_TOO_SHORT", `Row supplies ${row.length} values for ${plan.length} headers.`, { row: rowNumber }),
      );
    } else if (row.length > plan.length) {
      issues.push(
        issue("ROW_TOO_LONG", `Row supplies ${row.length} values for ${plan.length} headers.`, { row: rowNumber }),
      );
    }
    plan.forEach((key, column) => {
      if (!key) return; // unmapped column: its value is carried only by rawSourceRow
      if (column < row.length) assign(key, row[column], column);
    });
  } else {
    for (const [header, value] of Object.entries(row)) {
      const key = (FANTASY_V1_HEADER_TO_KEY as Record<string, FantasyRawKey | undefined>)[header];
      if (!key) continue; // unknown property: reported by header validation, kept in rawSourceRow
      if (assigned.has(key)) {
        issues.push(
          issue("DUPLICATE_HEADER", "Row supplies the same contract field more than once.", {
            header,
            key,
            row: rowNumber,
          }),
        );
        continue;
      }
      assign(key, value);
    }
  }

  // Identity is reported, never invented.
  const lotId = record.lotId;
  if (typeof lotId !== "string" || lotId === "") {
    issues.push(
      issue("MISSING_IDENTITY_VALUE", "Row has no usable Lot ID value.", {
        header: "Lot ID",
        key: "lotId",
        row: rowNumber,
      }),
    );
  }

  const fatal = issues.some((i) => i.severity === "FATAL");
  const unsupportedValue = issues.some((i) => i.code === "UNSUPPORTED_VALUE_TYPE");

  return {
    row: rowNumber,
    ok: !fatal,
    // A row containing an unsupported value shape cannot be represented safely; the
    // original row is still preserved so a later phase can quarantine it.
    record: unsupportedValue ? null : Object.freeze(record),
    rawSourceRow: row,
    issues,
  };
}

function describeType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number") return Number.isNaN(value) ? "NaN" : "non-finite number";
  return typeof value;
}

// ---------------------------------------------------------------------------
// Provider-neutral batch shape
// ---------------------------------------------------------------------------

/**
 * Cursor metadata for incremental delivery. It is deliberately a separate object:
 * no Fantasy row field — including Doc Date, Allocation Date and Doc ID — may ever
 * act as a synchronization cursor. Phase 4 finalizes the live-provider semantics.
 */
export interface FantasySourceCursor {
  /** How the provider delivers change: a complete snapshot, or its own cursor token. */
  readonly kind: "FULL_SNAPSHOT" | "PROVIDER_SUPPLIED";
  /** Opaque provider token. Never derived from row contents. */
  readonly token: string | null;
}

/** Provider metadata is scalar-only so it cannot smuggle nested payloads. */
export type FantasyProviderMetadata = Readonly<Record<string, string | number | boolean | null>>;

/** What every provider (fixture, file import, future live API) hands to the boundary. */
export interface FantasySourceBatch {
  readonly contractVersion: string;
  readonly sourceMode: string;
  readonly batchId: string;
  readonly headers: readonly unknown[];
  readonly rows: readonly FantasySourceRow[];
  readonly cursor: FantasySourceCursor;
  readonly providerMetadata?: FantasyProviderMetadata;
}

/** A provider that speaks the row contract. Implemented by fixture, import and live adapters. */
export interface FantasyRowSourceProvider {
  readonly contractVersion: string;
  getSourceMode(): string;
  fetchBatch(cursor: FantasySourceCursor): Promise<FantasySourceBatch | null>;
}

export interface FantasyBatchValidation {
  readonly contractVersion: string;
  readonly batchId: string;
  readonly sourceMode: string;
  readonly ok: boolean;
  readonly headerValidation: FantasyHeaderValidation;
  readonly rows: readonly FantasyRowResult[];
  readonly counts: {
    readonly received: number;
    readonly accepted: number;
    readonly rejected: number;
    readonly withDrift: number;
  };
  readonly issues: readonly FantasyContractIssue[];
}

/**
 * Validates a whole provider batch: headers first, then every row. When the header
 * row is fatally wrong, no row is normalized — associating values with unusable
 * headers would invent data.
 */
export function validateFantasySourceBatch(batch: FantasySourceBatch): FantasyBatchValidation {
  const headerValidation = validateFantasyHeaders(batch.headers, { contractVersion: batch.contractVersion });

  const rows: FantasyRowResult[] = headerValidation.ok
    ? batch.rows.map((row, i) => normalizeFantasyRow(row, headerValidation, i + 1))
    : [];

  const accepted = rows.filter((r) => r.ok).length;
  const withDrift = rows.filter((r) => r.issues.some((i) => i.severity === "DRIFT")).length;

  return {
    contractVersion: headerValidation.contractVersion,
    batchId: batch.batchId,
    sourceMode: batch.sourceMode,
    ok: headerValidation.ok && rows.every((r) => r.ok),
    headerValidation,
    rows,
    counts: {
      received: batch.rows.length,
      accepted,
      rejected: rows.length - accepted,
      withDrift,
    },
    issues: headerValidation.issues,
  };
}

// ---------------------------------------------------------------------------
// Safe reporting
// ---------------------------------------------------------------------------

export interface FantasyContractDiagnostics {
  readonly contractVersion: string;
  readonly batchId: string;
  readonly sourceMode: string;
  readonly ok: boolean;
  readonly counts: FantasyBatchValidation["counts"];
  readonly issues: readonly FantasyContractIssue[];
}

/**
 * Log- and API-safe view of a batch validation: codes, headers, positions and counts
 * only. Source values and raw rows are never included.
 */
export function toContractDiagnostics(validation: FantasyBatchValidation): FantasyContractDiagnostics {
  const rowIssues = validation.rows.flatMap((r) => r.issues);
  return {
    contractVersion: validation.contractVersion,
    batchId: validation.batchId,
    sourceMode: validation.sourceMode,
    ok: validation.ok,
    counts: validation.counts,
    issues: [...validation.headerValidation.issues, ...rowIssues],
  };
}
