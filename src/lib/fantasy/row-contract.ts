if (typeof window !== "undefined") {
  throw new Error("fantasy/row-contract is server-only and must not be imported by client code.");
}

export const FANTASY_ROW_CONTRACT_V1 = "FANTASY_ROW_CONTRACT_V1";

export const SUPPORTED_FANTASY_CONTRACT_VERSIONS = [FANTASY_ROW_CONTRACT_V1] as const;

export type FantasyContractVersion = (typeof SUPPORTED_FANTASY_CONTRACT_VERSIONS)[number];

export function isSupportedContractVersion(version: string): version is FantasyContractVersion {
  return (SUPPORTED_FANTASY_CONTRACT_VERSIONS as readonly string[]).includes(version);
}

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

export const FANTASY_IDENTITY_HEADERS = ["Lot ID"] as const satisfies readonly FantasyV1Header[];

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

export const FANTASY_V1_KEY_TO_HEADER: Readonly<Record<FantasyRawKey, FantasyV1Header>> = Object.freeze(
  Object.fromEntries(
    (Object.entries(FANTASY_V1_HEADER_TO_KEY) as Array<[FantasyV1Header, FantasyRawKey]>).map(([header, key]) => [key, header]),
  ) as Record<FantasyRawKey, FantasyV1Header>,
);

export type FantasySourceValue = string | number | boolean | null | undefined;

export type FantasyRawRecord = Readonly<Record<FantasyRawKey, FantasySourceValue>>;

export type FantasySourceRow = readonly unknown[] | Readonly<Record<string, unknown>>;

export type FantasyIssueSeverity = "FATAL" | "DRIFT";

export type FantasyIssueCode =
  | "UNSUPPORTED_CONTRACT_VERSION"
  | "MISSING_IDENTITY_HEADER"
  | "DUPLICATE_HEADER"
  | "EMPTY_HEADER"
  | "UNSUPPORTED_VALUE_TYPE"
  | "MISSING_IDENTITY_VALUE"
  | "MISSING_HEADER"
  | "UNKNOWN_HEADER"
  | "HEADER_ORDER_CHANGED"
  | "HEADER_CASE_MISMATCH"
  | "HEADER_WHITESPACE_MISMATCH"
  | "HEADER_PUNCTUATION_MISMATCH"
  | "ROW_TOO_SHORT"
  | "ROW_TOO_LONG";

export interface FantasyContractIssue {
  readonly code: FantasyIssueCode;
  readonly severity: FantasyIssueSeverity;
  readonly header?: string;
  readonly key?: FantasyRawKey;
  readonly column?: number;
  readonly row?: number;
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

const foldCase = (h: string) => h.toLowerCase();
const foldWhitespace = (h: string) => h.replace(/\s+/g, " ").trim();
const foldPunctuation = (h: string) => h.replace(/[^A-Za-z0-9]/g, "").toLowerCase();

const EXPECTED_BY_EXACT = new Map<string, FantasyV1Header>(FANTASY_V1_HEADERS.map((h) => [h, h]));
const EXPECTED_BY_CASE = new Map<string, FantasyV1Header>(FANTASY_V1_HEADERS.map((h) => [foldCase(h), h]));
const EXPECTED_BY_WHITESPACE = new Map<string, FantasyV1Header>(FANTASY_V1_HEADERS.map((h) => [foldWhitespace(h), h]));
const EXPECTED_BY_PUNCTUATION = new Map<string, FantasyV1Header>(FANTASY_V1_HEADERS.map((h) => [foldPunctuation(h), h]));

export interface FantasyHeaderValidation {
  readonly contractVersion: string;
  readonly ok: boolean;
  readonly columnKeys: readonly (FantasyRawKey | null)[];
  readonly missingHeaders: readonly FantasyV1Header[];
  readonly issues: readonly FantasyContractIssue[];
}

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

function emptyRecord(): Record<FantasyRawKey, FantasySourceValue> {
  const record = {} as Record<FantasyRawKey, FantasySourceValue>;
  for (const header of FANTASY_V1_HEADERS) record[FANTASY_V1_HEADER_TO_KEY[header]] = undefined;
  return record;
}

function normalizeValue(value: unknown): { ok: true; value: FantasySourceValue } | { ok: false } {
  if (value === null || value === undefined) return { ok: true, value };
  if (typeof value === "string") return { ok: true, value: value.trim() };
  if (typeof value === "boolean") return { ok: true, value };
  if (typeof value === "number") return Number.isFinite(value) ? { ok: true, value } : { ok: false };
  return { ok: false };
}

export interface FantasyRowResult {
  readonly row: number;
  readonly ok: boolean;
  readonly record: FantasyRawRecord | null;
  readonly rawSourceRow: FantasySourceRow;
  readonly issues: readonly FantasyContractIssue[];
}

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
      if (!key) return;
      if (column < row.length) assign(key, row[column], column);
    });
  } else {
    for (const [header, value] of Object.entries(row)) {
      const key = (FANTASY_V1_HEADER_TO_KEY as Record<string, FantasyRawKey | undefined>)[header];
      if (!key) continue;
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

export interface FantasySourceCursor {
  readonly kind: "FULL_SNAPSHOT" | "PROVIDER_SUPPLIED";
  readonly token: string | null;
}

export type FantasyProviderMetadata = Readonly<Record<string, string | number | boolean | null>>;

export interface FantasySourceBatch {
  readonly contractVersion: string;
  readonly sourceMode: string;
  readonly batchId: string;
  readonly headers: readonly unknown[];
  readonly rows: readonly FantasySourceRow[];
  readonly cursor: FantasySourceCursor;
  readonly providerMetadata?: FantasyProviderMetadata;
}

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

export interface FantasyContractDiagnostics {
  readonly contractVersion: string;
  readonly batchId: string;
  readonly sourceMode: string;
  readonly ok: boolean;
  readonly counts: FantasyBatchValidation["counts"];
  readonly issues: readonly FantasyContractIssue[];
}

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
