/**
 * FANTASY RAW INGESTION (Phase 3A) — PERSISTENCE, IDEMPOTENCY, DRY-RUN, QUARANTINE
 *
 * Runs against the isolated security-test database only (planning_sectest).
 *
 * Proves: supported scalars round-trip exactly; keyed API rows keep their own field
 * names and their unknown fields; supplied header states stay distinguishable; hashes
 * are deterministic, content-derived and encoding-version-tagged; V1 payloads stay
 * readable and are never rewritten; exact replay is idempotent under concurrency;
 * concurrent submissions sharing a provider batch id but differing in content produce
 * exactly one original and the rest as conflicts; a failure inside the transaction
 * leaves nothing behind; dry run writes nothing; diagnostics carry no source values;
 * and no canonical operational table is touched.
 *
 * Usage: npx tsx scripts/with-sectest-db.ts npx tsx scripts/test-fantasy-raw-ingestion.ts
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { db } from "../src/lib/db";
import { SECTEST_DB } from "../tests/security/test-db";
import type { RawIngestionProvenance } from "../src/lib/fantasy/raw-ingestion";

/**
 * Provenance for every batch these tests ingest. Ingestion now requires it, so a batch
 * stored without it could never be projected.
 */
const FIXTURE_PROVENANCE: RawIngestionProvenance = {
  effectiveSourceState: "FIXTURE_SIMULATION",
  providerId: "fixture-raw-test",
};
import {
  FANTASY_ROW_CONTRACT_V1,
  FANTASY_V1_HEADERS,
  type FantasySourceBatch,
  type FantasySourceRow,
} from "../src/lib/fantasy/row-contract";
import {
  canonicalJson,
  computeBatchHash,
  computeRowHash,
  decodeCell,
  decodeStoredHeaders,
  decodeStoredSourceRow,
  encodeCell,
  encodeHeaders,
  encodePositionalRow,
  encodeSourceRow,
  sha256Hex,
  UNSUPPORTED_VALUE,
  FANTASY_RAW_ENCODING_V1,
  FANTASY_RAW_ENCODING_V2,
  FANTASY_RAW_ENCODING_CURRENT,
  type FantasyEncodedCell,
} from "../src/lib/fantasy/raw-encoding";
import {
  ALLOWED_PROVIDER_METADATA_KEYS,
  FantasyRawIngestionError,
  ingestFantasyRawBatch,
  type RawIngestionDb,
  type RawIngestionTx,
} from "../src/lib/fantasy/raw-ingestion";

const url = process.env.DATABASE_URL ?? "";
if (!url || !new URL(url).pathname.startsWith(`/${SECTEST_DB}`)) {
  console.error(`REFUSING TO RUN: DATABASE_URL must point at the isolated ${SECTEST_DB} database.`);
  process.exit(1);
}

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

const HEADERS = [...FANTASY_V1_HEADERS] as string[];

function row(overrides: Record<string, unknown> = {}): unknown[] {
  return HEADERS.map((h) => (h in overrides ? overrides[h] : `v:${h}`));
}

/** A keyed API-shaped row: contract headers as property names, plus any extra fields. */
function keyedRow(overrides: Record<string, unknown> = {}, extras: Record<string, unknown> = {}): Record<string, unknown> {
  const record: Record<string, unknown> = {};
  for (const h of HEADERS) record[h] = h in overrides ? overrides[h] : `v:${h}`;
  return { ...record, ...extras };
}

let batchSeq = 0;
function makeBatch(rows: FantasySourceRow[], overrides: Partial<FantasySourceBatch> = {}): FantasySourceBatch {
  batchSeq++;
  return {
    contractVersion: FANTASY_ROW_CONTRACT_V1,
    sourceMode: "FIXTURE",
    batchId: `RAW-TEST-${batchSeq}`,
    headers: HEADERS,
    rows,
    cursor: { kind: "FULL_SNAPSHOT", token: null },
    ...overrides,
  };
}

/** Canonical tables that Phase 3A must never write to. */
async function canonicalSnapshot() {
  const [
    lotMaster, lotHistory, polished, rough, sales, memo, requirements, plans, planPieces,
    demandRuns, demandMetrics, traceItems, syncRuns, checkpoints, dqIssues, auditLogs,
  ] = await Promise.all([
    db.lotMasterRecord.count(), db.lotHistoryRecord.count(), db.polishedStone.count(), db.roughStone.count(),
    db.salesRecord.count(), db.memoRecord.count(), db.requirement.count(), db.planningCase.count(),
    db.planOptionPiece.count(), db.demandRun.count(), db.demandMetric.count(), db.demandMetricTraceItem.count(),
    db.integrationSyncRun.count(), db.syncCheckpoint.findMany({ orderBy: { source: "asc" } }),
    db.dataQualityIssue.count(), db.auditLog.count(),
  ]);
  return {
    counts: { lotMaster, lotHistory, polished, rough, sales, memo, requirements, plans, planPieces, demandRuns, demandMetrics, traceItems, syncRuns, dqIssues, auditLogs },
    checkpoints: checkpoints.map((c) => ({ source: c.source, currentCheckpoint: c.currentCheckpoint, lastBatchId: c.lastBatchId, isLocked: c.isLocked })),
  };
}

