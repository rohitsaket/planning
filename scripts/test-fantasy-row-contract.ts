/**
 * FANTASY ROW CONTRACT (v1) — BOUNDARY TEST SUITE
 *
 * Pure contract tests: no database, no network, no application state. They prove the
 * 46-column contract is exact, that drift is detected rather than silently accepted,
 * that rows normalize without inventing business meaning, and that diagnostics carry
 * no source values.
 *
 * Usage: npx tsx scripts/test-fantasy-row-contract.ts
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  FANTASY_IDENTITY_HEADERS,
  FANTASY_ROW_CONTRACT_V1,
  FANTASY_V1_HEADERS,
  FANTASY_V1_HEADER_TO_KEY,
  FANTASY_V1_KEY_TO_HEADER,
  isSupportedContractVersion,
  normalizeFantasyRow,
  toContractDiagnostics,
  validateFantasyHeaders,
  validateFantasySourceBatch,
  type FantasyContractIssue,
  type FantasyIssueCode,
  type FantasyRawKey,
  type FantasyRowSourceProvider,
  type FantasyV1Header,
  type FantasySourceBatch,
  type FantasySourceCursor,
} from "../src/lib/fantasy/row-contract";

let passed = 0;
let failed = 0;
const failures: string[] = [];

function assert(condition: boolean, message: string) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    failures.push(message);
    console.error(`  ✗ ${message}`);
  }
}

function section(title: string) {
  console.log(`\n--- ${title} ---`);
}

const codes = (issues: readonly FantasyContractIssue[]): FantasyIssueCode[] => issues.map((i) => i.code);
const has = (issues: readonly FantasyContractIssue[], code: FantasyIssueCode) => codes(issues).includes(code);

/** The exact 46 headers, written out independently of the module under test. */
const EXPECTED_HEADERS = [
  "Metal ID", "Metal Wgt", "Previous Department Account Name", "Process Name", "Remark", "Qty",
  "Lot ID", "Lot Name", "On Hold", "Lot Status DB", "Shape", "Color", "Clarity", "Size", "Weight",
  "Lab Name", "Certificate No", "Cut", "Polish", "Symm", "Fluo.", "M1", "M2", "M3", "Table", "Depth",
  "Ratio", "Tone", "Department Account Name", "Est. Clarity ID", "Est. Color ID", "Avg Weight",
  "Allocation Date", "Allocation Account ID", "Certificate ID", "Company ID", "Doc ID", "Est. Shape ID",
  "Est. Weight", "Fancy Color", "Metal Color", "Met.Wgt", "Original Weight", "Tot.Dia.Wgt", "Doc Date",
  "ItemName",
];

/** A full-width row of placeholder values, positionally aligned to the contract. */
function sampleRow(overrides: Partial<Record<string, unknown>> = {}): unknown[] {
  return EXPECTED_HEADERS.map((header) => (header in overrides ? overrides[header] : `v:${header}`));
}

function headerValidation() {
  return validateFantasyHeaders(EXPECTED_HEADERS);
}

function main() {
  console.log("===============================================================================");
  console.log("FANTASY ROW CONTRACT v1 — BOUNDARY TEST SUITE");
  console.log("===============================================================================");

  // =========================================================================
  section("A. The header list is exact");
  // =========================================================================
  assert(FANTASY_V1_HEADERS.length === 46, `The contract has exactly 46 headers (got ${FANTASY_V1_HEADERS.length})`);
  assert(
    JSON.stringify([...FANTASY_V1_HEADERS]) === JSON.stringify(EXPECTED_HEADERS),
    "The header list matches the confirmed Fantasy order and spelling exactly",
  );
  assert(new Set(FANTASY_V1_HEADERS).size === 46, "No header is repeated in the contract");
  assert(FANTASY_ROW_CONTRACT_V1 === "FANTASY_ROW_CONTRACT_V1", "The contract version identifier is stable");
  assert(isSupportedContractVersion(FANTASY_ROW_CONTRACT_V1), "The v1 contract version is supported");
  assert(!isSupportedContractVersion("FANTASY_ROW_CONTRACT_V2"), "An unknown contract version is not supported");
  assert(
    FANTASY_IDENTITY_HEADERS.length === 1 && FANTASY_IDENTITY_HEADERS[0] === "Lot ID",
    "Lot ID is the only identity-critical header in this contract version",
  );

  // Punctuation-sensitive headers, asserted individually.
  for (const header of ["Fluo.", "Tot.Dia.Wgt", "Met.Wgt", "Est. Clarity ID", "Est. Color ID", "Est. Shape ID", "Est. Weight"]) {
    assert((FANTASY_V1_HEADERS as readonly string[]).includes(header), `Header "${header}" is recognized exactly`);
  }
  assert(
    (FANTASY_V1_HEADERS as readonly string[]).includes("Metal Wgt") && (FANTASY_V1_HEADERS as readonly string[]).includes("Met.Wgt"),
    "Metal Wgt and Met.Wgt are both present as separate headers",
  );

  // =========================================================================
  section("B. Every header has exactly one internal key, and vice versa");
  // =========================================================================
  // Widened to string so these stay runtime assertions: comparing literal key types
  // directly would be resolved statically by the compiler rather than tested.
  const keyOf = (header: FantasyV1Header): string => FANTASY_V1_HEADER_TO_KEY[header];
  const mappedKeys = FANTASY_V1_HEADERS.map((h) => FANTASY_V1_HEADER_TO_KEY[h]);
  assert(Object.keys(FANTASY_V1_HEADER_TO_KEY).length === 46, "The mapping covers exactly 46 headers");
  assert(new Set(mappedKeys).size === 46, "Every header maps to a distinct internal key");
  assert(
    FANTASY_V1_HEADERS.every((h) => FANTASY_V1_KEY_TO_HEADER[FANTASY_V1_HEADER_TO_KEY[h]] === h),
    "The reverse mapping round-trips for every header",
  );
  assert(Object.keys(FANTASY_V1_KEY_TO_HEADER).length === 46, "Every internal key is mapped from exactly one header");

  assert(
    keyOf("Metal Wgt") !== keyOf("Met.Wgt"),
    "Metal Wgt and Met.Wgt keep separate internal keys",
  );
  assert(keyOf("Depth") === "depthRaw", "Depth maps to a measurement key, not a department key");
  assert(
    keyOf("Department Account Name") !== keyOf("Previous Department Account Name"),
    "Current and previous department headers keep separate internal keys",
  );
  assert(
    keyOf("Shape") !== keyOf("Est. Shape ID") &&
      keyOf("Color") !== keyOf("Est. Color ID") &&
      keyOf("Clarity") !== keyOf("Est. Clarity ID") &&
      keyOf("Weight") !== keyOf("Est. Weight"),
    "Actual characteristics and their estimated counterparts keep separate keys",
  );
  assert(
    new Set([
      keyOf("Weight"),
      keyOf("Avg Weight"),
      keyOf("Est. Weight"),
      keyOf("Original Weight"),
      keyOf("Tot.Dia.Wgt"),
      keyOf("Metal Wgt"),
      keyOf("Met.Wgt"),
    ]).size === 7,
    "All seven weight-like headers keep distinct keys",
  );

  // =========================================================================
  section("C. A correct header row is accepted");
  // =========================================================================
  const good = headerValidation();
  assert(good.ok, "The exact 46-header list passes validation");
  assert(good.issues.length === 0, `A correct header row raises no issue (got ${codes(good.issues).join(", ")})`);
  assert(good.missingHeaders.length === 0, "No header is reported missing");
  assert(good.columnKeys.length === 46 && good.columnKeys.every((k) => k !== null), "Every column maps to an internal key");

  // =========================================================================
  section("D. Fatal header problems");
  // =========================================================================
  const noLotId = validateFantasyHeaders(EXPECTED_HEADERS.filter((h) => h !== "Lot ID"));
  assert(!noLotId.ok, "A header row without Lot ID fails");
  assert(has(noLotId.issues, "MISSING_IDENTITY_HEADER"), "Missing Lot ID is reported as an identity failure");

  const duplicated = validateFantasyHeaders([...EXPECTED_HEADERS, "Shape"]);
  assert(!duplicated.ok, "A duplicated expected header fails");
  assert(has(duplicated.issues, "DUPLICATE_HEADER"), "The duplicate is reported by code");

  const empty = validateFantasyHeaders(EXPECTED_HEADERS.map((h, i) => (i === 3 ? "   " : h)));
  assert(!empty.ok && has(empty.issues, "EMPTY_HEADER"), "A blank header name fails");

  const nonText = validateFantasyHeaders(EXPECTED_HEADERS.map((h, i) => (i === 5 ? 42 : h)));
  assert(!nonText.ok && has(nonText.issues, "EMPTY_HEADER"), "A non-text header fails");

  const badVersion = validateFantasyHeaders(EXPECTED_HEADERS, { contractVersion: "FANTASY_ROW_CONTRACT_V9" });
  assert(!badVersion.ok, "An unsupported contract version fails");
  assert(has(badVersion.issues, "UNSUPPORTED_CONTRACT_VERSION"), "The unsupported version is reported by code");
  assert(badVersion.columnKeys.length === 0, "No column is mapped under an unsupported version");

  // =========================================================================
  section("E. Schema drift is reported, never silently accepted");
  // =========================================================================
  const extra = validateFantasyHeaders([...EXPECTED_HEADERS, "Some New Column"]);
  assert(extra.ok, "An additional unknown header is drift, not a fatal error");
  assert(has(extra.issues, "UNKNOWN_HEADER"), "The unknown header is reported");
  assert(extra.columnKeys[46] === null, "The unknown header is not mapped to any internal key");

  const reordered = [...EXPECTED_HEADERS];
  [reordered[0], reordered[1]] = [reordered[1], reordered[0]];
  const orderDrift = validateFantasyHeaders(reordered);
  assert(orderDrift.ok, "Reordered headers are drift, not fatal");
  assert(has(orderDrift.issues, "HEADER_ORDER_CHANGED"), "A changed header order is reported");
  assert(
    orderDrift.columnKeys[0] === keyOf("Metal Wgt"),
    "Reordered headers still map by name, not by position",
  );

  const caseDrift = validateFantasyHeaders(EXPECTED_HEADERS.map((h) => (h === "Fluo." ? "fluo." : h)));
  assert(has(caseDrift.issues, "HEADER_CASE_MISMATCH"), "A case-only difference is reported");
  assert(has(caseDrift.issues, "MISSING_HEADER"), "The expected header is also reported missing");
  assert(
    caseDrift.columnKeys[20] === null,
    "A case variant is not silently mapped to the expected field",
  );

  const spaceDrift = validateFantasyHeaders(EXPECTED_HEADERS.map((h) => (h === "Lab Name" ? "Lab  Name" : h)));
  assert(has(spaceDrift.issues, "HEADER_WHITESPACE_MISMATCH"), "A whitespace-only difference is reported");

  const punctDrift = validateFantasyHeaders(EXPECTED_HEADERS.map((h) => (h === "Tot.Dia.Wgt" ? "Tot Dia Wgt" : h)));
  assert(has(punctDrift.issues, "HEADER_PUNCTUATION_MISMATCH"), "A punctuation difference is reported");
  assert(
    punctDrift.columnKeys[43] === null,
    "A punctuation variant is not silently mapped to the expected field",
  );

  const fluoAsPlain = validateFantasyHeaders(EXPECTED_HEADERS.map((h) => (h === "Fluo." ? "Fluo" : h)));
  assert(
    has(fluoAsPlain.issues, "HEADER_PUNCTUATION_MISMATCH") && has(fluoAsPlain.issues, "MISSING_HEADER"),
    "Dropping the trailing period in Fluo. is reported as drift",
  );

  const missingOptional = validateFantasyHeaders(EXPECTED_HEADERS.filter((h) => h !== "Remark"));
  assert(missingOptional.ok, "A missing non-identity header is drift, not fatal");
  assert(has(missingOptional.issues, "MISSING_HEADER"), "The absent field is reported for review");

  // =========================================================================
  section("F. Rows normalize without inventing meaning");
  // =========================================================================
  const plan = headerValidation();
  const row = normalizeFantasyRow(sampleRow({ "Lot ID": "  LOT-001  " }), plan, 1);
  assert(row.ok, "A complete row is accepted");
  assert(row.record !== null, "A complete row produces a normalized record");
  assert(Object.keys(row.record!).length === 46, "The record carries all 46 contract keys");
  assert(row.record!.lotId === "LOT-001", "Surrounding whitespace is trimmed from values");
  assert(row.record!.lotStatusRaw === "v:Lot Status DB", "Values are carried through untouched otherwise");

  const identifiers = normalizeFantasyRow(
    sampleRow({ "Lot ID": "lot-abc-001", "Certificate No": "0012345", "Company ID": "07", "Doc ID": "0001" }),
    plan,
    2,
  );
  assert(identifiers.record!.lotId === "lot-abc-001", "Identifier case is preserved exactly");
  assert(identifiers.record!.certificateNumber === "0012345", "Leading zeros in identifiers are preserved");
  assert(typeof identifiers.record!.companyId === "string", "Numeric-looking identifiers are not coerced to numbers");
  assert(identifiers.record!.documentId === "0001", "Document identifiers keep their exact text");

  const distinguishable = normalizeFantasyRow(
    sampleRow({ Remark: null, "Metal Color": "", Qty: 0, "On Hold": false, "Avg Weight": 0.0 }),
    plan,
    3,
  );
  assert(distinguishable.record!.remark === null, "Explicit null is preserved as null");
  assert(distinguishable.record!.metalColorRaw === "", "Empty string stays an empty string");
  assert(distinguishable.record!.quantityRaw === 0, "Zero is preserved, not treated as missing");
  assert(distinguishable.record!.onHoldRaw === false, "Boolean false is preserved as false");
  assert(
    distinguishable.record!.remark !== distinguishable.record!.metalColorRaw,
    "Null and empty string remain distinguishable",
  );

  const untouchedSemantics = normalizeFantasyRow(sampleRow({ "On Hold": "Y", Qty: "2", Weight: "1.05" }), plan, 4);
  assert(untouchedSemantics.record!.onHoldRaw === "Y", "On Hold is not converted into a boolean or lifecycle state");
  assert(untouchedSemantics.record!.quantityRaw === "2", "Qty is not converted into a piece count");
  assert(untouchedSemantics.record!.weightRaw === "1.05", "Weight is not parsed or unit-converted");
  assert(
    untouchedSemantics.record!.documentDateRaw === "v:Doc Date" && untouchedSemantics.record!.allocationDateRaw === "v:Allocation Date",
    "Date fields are carried as raw text, not parsed",
  );

  const short = normalizeFantasyRow(sampleRow().slice(0, 40), plan, 5);
  assert(has(short.issues, "ROW_TOO_SHORT"), "A short row is reported");
  assert(short.record!.itemName === undefined, "Missing positional values stay undefined, never empty strings");

  const long = normalizeFantasyRow([...sampleRow(), "extra", "extra2"], plan, 6);
  assert(has(long.issues, "ROW_TOO_LONG"), "Extra positional values are reported");
  assert(long.ok, "Extra positional values are drift, not fatal");

  const noIdentity = normalizeFantasyRow(sampleRow({ "Lot ID": "" }), plan, 7);
  assert(!noIdentity.ok && has(noIdentity.issues, "MISSING_IDENTITY_VALUE"), "A row without a Lot ID value is identity-invalid");
  assert(noIdentity.record !== null && noIdentity.record.lotId === "", "No fallback identity is invented");

  for (const [label, value] of [
    ["nested object", { nested: true }],
    ["array", [1, 2]],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["function", () => undefined],
    ["symbol", Symbol("x")],
  ] as Array<[string, unknown]>) {
    const bad = normalizeFantasyRow(sampleRow({ Remark: value }), plan, 8);
    assert(
      !bad.ok && has(bad.issues, "UNSUPPORTED_VALUE_TYPE") && bad.record === null,
      `An unsupported ${label} value is rejected structurally`,
    );
    assert(bad.rawSourceRow !== undefined, `The original row is preserved after rejecting an unsupported ${label}`);
  }

  // Keyed (API/JSON) rows behave the same way.
  const keyed = normalizeFantasyRow(
    { "Lot ID": "LOT-KEYED", "Fluo.": "Faint", "Tot.Dia.Wgt": 2.5, Unknown: "ignored" },
    plan,
    9,
  );
  assert(keyed.record!.lotId === "LOT-KEYED", "Keyed rows map by exact header name");
  assert(keyed.record!.fluorescenceRaw === "Faint", "Keyed rows resolve dotted headers exactly");
  assert(keyed.record!.totalDiamondWeightRaw === 2.5, "Keyed numeric values are preserved as numbers");
  assert(keyed.record!.shapeRaw === undefined, "Headers absent from a keyed row stay undefined");

  // =========================================================================
  section("G. Batch validation and the provider boundary");
  // =========================================================================
  const cursor: FantasySourceCursor = { kind: "FULL_SNAPSHOT", token: null };
  const batch: FantasySourceBatch = {
    contractVersion: FANTASY_ROW_CONTRACT_V1,
    sourceMode: "FIXTURE",
    batchId: "CONTRACT-TEST-1",
    headers: EXPECTED_HEADERS,
    rows: [sampleRow({ "Lot ID": "LOT-1" }), sampleRow({ "Lot ID": "LOT-2" }), sampleRow({ "Lot ID": "" })],
    cursor,
    providerMetadata: { generatedBy: "contract-test", recordCount: 3, partial: false },
  };
  const batchResult = validateFantasySourceBatch(batch);
  assert(!batchResult.ok, "A batch containing an identity-invalid row is not fully accepted");
  assert(batchResult.counts.received === 3, "Received rows are counted");
  assert(batchResult.counts.accepted === 2, `Accepted rows are counted (got ${batchResult.counts.accepted})`);
  assert(batchResult.counts.rejected === 1, "Rejected rows are counted");

  const badHeaderBatch = validateFantasySourceBatch({ ...batch, headers: EXPECTED_HEADERS.filter((h) => h !== "Lot ID") });
  assert(badHeaderBatch.rows.length === 0, "No row is normalized when the header row is fatally wrong");

  // Cursor metadata must live outside the row contract.
  const rowKeys = new Set<string>(Object.values(FANTASY_V1_HEADER_TO_KEY) as FantasyRawKey[]);
  assert(
    !Object.keys(cursor).some((k) => rowKeys.has(k)),
    "Cursor metadata shares no field name with the row contract",
  );
  assert(
    !(["documentDateRaw", "allocationDateRaw", "documentId"] as string[]).some((k) => k in cursor),
    "No date or document field is used as cursor metadata",
  );
  assert(
    cursor.kind === "FULL_SNAPSHOT" || cursor.kind === "PROVIDER_SUPPLIED",
    "Cursor delivery is provider-supplied or a full snapshot, never derived from rows",
  );

  // A provider implementing the boundary contract compiles and round-trips.
  const provider: FantasyRowSourceProvider = {
    contractVersion: FANTASY_ROW_CONTRACT_V1,
    getSourceMode: () => "FIXTURE",
    fetchBatch: async () => batch,
  };
  assert(provider.contractVersion === FANTASY_ROW_CONTRACT_V1, "A provider declares the contract version it speaks");

  // =========================================================================
  section("H. Diagnostics are safe to log and return");
  // =========================================================================
  const sensitiveBatch = validateFantasySourceBatch({
    ...batch,
    rows: [
      sampleRow({
        "Lot ID": "",
        Remark: "CONFIDENTIAL-REMARK-VALUE",
        "Company ID": "SECRET-COMPANY-007",
        "Allocation Account ID": "ACCOUNT-SECRET-42",
        "Certificate No": "CERT-SECRET-99",
        "Doc ID": "DOC-SECRET-77",
      }),
    ],
  });
  const diagnostics = toContractDiagnostics(sensitiveBatch);
  const serialized = JSON.stringify(diagnostics);
  for (const secret of [
    "CONFIDENTIAL-REMARK-VALUE",
    "SECRET-COMPANY-007",
    "ACCOUNT-SECRET-42",
    "CERT-SECRET-99",
    "DOC-SECRET-77",
    "v:Shape",
  ]) {
    assert(!serialized.includes(secret), `Diagnostics do not echo the source value "${secret.slice(0, 18)}"`);
  }
  assert(!serialized.includes("rawSourceRow"), "Diagnostics never carry the raw source row");
  assert(diagnostics.issues.every((i) => typeof i.code === "string"), "Every diagnostic carries an error code");
  assert(
    diagnostics.issues.some((i) => i.header === "Lot ID" && i.row === 1),
    "Diagnostics identify the header and row number of a problem",
  );
  assert(typeof diagnostics.counts.received === "number", "Diagnostics carry batch counts");

  // =========================================================================
  section("I. The boundary stays server-side");
  // =========================================================================
  const componentsDir = path.join(process.cwd(), "src", "components");
  const clientFiles: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".tsx") || entry.name.endsWith(".ts")) clientFiles.push(full);
    }
  };
  walk(componentsDir);
  const importers = clientFiles.filter((f) => /fantasy\/row-contract/.test(readFileSync(f, "utf8")));
  assert(importers.length === 0, `No client component imports the row contract${importers.length ? `: ${importers.join(", ")}` : ""}`);

  const contractSource = readFileSync(path.join(process.cwd(), "src", "lib", "fantasy", "row-contract.ts"), "utf8");
  assert(/typeof window !== "undefined"/.test(contractSource), "The contract module guards against browser execution");
  assert(!/console\.(log|info|warn|error)/.test(contractSource), "The contract module logs nothing, so no source value can leak to logs");

  // Header strings must exist in exactly one place.
  const libFiles: string[] = [];
  const walkLib = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walkLib(full);
      else if (entry.name.endsWith(".ts")) libFiles.push(full);
    }
  };
  walkLib(path.join(process.cwd(), "src", "lib"));
  const duplicateDefiners = libFiles.filter(
    (f) => !f.endsWith("row-contract.ts") && /"Tot\.Dia\.Wgt"|"Est\. Shape ID"|"Lot Status DB"/.test(readFileSync(f, "utf8")),
  );
  assert(
    duplicateDefiners.length === 0,
    `Fantasy header strings are defined only in the contract module${duplicateDefiners.length ? `: ${duplicateDefiners.join(", ")}` : ""}`,
  );

  console.log("\n===============================================================================");
  console.log(`RESULT: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log("Failures:");
    for (const f of failures) console.log(`  - ${f}`);
  }
  console.log("===============================================================================");
  if (failed > 0) process.exit(1);
}

main();