async function main() {
  console.log("===============================================================================");
  console.log("FANTASY RAW INGESTION (Phase 3A) — SAFETY, PERSISTENCE & IDEMPOTENCY SUITE");
  console.log("===============================================================================");

  // Scoped to this suite's own batches. A blanket delete would now fail anyway: raw rows
  // cited by a projection candidate are protected by ON DELETE RESTRICT, which is the
  // point of that constraint — the evidence behind a projection outlives it. Deleting
  // another suite's rows was never this suite's business.
  const ownBatches = await db.fantasyRawBatch.findMany({
    where: { OR: [{ providerBatchId: { startsWith: "RAW-TEST-" } }, { providerBatchId: "RAW-LEGACY-V1" }] },
    select: { id: true },
  });
  const ownBatchIds = ownBatches.map((b) => b.id);
  if (ownBatchIds.length > 0) {
    await db.fantasyRawRow.deleteMany({ where: { batchId: { in: ownBatchIds } } });
    await db.fantasyRawBatch.deleteMany({ where: { id: { in: ownBatchIds } } });
  }

  // A checkpoint row so "checkpoints unchanged" is a meaningful assertion.
  await db.syncCheckpoint.upsert({
    where: { source: "FANTASY" },
    create: { source: "FANTASY", mode: "FIXTURE", currentCheckpoint: 3, lastBatchId: "PRE-EXISTING" },
    update: { currentCheckpoint: 3, lastBatchId: "PRE-EXISTING" },
  });

  const before = await canonicalSnapshot();

  // =========================================================================
  section("A. Encoding preserves supported scalars exactly");
  // =========================================================================
  const cells: Array<[string, unknown]> = [
    ["undefined", undefined], ["null", null], ["empty string", ""], ["zero", 0], ["false", false],
    ["true", true], ["text", "ROUND"], ["negative", -1.5], ["leading-zero id", "0012345"],
  ];
  for (const [label, value] of cells) {
    const decoded = decodeCell(encodeCell(value));
    assert(Object.is(decoded, value), `Supported value round-trips exactly: ${label}`);
  }
  assert(encodeCell(undefined).type === "undefined" && encodeCell(null).type === "null", "Missing and explicit null use distinct tags");
  assert(encodeCell("").type === "string" && encodeCell(0).type === "number" && encodeCell(false).type === "boolean", "Empty string, zero and false keep their own types");
  assert(decodeCell(encodeCell("0012345")) === "0012345", "Leading-zero identifiers stay strings");

  for (const [label, value] of [
    ["nested object", { a: 1 }], ["array", [1]], ["NaN", Number.NaN], ["Infinity", Number.POSITIVE_INFINITY],
    ["function", () => undefined], ["symbol", Symbol("s")], ["bigint", BigInt(1)],
  ] as Array<[string, unknown]>) {
    const encoded = encodeCell(value);
    assert(encoded.type === "unsupported", `Unsupported ${label} is tagged, not serialized`);
    assert(decodeCell(encoded) === UNSUPPORTED_VALUE, `Unsupported ${label} decodes to the explicit marker`);
    assert(!canonicalJson(encoded).includes("[object"), `Unsupported ${label} is never stringified`);
  }
  assert(
    !canonicalJson(encodeCell({ authorization: "Bearer SECRET-TOKEN-VALUE" })).includes("SECRET-TOKEN-VALUE"),
    "An unsupported object's contents never reach the encoded payload",
  );

  // =========================================================================
  section("B. Hashing is deterministic, content-derived and version-tagged");
  // =========================================================================
  const v2 = { encodingVersion: FANTASY_RAW_ENCODING_V2, contractVersion: FANTASY_ROW_CONTRACT_V1 } as const;
  const rowsA = [row({ "Lot ID": "LOT-A" }), row({ "Lot ID": "LOT-B" })];
  const encodedHeadersA = encodeHeaders(HEADERS);
  const encodedA = rowsA.map((r) => encodeSourceRow(r));

  const hash1 = computeBatchHash({ ...v2, headers: encodedHeadersA, rows: encodedA });
  const hash2 = computeBatchHash({ ...v2, headers: encodeHeaders(HEADERS), rows: rowsA.map((r) => encodeSourceRow(r)) });
  assert(hash1 === hash2, "Identical content produces identical batch hashes");

  const changed = computeBatchHash({
    ...v2,
    headers: encodedHeadersA,
    rows: [encodeSourceRow(row({ "Lot ID": "LOT-A", Shape: "OVAL" })), encodedA[1]],
  });
  assert(changed !== hash1, "A meaningful cell change changes the batch hash");

  const reorderedHeaders = [...HEADERS];
  [reorderedHeaders[0], reorderedHeaders[1]] = [reorderedHeaders[1], reorderedHeaders[0]];
  assert(
    computeBatchHash({ ...v2, headers: encodeHeaders(reorderedHeaders), rows: encodedA }) !== hash1,
    "Header order changes the batch fingerprint",
  );
  assert(
    computeBatchHash({ ...v2, headers: encodedHeadersA, rows: [encodedA[1], encodedA[0]] }) !== hash1,
    "Row order changes the batch fingerprint",
  );

  const keyedHashOf = (value: unknown) =>
    computeRowHash({ ...v2, row: { form: "KEYED", fields: { "Lot ID": encodeCell("L"), Remark: encodeCell(value) } } });
  const distinctHashes = new Set([keyedHashOf(undefined), keyedHashOf(null), keyedHashOf(""), keyedHashOf(0), keyedHashOf(false)]);
  assert(distinctHashes.size === 5, `Missing, null, empty, zero and false fingerprint differently (got ${distinctHashes.size}/5)`);

  // =========================================================================
  section("C. Keyed source rows keep their own field names");
  // =========================================================================
  assert(encodeSourceRow(keyedRow()).form === "KEYED", "A keyed provider row is encoded in keyed form");
  assert(encodeSourceRow(row()).form === "POSITIONAL", "A spreadsheet row is encoded in positional form");

  const orderedOne = { "Lot ID": "LOT-ORDER", Remark: "R", Shape: "ROUND" };
  const orderedTwo = { Shape: "ROUND", "Lot ID": "LOT-ORDER", Remark: "R" };
  assert(
    canonicalJson(encodeSourceRow(orderedOne)) === canonicalJson(encodeSourceRow(orderedTwo)),
    "Property insertion order does not change the canonical keyed payload",
  );
  assert(
    computeRowHash({ ...v2, row: encodeSourceRow(orderedOne) }) === computeRowHash({ ...v2, row: encodeSourceRow(orderedTwo) }),
    "Property insertion order does not change the keyed row hash",
  );
  assert(
    computeRowHash({ ...v2, row: encodeSourceRow({ "Lot ID": "LOT-ORDER", Remarks: "R", Shape: "ROUND" }) }) !==
      computeRowHash({ ...v2, row: encodeSourceRow(orderedOne) }),
    "Renaming a keyed field changes the row hash",
  );
  assert(
    computeRowHash({ ...v2, row: encodeSourceRow({ ...orderedOne, Remark: "R2" }) }) !==
      computeRowHash({ ...v2, row: encodeSourceRow(orderedOne) }),
    "Changing a keyed value changes the row hash",
  );
  assert(
    computeRowHash({ ...v2, row: encodeSourceRow(["LOT-ORDER", "R"]) }) !==
      computeRowHash({ ...v2, row: encodeSourceRow({ a: "LOT-ORDER", b: "R" }) }),
    "A positional row and a keyed row never share a fingerprint",
  );

  const keyedStates = encodeSourceRow({ a: undefined, b: null, c: "", d: 0, e: false });
  const keyedStateTypes = keyedStates.form === "KEYED" ? Object.values(keyedStates.fields).map((c) => c.type) : [];
  assert(new Set(keyedStateTypes).size === 5, "Keyed undefined, null, empty string, zero and false keep five distinct tags");

  const keyedUnsupported = encodeSourceRow({ "Lot ID": "L", Remark: { secret: "KEYED-NESTED-SECRET" } });
  assert(
    !canonicalJson(keyedUnsupported).includes("KEYED-NESTED-SECRET"),
    "A nested keyed object's contents never reach the encoded payload",
  );
  assert(
    keyedUnsupported.form === "KEYED" && keyedUnsupported.fields.Remark.type === "unsupported",
    "A nested keyed object is kept only as its safe type name",
  );

  // =========================================================================
  section("D. Supplied header states stay distinguishable");
  // =========================================================================
  const headerStates: Array<[string, unknown]> = [
    ["valid string", "Lot ID"], ["empty string", ""], ["null", null], ["undefined", undefined],
    ["false", false], ["zero", 0], ["other number", 7], ["object", { a: 1 }], ["array", [1]],
    ["function", () => undefined], ["symbol", Symbol("h")],
  ];
  const headerEncodings = headerStates.map(([, value]) => canonicalJson(encodeCell(value)));
  assert(new Set(headerEncodings).size === headerStates.length, `All ${headerStates.length} supplied header states encode distinctly`);

  const headerHashes = headerStates.map(([, value]) =>
    computeBatchHash({ ...v2, headers: encodeHeaders([value, "Shape"]), rows: [] }),
  );
  assert(new Set(headerHashes).size === headerStates.length, "Each supplied header state produces its own batch hash");
  assert(
    computeBatchHash({ ...v2, headers: encodeHeaders([0, "Shape"]), rows: [] }) !==
      computeBatchHash({ ...v2, headers: encodeHeaders([null, "Shape"]), rows: [] }),
    "A numeric header cannot collide with a null header",
  );
  assert(
    canonicalJson(encodeCell({ a: 1 })) !== canonicalJson(encodeCell([1])),
    "Unsupported object and array headers keep different safe type names",
  );
  assert(
    !canonicalJson(encodeHeaders([{ credential: "HEADER-OBJECT-SECRET" }])).includes("HEADER-OBJECT-SECRET"),
    "Sensitive content inside an invalid header object is never serialized",
  );
  assert(
    JSON.stringify(encodeHeaders(HEADERS).map(decodeCell)) === JSON.stringify(HEADERS),
    "The valid exact 46-header list still round-trips unchanged",
  );

  // =========================================================================
  section("E. Encoding version compatibility");
  // =========================================================================
  assert(FANTASY_RAW_ENCODING_CURRENT === FANTASY_RAW_ENCODING_V2, "New ingestion writes encoding V2");
  const namedVersions: string[] = [FANTASY_RAW_ENCODING_V1, FANTASY_RAW_ENCODING_V2];
  assert(new Set(namedVersions).size === 2, "The two encoding versions are explicitly and distinctly named");

  const legacyCells = encodePositionalRow(["LOT-LEGACY", "", null, 0, false]);
  const legacyRowJson = canonicalJson(legacyCells);
  const legacyHeaderJson = canonicalJson(["Lot ID", "Shape", null]);

  const decodedLegacyRow = decodeStoredSourceRow(legacyRowJson, FANTASY_RAW_ENCODING_V1);
  assert(decodedLegacyRow.form === "POSITIONAL", "A stored V1 payload still decodes as a positional row");
  assert(
    decodedLegacyRow.form === "POSITIONAL" &&
      decodedLegacyRow.cells.length === 5 &&
      decodedLegacyRow.cells[0] === "LOT-LEGACY" &&
      decodedLegacyRow.cells[1] === "" &&
      decodedLegacyRow.cells[2] === null &&
      decodedLegacyRow.cells[3] === 0 &&
      decodedLegacyRow.cells[4] === false,
    "Every supported V1 cell value decodes back exactly",
  );
  const decodedLegacyHeaders = decodeStoredHeaders(legacyHeaderJson, FANTASY_RAW_ENCODING_V1);
  assert(
    decodedLegacyHeaders.length === 3 && decodedLegacyHeaders[0] === "Lot ID" && decodedLegacyHeaders[2] === null,
    "A stored V1 header payload still decodes",
  );

  const v1RowFingerprint = computeRowHash({
    encodingVersion: FANTASY_RAW_ENCODING_V1,
    contractVersion: FANTASY_ROW_CONTRACT_V1,
    positional: legacyCells,
  });
  const v2RowFingerprint = computeRowHash({ ...v2, row: { form: "POSITIONAL", cells: legacyCells } });
  assert(v1RowFingerprint !== v2RowFingerprint, "The same cells fingerprint differently under V1 and V2");

  const v1BatchFingerprint = computeBatchHash({
    encodingVersion: FANTASY_RAW_ENCODING_V1,
    contractVersion: FANTASY_ROW_CONTRACT_V1,
    headers: ["Lot ID", "Shape", null],
    rows: [legacyCells],
  });
  const v2BatchFingerprint = computeBatchHash({
    ...v2,
    headers: encodeHeaders(["Lot ID", "Shape", null]),
    rows: [{ form: "POSITIONAL", cells: legacyCells }],
  });
  assert(v1BatchFingerprint !== v2BatchFingerprint, "The same batch fingerprints differently under V1 and V2");

  // A genuinely stored V1 record, to prove new ingestion never rewrites it.
  const legacyBatch = await db.fantasyRawBatch.create({
    data: {
      contractVersion: FANTASY_ROW_CONTRACT_V1,
      encodingVersion: FANTASY_RAW_ENCODING_V1,
      sourceMode: "FIXTURE",
      providerBatchId: "RAW-LEGACY-V1",
      batchHash: v1BatchFingerprint,
      headersJson: legacyHeaderJson,
      cursorKind: "FULL_SNAPSHOT",
      status: "ACCEPTED",
      rowsReceived: 1,
      rowsAccepted: 1,
    },
  });
  const legacyRow = await db.fantasyRawRow.create({
    data: {
      batchId: legacyBatch.id,
      sourceRowNumber: 1,
      encodingVersion: FANTASY_RAW_ENCODING_V1,
      rawPayloadJson: legacyRowJson,
      rowHash: v1RowFingerprint,
      outcome: "ACCEPTED_RAW",
    },
  });
  const readBackLegacy = decodeStoredSourceRow(legacyRow.rawPayloadJson, legacyRow.encodingVersion);
  assert(readBackLegacy.form === "POSITIONAL", "A V1 row read from the database decodes through its stored version tag");

  // =========================================================================
  section("F. DRY_RUN writes nothing");
  // =========================================================================
  const dryBefore = await canonicalSnapshot();
  const rawBefore = { batches: await db.fantasyRawBatch.count(), rows: await db.fantasyRawRow.count() };

  const dryBatch = makeBatch([row({ "Lot ID": "LOT-DRY-1" }), row({ "Lot ID": "LOT-DRY-2" })]);
  const dry = await ingestFantasyRawBatch(dryBatch, { mode: "DRY_RUN", db, provenance: FIXTURE_PROVENANCE });

  assert(dry.mode === "DRY_RUN" && dry.batchId === null, "Dry run allocates no persistent identifier");
  assert(dry.counts.received === 2 && dry.counts.accepted === 2, "Dry run returns validation counts");
  assert(typeof dry.batchHash === "string" && dry.batchHash.length === 64, "Dry run computes a deterministic batch hash");
  assert(dry.rowOutcomes.every((r) => r.rowHash.length === 64), "Dry run computes row hashes");
  assert(
    (await db.fantasyRawBatch.count()) === rawBefore.batches && (await db.fantasyRawRow.count()) === rawBefore.rows,
    "Dry run performs zero raw writes",
  );
  const dryAfter = await canonicalSnapshot();
  assert(JSON.stringify(dryAfter.counts) === JSON.stringify(dryBefore.counts), "Dry run modifies no canonical record");
  assert(JSON.stringify(dryAfter.checkpoints) === JSON.stringify(dryBefore.checkpoints), "Dry run does not mutate sync checkpoints");

  const dryRepeat = await ingestFantasyRawBatch(dryBatch, { mode: "DRY_RUN", db, provenance: FIXTURE_PROVENANCE });
  assert(dryRepeat.batchHash === dry.batchHash, "Dry run hashes are stable across repeated calls");

  // =========================================================================
  section("G. PERSIST stores the batch and its raw rows");
  // =========================================================================
  const persistBatch = makeBatch(
    [
      row({ "Lot ID": "  LOT-P-1  ", Remark: null, "Metal Color": "", Qty: 0, "On Hold": false, "Certificate No": "0012345" }),
      row({ "Lot ID": "LOT-P-2", "Metal Wgt": 1.25, "Met.Wgt": 9.75, Weight: "1.05", "Est. Weight": "0.55" }),
    ],
    { providerMetadata: { providerName: "fixture", environment: "test", authorization: "Bearer SECRET", nested: 1 } },
  );
  const persisted = await ingestFantasyRawBatch(persistBatch, { mode: "PERSIST", db, provenance: FIXTURE_PROVENANCE });

  assert(persisted.batchId !== null, "Persist returns the stored batch identifier");
  assert(persisted.idempotentReplay === false, "A first persist is not a replay");
  assert(persisted.status === "ACCEPTED", `A clean batch is ACCEPTED (got ${persisted.status})`);
  assert(persisted.encodingVersion === FANTASY_RAW_ENCODING_V2, "A new persist reports encoding V2");

  const storedBatch = await db.fantasyRawBatch.findUniqueOrThrow({ where: { id: persisted.batchId! } });
  assert(storedBatch.contractVersion === FANTASY_ROW_CONTRACT_V1, "The contract version is persisted");
  assert(storedBatch.encodingVersion === FANTASY_RAW_ENCODING_V2, "The encoding version is persisted as V2");
  const storedHeaders = decodeStoredHeaders(storedBatch.headersJson, storedBatch.encodingVersion);
  assert(storedHeaders.length === 46, "All 46 headers are persisted");
  assert(JSON.stringify(storedHeaders) === JSON.stringify(HEADERS), "Exact header names and order are recoverable");
  assert(storedBatch.cursorKind === "FULL_SNAPSHOT" && storedBatch.cursorTokenHash === null, "Cursor kind is stored and no token is kept");

  const storedMetadata = JSON.parse(storedBatch.providerMetadataJson ?? "{}");
  assert(
    Object.keys(storedMetadata).every((k) => (ALLOWED_PROVIDER_METADATA_KEYS as readonly string[]).includes(k)),
    "Only allowlisted provider metadata keys are stored",
  );
  assert(!("authorization" in storedMetadata), "A credential-looking metadata key is dropped");
  assert(!JSON.stringify(storedMetadata).includes("SECRET"), "Dropped metadata values never reach storage");
  assert(persisted.droppedMetadataKeyCount === 2, `Dropped metadata keys are counted, not named (got ${persisted.droppedMetadataKeyCount})`);

  const storedRows = await db.fantasyRawRow.findMany({ where: { batchId: persisted.batchId! }, orderBy: { sourceRowNumber: "asc" } });
  assert(storedRows[0].sourceRowNumber === 1 && storedRows[1].sourceRowNumber === 2, "Rows keep their one-based source row number");
  assert(storedRows.every((r) => r.outcome === "ACCEPTED_RAW"), "Structurally valid rows are ACCEPTED_RAW");
  assert(storedRows.every((r) => r.encodingVersion === FANTASY_RAW_ENCODING_V2), "Stored rows record encoding V2");
  assert(
    decodeStoredSourceRow(storedRows[0].rawPayloadJson, storedRows[0].encodingVersion).form === "POSITIONAL",
    "A positional source row is stored in positional form",
  );

  const record1 = JSON.parse(storedRows[0].normalizedRecordJson!) as Record<string, FantasyEncodedCell>;
  assert(decodeCell(record1.lotId) === "LOT-P-1", "Only surrounding whitespace is trimmed from values");
  assert(decodeCell(record1.remark) === null, "Explicit null survives the round trip");
  assert(decodeCell(record1.metalColorRaw) === "", "Empty string survives the round trip");
  assert(decodeCell(record1.quantityRaw) === 0, "Zero survives the round trip and is not treated as missing");
  assert(decodeCell(record1.onHoldRaw) === false, "Boolean false survives the round trip");
  assert(record1.remark.type !== record1.metalColorRaw.type, "Null and empty string remain distinguishable after storage");
  assert(decodeCell(record1.certificateNumber) === "0012345", "Leading-zero identifiers survive storage as strings");

  const record2 = JSON.parse(storedRows[1].normalizedRecordJson!) as Record<string, FantasyEncodedCell>;
  assert(decodeCell(record2.metalWeightRaw) === 1.25 && decodeCell(record2.metWeightRaw) === 9.75, "Both metal weight fields stay separate");
  assert(decodeCell(record2.weightRaw) === "1.05" && decodeCell(record2.estimatedWeightRaw) === "0.55", "Actual and estimated weights stay separate");
  assert(typeof decodeCell(record2.weightRaw) === "string", "No weight parsing occurs");
  assert(decodeCell(record2.documentDateRaw) === "v:Doc Date", "No date parsing occurs");
  assert(decodeCell(record2.lotStatusRaw) === "v:Lot Status DB", "No status interpretation occurs");
  assert(decodeCell(record2.onHoldRaw) === "v:On Hold", "No hold interpretation occurs");
  assert(decodeCell(record2.quantityRaw) === "v:Qty", "No quantity interpretation occurs");

  // =========================================================================
  section("H. PERSIST stores keyed API rows without flattening them");
  // =========================================================================
  const keyedBatch = makeBatch([
    keyedRow(
      { "Lot ID": "LOT-KEYED-1", Remark: null, "Metal Color": "", Qty: 0, "On Hold": false },
      { "Vendor Notes": "UNKNOWN-FIELD", "Batch Seq": 12 },
    ),
  ]);
  const keyedPersisted = await ingestFantasyRawBatch(keyedBatch, { mode: "PERSIST", db, provenance: FIXTURE_PROVENANCE });
  const keyedStored = await db.fantasyRawRow.findFirstOrThrow({ where: { batchId: keyedPersisted.batchId! } });
  const keyedDecoded = decodeStoredSourceRow(keyedStored.rawPayloadJson, keyedStored.encodingVersion);

  assert(keyedDecoded.form === "KEYED", "A keyed source row is stored in keyed form");
  if (keyedDecoded.form === "KEYED") {
    assert("Lot ID" in keyedDecoded.fields, "The keyed row retains its exact source key names");
    assert(Object.keys(keyedDecoded.fields).length === 48, "Every delivered key is retained, including the two unknown ones");
    assert(keyedDecoded.fields["Vendor Notes"] === "UNKNOWN-FIELD", "An unknown source field is preserved in the raw payload");
    assert(keyedDecoded.fields["Batch Seq"] === 12, "An unknown numeric source field keeps its value and type");
    assert(keyedDecoded.fields.Remark === null, "A keyed explicit null round-trips");
    assert(keyedDecoded.fields["Metal Color"] === "", "A keyed empty string round-trips");
    assert(keyedDecoded.fields.Qty === 0, "A keyed zero round-trips");
    assert(keyedDecoded.fields["On Hold"] === false, "A keyed false round-trips");
  }
  const keyedRecord = JSON.parse(keyedStored.normalizedRecordJson!) as Record<string, FantasyEncodedCell>;
  assert(!("Vendor Notes" in keyedRecord) && !("vendorNotes" in keyedRecord), "An unknown source field never enters the normalized record");
  assert(Object.keys(keyedRecord).length === 46, "The normalized record holds exactly the 46 contract fields");
  assert(decodeCell(keyedRecord.lotId) === "LOT-KEYED-1", "The normalized record holds mapped contract fields only");

  // Keyed insertion order must not change identity.
  const orderedBatchA = makeBatch([keyedRow({ "Lot ID": "LOT-ORDER-A" }, { Alpha: 1, Beta: 2 })]);
  const reversedFields = (() => {
    const original = orderedBatchA.rows[0] as Record<string, unknown>;
    const reversed: Record<string, unknown> = {};
    for (const key of Object.keys(original).reverse()) reversed[key] = original[key];
    return reversed;
  })();
  const orderedBatchB = makeBatch([reversedFields], { batchId: orderedBatchA.batchId });

  const firstOrder = await ingestFantasyRawBatch(orderedBatchA, { mode: "PERSIST", db, provenance: FIXTURE_PROVENANCE });
  const secondOrder = await ingestFantasyRawBatch(orderedBatchB, { mode: "PERSIST", db, provenance: FIXTURE_PROVENANCE });
  assert(firstOrder.batchHash === secondOrder.batchHash, "Keyed property order does not change the batch hash");
  assert(secondOrder.idempotentReplay === true, "A re-ordered keyed replay is recognized as the same batch");
  assert(secondOrder.batchId === firstOrder.batchId, "The re-ordered replay resolves to the stored batch");
  assert(
    (await db.fantasyRawBatch.count({ where: { providerBatchId: orderedBatchA.batchId } })) === 1,
    "A re-ordered keyed replay stores no second batch",
  );
  assert(
    (await db.fantasyRawRow.count({ where: { batchId: firstOrder.batchId! } })) === 1,
    "A re-ordered keyed replay stores no second row",
  );

  const renamedField = makeBatch([keyedRow({ "Lot ID": "LOT-ORDER-A" }, { Alpha: 1, Gamma: 2 })]);
  assert(
    (await ingestFantasyRawBatch(renamedField, { mode: "DRY_RUN", db, provenance: FIXTURE_PROVENANCE })).batchHash !== firstOrder.batchHash,
    "Renaming an unknown keyed field changes the batch fingerprint",
  );
  const changedValue = makeBatch([keyedRow({ "Lot ID": "LOT-ORDER-A" }, { Alpha: 9, Beta: 2 })]);
  assert(
    (await ingestFantasyRawBatch(changedValue, { mode: "DRY_RUN", db, provenance: FIXTURE_PROVENANCE })).batchHash !== firstOrder.batchHash,
    "Changing an unknown keyed value changes the batch fingerprint",
  );

  const keyedSecretBatch = makeBatch([keyedRow({ "Lot ID": "LOT-KEYED-BAD" }, { Attachment: { token: "KEYED-STORED-SECRET" } })]);
  const keyedSecret = await ingestFantasyRawBatch(keyedSecretBatch, { mode: "PERSIST", db, provenance: FIXTURE_PROVENANCE });
  const keyedSecretRow = await db.fantasyRawRow.findFirstOrThrow({ where: { batchId: keyedSecret.batchId! } });
  assert(!keyedSecretRow.rawPayloadJson.includes("KEYED-STORED-SECRET"), "A nested keyed object's contents are never stored");
  assert(keyedSecretRow.rawPayloadJson.includes("unsupported"), "The nested keyed object is stored as a safe type tag");
  assert(!JSON.stringify(keyedSecret).includes("KEYED-STORED-SECRET"), "A nested keyed object's contents never reach the result or its diagnostics");
  assert(!keyedSecret.batchHash.includes("KEYED-STORED-SECRET"), "A nested keyed object's contents never reach a fingerprint");

  // =========================================================================
  section("I. Headers are persisted without collapsing");
  // =========================================================================
  const oddHeaders: unknown[] = [...HEADERS];
  oddHeaders[10] = null;
  oddHeaders[11] = 0;
  oddHeaders[12] = false;
  const oddHeaderBatch = makeBatch([row({ "Lot ID": "LOT-H" })], { headers: oddHeaders });
  const oddPersisted = await ingestFantasyRawBatch(oddHeaderBatch, { mode: "PERSIST", db, provenance: FIXTURE_PROVENANCE });
  const oddStored = await db.fantasyRawBatch.findUniqueOrThrow({ where: { id: oddPersisted.batchId! } });
  const oddDecoded = decodeStoredHeaders(oddStored.headersJson, oddStored.encodingVersion);
  assert(oddDecoded[10] === null, "A null header decodes back as null");
  assert(oddDecoded[11] === 0, "A zero header decodes back as zero, not null");
  assert(oddDecoded[12] === false, "A false header decodes back as false, not null");

  const headerVariantHash = async (replacement: unknown) =>
    (await ingestFantasyRawBatch(makeBatch([row({ "Lot ID": "LOT-H" })], { headers: HEADERS.map((h, i) => (i === 11 ? replacement : h)) }), {
      mode: "DRY_RUN",
      db,
      provenance: FIXTURE_PROVENANCE,
    })).batchHash;
  const variantHashes = new Set(
    await Promise.all([null, undefined, "", 0, false, { a: 1 }, [1]].map((v) => headerVariantHash(v))),
  );
  assert(variantHashes.size === 7, `Seven distinct invalid header states produce seven distinct batch hashes (got ${variantHashes.size}/7)`);

  const objectHeaderBatch = makeBatch([row({ "Lot ID": "LOT-H" })], {
    headers: HEADERS.map((h, i) => (i === 11 ? { credential: "STORED-HEADER-SECRET" } : h)),
  });
  const objectHeaderPersisted = await ingestFantasyRawBatch(objectHeaderBatch, { mode: "PERSIST", db, provenance: FIXTURE_PROVENANCE });
  const objectHeaderStored = await db.fantasyRawBatch.findUniqueOrThrow({ where: { id: objectHeaderPersisted.batchId! } });
  assert(!objectHeaderStored.headersJson.includes("STORED-HEADER-SECRET"), "Sensitive content inside an invalid header object is never stored");
  assert(objectHeaderStored.headersJson.includes("unsupported"), "An invalid header object is stored as its safe type name only");
  assert(
    !(objectHeaderStored.diagnosticsJson ?? "").includes("STORED-HEADER-SECRET"),
    "Header diagnostics stay value-safe for an invalid header object",
  );

  // =========================================================================
  section("J. Idempotency and batch-id conflict");
  // =========================================================================
  const replay = await ingestFantasyRawBatch(persistBatch, { mode: "PERSIST", db, provenance: FIXTURE_PROVENANCE });
  assert(replay.idempotentReplay === true, "An exact replay reports that it reused an existing ingestion");
  assert(replay.batchId === persisted.batchId, "An exact replay returns the original batch identifier");
  assert(
    (await db.fantasyRawBatch.count({ where: { providerBatchId: persistBatch.batchId } })) === 1,
    "An exact replay does not duplicate the batch",
  );
  assert(
    (await db.fantasyRawRow.count({ where: { batchId: persisted.batchId! } })) === 2,
    "An exact replay does not duplicate rows",
  );

  const conflicting = makeBatch([row({ "Lot ID": "LOT-P-1" })], { batchId: persistBatch.batchId });
  const conflict = await ingestFantasyRawBatch(conflicting, { mode: "PERSIST", db, provenance: FIXTURE_PROVENANCE });
  assert(conflict.conflict === true, "Re-using a provider batch id with different content is a conflict");
  assert(conflict.status === "CONFLICT", "The conflicting batch is stored with CONFLICT status");
  assert(conflict.conflictsWithBatchId === persisted.batchId, "The conflict points at the original batch");
  const original = await db.fantasyRawBatch.findUniqueOrThrow({ where: { id: persisted.batchId! } });
  assert(original.status === "ACCEPTED" && original.batchHash === persisted.batchHash, "The original batch is not overwritten");

  const conflictReplay = await ingestFantasyRawBatch(conflicting, { mode: "PERSIST", db, provenance: FIXTURE_PROVENANCE });
  assert(conflictReplay.idempotentReplay === true, "A later replay of a conflict is recognized as a replay");
  assert(conflictReplay.batchId === conflict.batchId, "A later replay of a conflict returns its stored conflict record");
  assert(conflictReplay.status === "CONFLICT", "A replayed conflict still reports CONFLICT");
  assert(conflictReplay.conflictsWithBatchId === persisted.batchId, "A replayed conflict still names the original");

  const originalReplay = await ingestFantasyRawBatch(persistBatch, { mode: "PERSIST", db, provenance: FIXTURE_PROVENANCE });
  assert(
    originalReplay.batchId === persisted.batchId && originalReplay.status === "ACCEPTED",
    "A later replay of the original still returns the original",
  );

  // Identity must not depend on Fantasy business fields.
  const sameLotDifferentBatch = makeBatch([row({ "Lot ID": "LOT-P-1", "Doc ID": "v:Doc ID" })]);
  const independent = await ingestFantasyRawBatch(sameLotDifferentBatch, { mode: "PERSIST", db, provenance: FIXTURE_PROVENANCE });
  assert(independent.batchId !== null && !independent.idempotentReplay, "Idempotency does not key on Lot ID or Doc ID");

  // =========================================================================
  section("K. Concurrency is database-enforced");
  // =========================================================================
  const concurrentBatch = makeBatch([row({ "Lot ID": "LOT-CONC-1" }), row({ "Lot ID": "LOT-CONC-2" })]);
  const [c1, c2] = await Promise.all([
    ingestFantasyRawBatch(concurrentBatch, { mode: "PERSIST", db, provenance: FIXTURE_PROVENANCE }),
    ingestFantasyRawBatch(concurrentBatch, { mode: "PERSIST", db, provenance: FIXTURE_PROVENANCE }),
  ]);
  assert(
    (await db.fantasyRawBatch.count({ where: { providerBatchId: concurrentBatch.batchId } })) === 1,
    "Concurrent identical submissions store exactly one batch",
  );
  assert(c1.batchId === c2.batchId, "Both concurrent callers receive the same batch identifier");
  assert(c1.idempotentReplay !== c2.idempotentReplay, "Exactly one concurrent caller is reported as the replay");
  assert(
    (await db.fantasyRawRow.count({ where: { batch: { providerBatchId: concurrentBatch.batchId } } })) === 2,
    "Concurrent submissions do not duplicate rows",
  );

  // Different payloads racing under one provider batch id, repeated at several widths.
  for (const width of [2, 3, 5]) {
    const sharedId = `RAW-RACE-${width}-${Date.now()}`;
    const variants = Array.from({ length: width }, (_, i) =>
      makeBatch([row({ "Lot ID": `LOT-RACE-${i}` })], { batchId: sharedId }),
    );
    const results = await Promise.all(variants.map((b) => ingestFantasyRawBatch(b, { mode: "PERSIST", db, provenance: FIXTURE_PROVENANCE })));

    const stored = await db.fantasyRawBatch.findMany({
      where: { providerBatchId: sharedId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    const originals = stored.filter((b) => b.status !== "CONFLICT");
    const conflicts = stored.filter((b) => b.status === "CONFLICT");

    assert(stored.length === width, `${width} racing payloads store ${width} batches (got ${stored.length})`);
    assert(originals.length === 1, `${width} racing payloads produce exactly one original (got ${originals.length})`);
    assert(conflicts.length === width - 1, `${width} racing payloads produce ${width - 1} conflicts (got ${conflicts.length})`);
    assert(conflicts.every((c) => c.conflictsWithBatchId === originals[0].id), `Every conflict among ${width} references the committed original`);
    assert(originals[0].id === stored[0].id, `The original among ${width} racing payloads is the earliest committed batch`);
    assert(results.filter((r) => !r.conflict).length === 1, `Exactly one caller among ${width} is told it is the original`);

    const rowCounts = await Promise.all(stored.map((b) => db.fantasyRawRow.count({ where: { batchId: b.id } })));
    assert(rowCounts.every((n) => n === 1), `Every racing batch among ${width} committed all of its rows`);
    assert(stored.every((b) => b.rowsReceived === 1), `No racing batch among ${width} recorded a partial row count`);

    const originalIndex = results.findIndex((r) => r.batchId === originals[0].id);
    const replayOfOriginal = await ingestFantasyRawBatch(variants[originalIndex], { mode: "PERSIST", db, provenance: FIXTURE_PROVENANCE });
    assert(replayOfOriginal.batchId === originals[0].id, `A later replay after a ${width}-way race still returns the original`);
    assert(!replayOfOriginal.conflict, `A later replay of the original after a ${width}-way race is not reported as a conflict`);

    const conflictIndex = results.findIndex((r) => r.conflict);
    const replayOfConflict = await ingestFantasyRawBatch(variants[conflictIndex], { mode: "PERSIST", db, provenance: FIXTURE_PROVENANCE });
    assert(replayOfConflict.batchId === results[conflictIndex].batchId, `A later replay of a conflict after a ${width}-way race is consistent`);
    assert(
      (await db.fantasyRawBatch.count({ where: { providerBatchId: sharedId } })) === width,
      `Replays after a ${width}-way race create no further batches`,
    );
  }

  // =========================================================================
  section("L. A failure inside the transaction leaves nothing behind");
  // =========================================================================
  const failingBatchId = `RAW-ROLLBACK-${Date.now()}`;
  const rollbackBatch = makeBatch([row({ "Lot ID": "LOT-ROLLBACK" })], { batchId: failingBatchId });
  const failingDb: RawIngestionDb = {
    $transaction: (fn, options) =>
      db.$transaction(
        (tx) =>
          fn({
            $executeRaw: (query: TemplateStringsArray, ...values: unknown[]) => tx.$executeRaw(query, ...values),
            fantasyRawBatch: tx.fantasyRawBatch as unknown as RawIngestionTx["fantasyRawBatch"],
            fantasyRawRow: {
              // A real failure inside the transaction, after the batch row was inserted.
              createMany: () => Promise.reject(new Error("injected raw-row failure quoting LOT-ROLLBACK")),
            },
          }),
        options,
      ),
  };
  let rollbackError: unknown = null;
  try {
    await ingestFantasyRawBatch(rollbackBatch, { mode: "PERSIST", db: failingDb, provenance: FIXTURE_PROVENANCE });
  } catch (error) {
    rollbackError = error;
  }
  assert(rollbackError instanceof FantasyRawIngestionError, "A persistence failure raises the service's own error type");
  assert(
    rollbackError instanceof FantasyRawIngestionError && rollbackError.code === "RAW_INGESTION_PERSIST_FAILED",
    "The failure reports a fixed safe code",
  );
  const rollbackMessage = rollbackError instanceof Error ? rollbackError.message : "";
  assert(!rollbackMessage.includes("LOT-ROLLBACK"), "The failure message carries no source value");
  assert(!rollbackMessage.includes(failingBatchId), "The failure message carries no provider batch identifier");
  assert(
    (await db.fantasyRawBatch.count({ where: { providerBatchId: failingBatchId } })) === 0,
    "A failure inside the transaction leaves no partial batch",
  );
  assert(
    (await db.fantasyRawRow.count({ where: { batch: { providerBatchId: failingBatchId } } })) === 0,
    "A failure inside the transaction leaves no partial rows",
  );

  // =========================================================================
  section("M. Quarantine and structural rejection");
  // =========================================================================
  const shortRow = row().slice(0, 40);
  const quarantineBatch = makeBatch([row({ "Lot ID": "LOT-Q-OK" }), shortRow]);
  const quarantined = await ingestFantasyRawBatch(quarantineBatch, { mode: "PERSIST", db, provenance: FIXTURE_PROVENANCE });
  const qRows = await db.fantasyRawRow.findMany({ where: { batchId: quarantined.batchId! }, orderBy: { sourceRowNumber: "asc" } });
  assert(qRows[0].outcome === "ACCEPTED_RAW", "A structurally sound row is accepted");
  assert(qRows[1].outcome === "QUARANTINED", "A short row is quarantined, not rejected");
  assert((qRows[1].quarantineReasonCodes ?? "").includes("ROW_TOO_SHORT"), "The quarantine reason code is stored");
  assert(quarantined.status === "ACCEPTED_WITH_ISSUES", "A batch containing quarantined rows is flagged");
  assert(qRows[1].normalizedRecordJson !== null, "A quarantined row still preserves its normalized record");

  const driftBatch = makeBatch([row({ "Lot ID": "LOT-DRIFT" })], { headers: [...HEADERS, "Surprise Column"] });
  const drift = await ingestFantasyRawBatch(driftBatch, { mode: "PERSIST", db, provenance: FIXTURE_PROVENANCE });
  const driftRows = await db.fantasyRawRow.findMany({ where: { batchId: drift.batchId! } });
  assert(driftRows[0].outcome === "QUARANTINED", "Header drift quarantines the rows it affects");
  assert((driftRows[0].quarantineReasonCodes ?? "").includes("UNKNOWN_HEADER"), "The drift code is recorded on the row");

  const unsupportedBatch = makeBatch([row({ "Lot ID": "LOT-BAD", Remark: { secret: "NESTED-SECRET-VALUE" } })]);
  const unsupported = await ingestFantasyRawBatch(unsupportedBatch, { mode: "PERSIST", db, provenance: FIXTURE_PROVENANCE });
  const badRow = await db.fantasyRawRow.findFirstOrThrow({ where: { batchId: unsupported.batchId! } });
  assert(badRow.outcome === "REJECTED_STRUCTURE", "A row with an unsupported value is structurally rejected");
  assert(badRow.normalizedRecordJson === null, "A rejected row stores no normalized record");
  assert(!badRow.rawPayloadJson.includes("NESTED-SECRET-VALUE"), "The unsupported value's contents are never persisted");
  assert(badRow.rawPayloadJson.includes("unsupported"), "The unsupported cell is preserved as a type tag only");

  const noIdentityBatch = makeBatch([row({ "Lot ID": "" })]);
  const noIdentity = await ingestFantasyRawBatch(noIdentityBatch, { mode: "PERSIST", db, provenance: FIXTURE_PROVENANCE });
  const noIdRow = await db.fantasyRawRow.findFirstOrThrow({ where: { batchId: noIdentity.batchId! } });
  assert(noIdRow.outcome === "REJECTED_STRUCTURE", "A row without a usable Lot ID is structurally rejected");

  const fatalHeaderBatch = makeBatch([row({ "Lot ID": "LOT-X" })], { headers: HEADERS.filter((h) => h !== "Lot ID") });
  const fatalHeaders = await ingestFantasyRawBatch(fatalHeaderBatch, { mode: "PERSIST", db, provenance: FIXTURE_PROVENANCE });
  assert(fatalHeaders.status === "REJECTED", "A fatally unusable header row rejects the batch");
  const fatalRows = await db.fantasyRawRow.findMany({ where: { batchId: fatalHeaders.batchId! } });
  assert(fatalRows.every((r) => r.outcome === "REJECTED_STRUCTURE"), "Rows under unusable headers are rejected");
  assert(fatalRows.every((r) => r.normalizedRecordJson === null), "No field association is claimed when the header row is unusable");

  const badVersionBatch = makeBatch([row({ "Lot ID": "LOT-V" })], { contractVersion: "FANTASY_ROW_CONTRACT_V9" });
  const badVersion = await ingestFantasyRawBatch(badVersionBatch, { mode: "PERSIST", db, provenance: FIXTURE_PROVENANCE });
  assert(badVersion.status === "REJECTED", "An unsupported contract version rejects the batch");
  assert(
    badVersion.diagnostics.issues.some((i) => i.code === "UNSUPPORTED_CONTRACT_VERSION"),
    "The unsupported version is reported by code",
  );

  // =========================================================================
  section("N. Diagnostics contain no source values");
  // =========================================================================
  const sensitiveBatch = makeBatch([
    row({
      "Lot ID": "",
      Remark: "CONFIDENTIAL-REMARK",
      "Company ID": "COMPANY-SECRET",
      "Allocation Account ID": "ACCOUNT-SECRET",
      "Certificate No": "CERT-SECRET",
      "Doc ID": "DOC-SECRET",
    }),
  ], { cursor: { kind: "PROVIDER_SUPPLIED", token: "CURSOR-TOKEN-SECRET" } });
  const sensitive = await ingestFantasyRawBatch(sensitiveBatch, { mode: "PERSIST", db, provenance: FIXTURE_PROVENANCE });

  const sensitiveBatchRow = await db.fantasyRawBatch.findUniqueOrThrow({ where: { id: sensitive.batchId! } });
  const sensitiveRows = await db.fantasyRawRow.findMany({ where: { batchId: sensitive.batchId! } });
  const diagnosticText = [
    sensitiveBatchRow.diagnosticsJson ?? "",
    ...sensitiveRows.map((r) => r.diagnosticsJson ?? ""),
    ...sensitiveRows.map((r) => r.quarantineReasonCodes ?? ""),
    JSON.stringify(sensitive.diagnostics),
  ].join(" ");
  for (const secret of ["CONFIDENTIAL-REMARK", "COMPANY-SECRET", "ACCOUNT-SECRET", "CERT-SECRET", "DOC-SECRET", "CURSOR-TOKEN-SECRET"]) {
    assert(!diagnosticText.includes(secret), `Diagnostics never contain the source value "${secret}"`);
  }
  assert(sensitiveBatchRow.cursorTokenHash === sha256Hex("CURSOR-TOKEN-SECRET"), "Only a hash of the cursor token is stored");
  assert(!JSON.stringify(sensitiveBatchRow).includes("CURSOR-TOKEN-SECRET"), "The raw cursor token is never stored");
  assert(!JSON.stringify(sensitive).includes("CONFIDENTIAL-REMARK"), "The service result carries no raw payload");

  // =========================================================================
  section("O. Canonical isolation and untouched V1 data");
  // =========================================================================
  const after = await canonicalSnapshot();
  assert(JSON.stringify(after.counts) === JSON.stringify(before.counts), "No canonical operational table changed during ingestion");
  assert(JSON.stringify(after.checkpoints) === JSON.stringify(before.checkpoints), "Sync checkpoints are unchanged");
  assert(after.counts.auditLogs === before.counts.auditLogs, "Ingestion writes no audit rows implying canonical effects");
  assert((await db.fantasyRawBatch.count()) > 0, "Raw staging did receive the data (the isolation above is meaningful)");

  const untouchedRow = await db.fantasyRawRow.findUniqueOrThrow({ where: { id: legacyRow.id } });
  assert(untouchedRow.encodingVersion === FANTASY_RAW_ENCODING_V1, "The stored V1 row still declares encoding V1");
  assert(untouchedRow.rawPayloadJson === legacyRowJson, "The stored V1 payload was never rewritten");
  assert(untouchedRow.rowHash === v1RowFingerprint, "The stored V1 row fingerprint was never recomputed");
  const untouchedBatch = await db.fantasyRawBatch.findUniqueOrThrow({ where: { id: legacyBatch.id } });
  assert(untouchedBatch.headersJson === legacyHeaderJson, "The stored V1 header payload was never rewritten");
  assert(untouchedBatch.encodingVersion === FANTASY_RAW_ENCODING_V1, "The stored V1 batch still declares encoding V1");

  const serviceSource = readFileSync(path.join(process.cwd(), "src", "lib", "fantasy", "raw-ingestion.ts"), "utf8");
  for (const canonical of [
    "lotMasterRecord", "lotHistoryRecord", "polishedStone", "roughStone", "salesRecord", "memoRecord",
    "requirement", "planningCase", "planOption", "demandRun", "demandMetric", "syncCheckpoint", "integrationSyncRun.",
  ]) {
    assert(!serviceSource.includes(canonical), `The ingestion service never references the canonical delegate "${canonical}"`);
  }
  assert(!/console\.(log|info|warn|error|debug)/.test(serviceSource), "The ingestion service logs nothing");
  assert(/typeof window !== "undefined"/.test(serviceSource), "The ingestion service guards against browser execution");
  assert(!serviceSource.includes("Object.values(row)"), "Keyed rows are no longer flattened through Object.values");
  assert(serviceSource.includes("pg_advisory_xact_lock(${lockKey}::bigint)"), "The identity lock is a bound parameter, not interpolated SQL");
  assert(!/\$executeRawUnsafe|\$queryRawUnsafe/.test(serviceSource), "No unsafe raw query form is used");

  const encodingSource = readFileSync(path.join(process.cwd(), "src", "lib", "fantasy", "raw-encoding.ts"), "utf8");
  assert(!/console\.(log|info|warn|error|debug)/.test(encodingSource), "The encoding module logs nothing");
  assert(!/String\(value\)/.test(encodingSource), "Unsupported values are never stringified");

  // =========================================================================
  section("P. No browser or API exposure");
  // =========================================================================
  const walk = (dir: string, acc: string[] = []): string[] => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, acc);
      else if (/\.tsx?$/.test(entry.name)) acc.push(full);
    }
    return acc;
  };
  const clientFiles = walk(path.join(process.cwd(), "src", "components"));
  const clientImporters = clientFiles.filter((f) => /fantasy\/(raw-ingestion|raw-encoding|row-contract)/.test(readFileSync(f, "utf8")));
  assert(clientImporters.length === 0, `No client component imports raw ingestion code${clientImporters.length ? `: ${clientImporters.join(", ")}` : ""}`);

  const apiFiles = walk(path.join(process.cwd(), "src", "app", "api"));
  const apiImporters = apiFiles.filter((f) => /raw-ingestion|raw-encoding|fantasyRawBatch|fantasyRawRow/.test(readFileSync(f, "utf8")));
  assert(apiImporters.length === 0, `No API route exposes raw ingestion${apiImporters.length ? `: ${apiImporters.join(", ")}` : ""}`);

  // Exactly two modules may touch the raw models: the service that writes them, and the
  // projection service that reads them. Anything else reaching these tables would be a
  // second, unreviewed path to raw source payloads.
  const RAW_MODEL_ALLOWLIST = [/raw-ingestion\.ts$/, /projection\.ts$/];
  const libFiles = walk(path.join(process.cwd(), "src", "lib"));
  const otherRawUsers = libFiles.filter(
    (f) => !RAW_MODEL_ALLOWLIST.some((allowed) => allowed.test(f)) && /fantasyRawBatch|fantasyRawRow/.test(readFileSync(f, "utf8")),
  );
  assert(otherRawUsers.length === 0, `Raw models are reachable only from ingestion and projection${otherRawUsers.length ? `: ${otherRawUsers.join(", ")}` : ""}`);

  // Projection's access is read-only. It must never create, alter or remove raw evidence.
  const projectionSrc = readFileSync(path.join(process.cwd(), "src", "lib", "fantasy", "projection.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  const rawWrites = /fantasyRaw(Batch|Row)\s*\.\s*(create|createMany|update|updateMany|upsert|delete|deleteMany)/.test(projectionSrc);
  assert(!rawWrites, "Projection only reads the raw models; it never writes or deletes them");

  console.log("\n===============================================================================");
  console.log(`RESULT: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log("Failures:");
    for (const f of failures) console.log(`  - ${f}`);
  }
  console.log("===============================================================================");
  if (failed > 0) process.exit(1);
}

main()
  .catch((e) => {
    console.error("FATAL TEST FAILURE:", e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
