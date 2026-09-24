/**
 * FANTASY MEASUREMENT, QUANTITY/WEIGHT SAFETY AND SHADOW PROJECTION
 * (Master Phase 1, Checkpoints 3–7)
 *
 * Runs against the isolated security-test database only (planning_sectest).
 *
 * Proves: source numerics are parsed strictly and never coerced to zero; a row is never
 * assumed to be one piece; a weight without a configured unit cannot enter a
 * calculation; jewellery and multi-stone rows are flagged rather than consumed; an
 * estimated value never fills, overwrites or corroborates a measured one; estimated
 * identifiers stay opaque without an approved lookup; estimates cannot reduce confirmed
 * shortage; projection is structurally isolated from the canonical records; an ACTIVE
 * projection is refused by the database itself; candidates are immutable; reconciliation
 * reports differences without exposing source values; and the downstream source policy
 * refuses to silently fall back.
 *
 * Usage: npx tsx scripts/with-sectest-db.ts npx tsx scripts/test-fantasy-projection.ts
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { db } from "../src/lib/db";
import { SECTEST_DB } from "../tests/security/test-db";
import {
  assessStructureRisk,
  FIXTURE_MEASUREMENT_PROFILE,
  interpretQuantity,
  interpretWeight,
  LIVE_MEASUREMENT_PROFILE,
  measurementProfileFor,
  parseSourceNumeric,
  SIMULATION_SUPPORTED_QUANTITY,
} from "../src/lib/fantasy/quantity-weight";
import {
  countsTowardConfirmedShortage,
  resolveMeasurements,
  resolveTextAttribute,
  resolveWeightAttribute,
  STRICT_ACTUAL_ONLY,
} from "../src/lib/fantasy/measurements";
import {
  ACTIVATION_BLOCKED_REASON,
  buildProjectionIdentity,
  IDENTITY_POLICY_VERSION,
  isProjectionMode,
  ProjectionError,
  PROJECTION_MODES,
  PROJECTION_PAGE_SIZE,
  projectionFingerprint,
  projectRow,
  runProjection,
} from "../src/lib/fantasy/projection";
import {
  decideProjectionEligibility,
  rowSkipReason,
  type ProjectionEligibilityInput,
} from "../src/lib/fantasy/projection-provenance";
import {
  reconcileProjectionRun,
  ReconciliationError,
  RECONCILIATION_MAX_CANDIDATES,
} from "../src/lib/fantasy/projection-reconciliation";
import {
  ABORT_NOTE_MAX_LENGTH,
  abortProjectionAttempt,
  DEFAULT_PROJECTION_WORKLOAD_LIMITS,
  finalizeOwnedAttempt,
  hashOwnerToken,
  isAbortReasonCode,
  issueOwnerToken,
  ProjectionRecoveryError,
  resolveProjectionWorkloadLimits,
  touchHeartbeatOwned,
  writeCandidatePageOwned,
} from "../src/lib/fantasy/projection-recovery";
import { PrismaClient } from "@prisma/client";
import {
  assertOperationalPolicy,
  DownstreamSourcePolicyError,
  downstreamPolicySummary,
  policyAvailability,
} from "../src/lib/fantasy/downstream-source-policy";
import { ingestFantasyRawBatch, type RawIngestionProvenance } from "../src/lib/fantasy/raw-ingestion";
import { FANTASY_ROW_CONTRACT_V1, FANTASY_V1_HEADERS } from "../src/lib/fantasy/row-contract";
import { LEGACY_FIXTURE_PROFILE, loadClassificationProfile } from "../src/lib/fantasy/classification-profile";

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

/** Source text with comments removed, so a scan cannot match its own documentation. */
const codeOf = (file: string) =>
  readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next" || entry === ".git") continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(full)) out.push(full);
  }
  return out;
}

const REPO = path.resolve(__dirname, "..");

/**
 * Provenance every batch in this suite is ingested under. Ingestion requires it, and
 * projection binds to it rather than to the application's current configuration.
 */
const FIXTURE_PROVENANCE: RawIngestionProvenance = {
  effectiveSourceState: "FIXTURE_SIMULATION",
  providerId: "fixture-raw-test",
};

/** A coherent fixture batch, used as the baseline each eligibility case deviates from. */
const FINGERPRINT_BASE = {
  batchId: "batch-1",
  batchHash: "hash-1",
  mode: "SHADOW" as const,
  contractVersion: FANTASY_ROW_CONTRACT_V1,
  encodingVersion: "FANTASY_RAW_ENCODING_V2",
  effectiveSourceState: "FIXTURE_SIMULATION",
  classificationProfile: LEGACY_FIXTURE_PROFILE,
  classificationProfileVersion: 1,
  identityPolicyVersion: 1,
  measurementPolicy: "STRICT_ACTUAL_ONLY",
  quantitySemantics: "PIECE_COUNT",
  weightUnit: "CARAT",
};

/** Builds a contract-shaped row with named overrides. */
function fantasyRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const base: Record<string, unknown> = {};
  for (const header of FANTASY_V1_HEADERS) base[header] = null;
  base["Lot ID"] = "TEST-LOT-1";
  base["Company ID"] = "CO-1";
  base["Lot Status DB"] = "STOCK";
  base["Shape"] = "ROUND";
  base["Weight"] = "1.25";
  base["Qty"] = "1";
  base["Doc Date"] = "2026-01-01";
  return { ...base, ...overrides };
}

async function main() {
  console.log("===============================================================================");
  console.log("MEASUREMENT SEPARATION, QUANTITY/WEIGHT SAFETY & SHADOW PROJECTION");
  console.log("===============================================================================");

  const classificationProfile = await loadClassificationProfile(LEGACY_FIXTURE_PROFILE);
  if (classificationProfile === null) {
    console.error("REFUSING TO RUN: the LEGACY_FIXTURE profile is not configured. Deploy migrations first.");
    process.exit(1);
  }

  // Housekeeping. Attempts are append-only and candidates are immutable, so a previous
  // run of this suite can leave RUNNING attempts behind that consume global capacity
  // for every later run. They are released through the real abort path rather than a
  // forced status write, which the database would refuse for lacking attribution.
  const leftoverRunning = await db.fantasyProjectionRun.findMany({
    where: { status: "RUNNING" },
    select: { id: true, version: true },
  });
  for (const stale of leftoverRunning) {
    await abortProjectionAttempt(
      {
        runId: stale.id,
        expectedVersion: stale.version,
        actorUserId: "sectest-housekeeping",
        reasonCode: "SUSPECTED_STALLED_WORKER",
        note: "released by the projection test suite before running",
      },
      async () => {},
    );
  }

  /** A coherent fixture batch. Each eligibility case below deviates from exactly one field. */
  const ELIGIBLE_INPUT: ProjectionEligibilityInput = {
    batchStatus: "ACCEPTED",
    batchSourceMode: "FIXTURE",
    effectiveSourceStateAtIngestion: "FIXTURE_SIMULATION",
    providerIdAtIngestion: "fixture-raw-test",
    profile: classificationProfile,
  };

  // =========================================================================
  section("A. Strict numeric parsing — nothing becomes zero");
  // =========================================================================
  for (const missing of [null, undefined, "", "   "]) {
    const r = parseSourceNumeric(missing);
    assert(r.state === "MISSING", `${JSON.stringify(missing)} parses as MISSING`);
    assert(r.value === null, `${JSON.stringify(missing)} yields null, never 0`);
  }

  for (const bad of ["abc", "1,250", "1.25ct", "1-2", "1.2.3", " 1 2 ", "NaN", true, {}, []]) {
    const r = parseSourceNumeric(bad);
    assert(r.state === "INVALID", `${JSON.stringify(bad)} is INVALID`);
    assert(r.value === null, `${JSON.stringify(bad)} yields null, never a cleaned-up number`);
  }

  assert(parseSourceNumeric("-1").reason === "NEGATIVE", "A negative weight is rejected as NEGATIVE");
  assert(parseSourceNumeric("-1", { allowNegative: true }).state === "VALID", "Negatives pass only when allowed");
  assert(parseSourceNumeric("1.234567", { maxDecimals: 4 }).reason === "TOO_MANY_DECIMALS", "Over-precision is rejected");
  assert(parseSourceNumeric("99999999999").reason === "EXCEEDS_RANGE", "An implausible magnitude is rejected");
  assert(parseSourceNumeric(Infinity).reason === "NOT_FINITE", "Infinity is rejected as NOT_FINITE");
  const zero = parseSourceNumeric("0");
  assert(zero.state === "VALID" && zero.isExplicitZero, "An explicit zero is preserved and marked explicit");
  assert(parseSourceNumeric("0", { allowZero: false }).state === "INVALID", "Zero is rejected where it is meaningless");
  assert(parseSourceNumeric("1.25").value === 1.25, "A clean decimal parses exactly");

  // =========================================================================
  section("B. Quantity — a row is never assumed to be one piece");
  // =========================================================================
  const liveQty = interpretQuantity("1", { semantics: LIVE_MEASUREMENT_PROFILE.quantitySemantics, simulated: false });
  assert(liveQty.state === "SEMANTICS_NOT_CONFIGURED", "Live quantity is unusable: row granularity is unconfirmed");
  assert(liveQty.pieces === null, "Live quantity yields no piece count");
  assert(liveQty.rawValue === 1, "Live quantity still preserves the parsed value for review");

  const fixtureQty = interpretQuantity("1", { semantics: "PIECE_COUNT", simulated: true });
  assert(fixtureQty.state === "USABLE" && fixtureQty.pieces === 1, "A fixture row of quantity 1 is usable");
  assert(SIMULATION_SUPPORTED_QUANTITY === 1, "Simulation supports exactly one quantity value");

  for (const unsupported of ["2", "10", "0.5"]) {
    const r = interpretQuantity(unsupported, { semantics: "PIECE_COUNT", simulated: true });
    assert(r.state === "UNSUPPORTED_VALUE", `Simulated quantity ${unsupported} is unsupported, not multiplied out`);
    assert(r.pieces === null, `Simulated quantity ${unsupported} yields no piece count`);
  }

  const missingQty = interpretQuantity(null, { semantics: "PIECE_COUNT", simulated: true });
  assert(missingQty.state === "MISSING" && missingQty.pieces === null, "A missing quantity never defaults to 1");

  // =========================================================================
  section("C. Weight — no unit, no calculation");
  // =========================================================================
  const liveWeight = interpretWeight("1.25", { unit: LIVE_MEASUREMENT_PROFILE.weightUnit, simulated: false });
  assert(liveWeight.state === "UNIT_NOT_CONFIGURED", "A live weight has no configured unit");
  assert(liveWeight.carats === null, "An unconfigured unit yields no carat value");
  assert(liveWeight.rawValue === 1.25, "The raw weight is still preserved");

  const fixtureWeight = interpretWeight("1.25", { unit: "CARAT", simulated: true });
  assert(fixtureWeight.state === "USABLE" && fixtureWeight.carats === 1.25, "A fixture weight in carats is usable");
  assert(interpretWeight("0", { unit: "CARAT", simulated: true }).state === "INVALID", "A zero weight is not a weight");
  assert(
    LIVE_MEASUREMENT_PROFILE.weightUnit !== FIXTURE_MEASUREMENT_PROFILE.weightUnit,
    "The live and fixture profiles share no default unit",
  );
  assert(measurementProfileFor(false).quantitySemantics === "NOT_CONFIGURED", "A live profile configures no semantics");
  assert(measurementProfileFor(true).simulated === true, "The fixture profile is marked simulated");

  // =========================================================================
  section("D. Jewellery and multi-stone protection");
  // =========================================================================
  const loose = assessStructureRisk({ quantity: fixtureQty, weight: "1.25" });
  assert(loose.reviewRequired === false && loose.risks.length === 0, "A plain single-stone row raises no risk");

  const many = assessStructureRisk({
    quantity: interpretQuantity("5", { semantics: "PIECE_COUNT", simulated: false }),
  });
  assert(many.risks.includes("QUANTITY_GREATER_THAN_ONE"), "A quantity above one is flagged");

  assert(
    assessStructureRisk({ quantity: fixtureQty, metalId: "18KT" }).risks.includes("METAL_IDENTIFIER_PRESENT"),
    "A metal identifier is flagged",
  );
  assert(
    assessStructureRisk({ quantity: fixtureQty, metalWeight: "2.5" }).risks.includes("METAL_WEIGHT_PRESENT"),
    "A metal weight is flagged",
  );
  assert(
    assessStructureRisk({ quantity: fixtureQty, metWeight: "2.5" }).risks.includes("METAL_WEIGHT_PRESENT"),
    "Met.Wgt is flagged as well as Metal Wgt",
  );
  assert(
    assessStructureRisk({ quantity: fixtureQty, itemName: "Diamond Ring 18K" }).risks.includes("ITEM_NAME_SUGGESTS_ITEM"),
    "An item name suggesting jewellery is flagged",
  );
  assert(
    assessStructureRisk({ quantity: fixtureQty, weight: "1.00", totalDiamondWeight: "3.50" }).risks.includes(
      "TOTAL_WEIGHT_EXCEEDS_STONE_WEIGHT",
    ),
    "A total diamond weight above the stone weight is flagged",
  );
  assert(
    assessStructureRisk({ quantity: fixtureQty, weight: "3.50", totalDiamondWeight: "1.00" }).risks.length === 0,
    "A total below the stone weight raises no weight-relationship risk",
  );

  // =========================================================================
  section("E. Actual versus estimated — never merged");
  // =========================================================================
  const both = resolveTextAttribute("ROUND", "17");
  assert(both.value === "ROUND" && both.provenance === "ACTUAL", "A measured shape wins over an estimate");
  assert(both.estimatedId === "17", "The estimated identifier is preserved separately");
  assert(both.estimatedIdState === "LOOKUP_NOT_CONFIGURED", "Without an approved lookup the identifier stays unresolved");
  assert(both.advisory === false, "A measured value is never advisory");

  const onlyEstimate = resolveTextAttribute(null, "17");
  assert(onlyEstimate.value === null, "A missing measurement is NOT filled from an estimate");
  assert(onlyEstimate.provenance === "NONE", "A missing measurement reports provenance NONE");
  assert(onlyEstimate.actual === null, "The measured field stays null");
  assert(onlyEstimate.estimatedId === "17", "The estimate is still recorded for review");
  assert(onlyEstimate.estimationMethod === "UNKNOWN_PROVIDER_METHOD", "The estimation method is reported as unknown");

  const optedIn = resolveTextAttribute(null, "17", { allowEstimatedFallback: true });
  assert(optedIn.value === null, "Opting in is not enough: an unresolved identifier is still not a grade");
  assert(optedIn.estimatedIdState === "LOOKUP_NOT_CONFIGURED", "The identifier is reported as unresolvable");

  const withLookup = resolveTextAttribute(null, "17", {
    allowEstimatedFallback: true,
    estimatedIdLookup: new Map([["17", "ROUND"]]),
  });
  assert(withLookup.value === "ROUND" && withLookup.provenance === "ESTIMATED", "An approved lookup plus opt-in resolves");
  assert(withLookup.advisory === true, "A resolved estimate is advisory");

  const lookupButMeasured = resolveTextAttribute("PEAR", "17", {
    allowEstimatedFallback: true,
    estimatedIdLookup: new Map([["17", "ROUND"]]),
  });
  assert(lookupButMeasured.value === "PEAR", "Even with a lookup and opt-in, the measurement is not overwritten");

  const unmapped = resolveTextAttribute(null, "999", {
    allowEstimatedFallback: true,
    estimatedIdLookup: new Map([["17", "ROUND"]]),
  });
  assert(unmapped.value === null, "An identifier absent from the lookup produces no value");
  assert(unmapped.estimatedIdState === "LOOKUP_NOT_CONFIGURED", "An unmapped identifier is reported, never guessed");

  const w = resolveWeightAttribute("1.25", "1.40");
  assert(w.value === 1.25 && w.provenance === "ACTUAL", "A measured weight wins over an estimated weight");
  assert(w.divergence === 0.15, "The divergence between the two raw numbers is reported");
  assert(w.estimated.value === 1.4, "The estimated weight is preserved separately");

  const wNoActual = resolveWeightAttribute(null, "1.40");
  assert(wNoActual.value === null, "A missing measured weight is not filled from Est. Weight");
  assert(wNoActual.provenance === "NONE", "A missing measured weight reports provenance NONE");
  assert(wNoActual.divergence === null, "No divergence is computed when only one side parses");

  const wInvalidActual = resolveWeightAttribute("abc", "1.40");
  assert(wInvalidActual.value === null, "An unparseable measured weight is not replaced by the estimate");
  assert(wInvalidActual.actual.reason === "NOT_NUMERIC", "The measured weight records why it was rejected");

  // =========================================================================
  section("F. Shortage protection");
  // =========================================================================
  const measuredSet = resolveMeasurements(
    { shapeRaw: "ROUND", colorRaw: "D", clarityRaw: "VS1", weightRaw: "1.25" },
    FIXTURE_MEASUREMENT_PROFILE,
  );
  assert(measuredSet.containsEstimatedValues === false, "A fully measured set carries no estimates");
  assert(countsTowardConfirmedShortage(measuredSet) === true, "A measured set may count against confirmed shortage");

  const estimatedSet = resolveMeasurements(
    { colorRaw: "D", clarityRaw: "VS1", weightRaw: "1.25", estimatedShapeId: "17" },
    FIXTURE_MEASUREMENT_PROFILE,
    { allowEstimatedFallback: true, estimatedIdLookup: new Map([["17", "ROUND"]]) },
  );
  assert(estimatedSet.containsEstimatedValues === true, "A set containing a resolved estimate is marked");
  assert(countsTowardConfirmedShortage(estimatedSet) === false, "An estimated value cannot reduce confirmed shortage");
  assert(estimatedSet.shape.provenance === "ESTIMATED", "The estimated attribute carries its own provenance");
  assert(estimatedSet.color.provenance === "ACTUAL", "Other attributes keep their own provenance independently");

  const defaultPolicySet = resolveMeasurements(
    { colorRaw: "D", estimatedShapeId: "17" },
    FIXTURE_MEASUREMENT_PROFILE,
  );
  assert(defaultPolicySet.containsEstimatedValues === false, "The default policy promotes nothing");
  assert(defaultPolicySet.missingAttributes.includes("shape"), "A shape with only an estimate is reported missing");
  assert(STRICT_ACTUAL_ONLY.allowEstimatedFallback === false, "The strict policy disallows estimated fallback");

  // =========================================================================
  section("G. Projection identity");
  // =========================================================================
  const id1 = buildProjectionIdentity({ companyId: "CO-1", lotId: "L-1" });
  const id2 = buildProjectionIdentity({ companyId: "CO-1", lotId: "L-1" });
  assert(id1.key !== null && id1.key === id2.key, "Identity is deterministic");
  assert(
    buildProjectionIdentity({ companyId: "CO-2", lotId: "L-1" }).key !== id1.key,
    "The same lot id in a different company is a different identity",
  );
  assert(buildProjectionIdentity({ companyId: null, lotId: "L-1" }).reason === "IDENTITY_COMPANY_ID_MISSING",
    "A missing company id is recorded as a collision risk");
  assert(buildProjectionIdentity({ companyId: "CO-1", lotId: null }).key === null,
    "A row with no lot id has no identity");
  assert(id1.lotId === "L-1", "The legacy lot id is preserved alongside the composed key");
  assert(IDENTITY_POLICY_VERSION === 1, "The identity policy version is recorded");
  // A key built from concatenation must not collide across a boundary shift.
  assert(
    buildProjectionIdentity({ companyId: "CO", lotId: "1L-1" }).key !==
      buildProjectionIdentity({ companyId: "CO1", lotId: "L-1" }).key,
    "The identity separator prevents a boundary-shift collision",
  );


  // =========================================================================
  section("H. Row eligibility — only ACCEPTED_RAW may be projected");
  // =========================================================================
  const stamp = Date.now();
  const rows = [
    fantasyRow({ "Lot ID": "PROJ-A", "Lot Status DB": "STOCK", Weight: "1.25", Shape: "ROUND" }),
    fantasyRow({ "Lot ID": "PROJ-B", "Lot Status DB": "MEMO", Weight: "0.90", Shape: "PEAR" }),
    // No measured shape, only an estimate: must remain missing, never filled.
    fantasyRow({ "Lot ID": "PROJ-C", "Lot Status DB": "STOCK", Shape: null, "Est. Shape ID": "17" }),
    // Unmapped status: must be excluded, never memo.
    fantasyRow({ "Lot ID": "PROJ-D", "Lot Status DB": "BANANA" }),
    // Jewellery indicators.
    fantasyRow({ "Lot ID": "PROJ-E", ItemName: "Diamond Ring", "Metal ID": "18KT", "Metal Wgt": "2.5" }),
    // No lot id at all: ingestion rejects it structurally.
    fantasyRow({ "Lot ID": null }),
  ];

  const ingestion = await ingestFantasyRawBatch(
    {
      contractVersion: FANTASY_ROW_CONTRACT_V1,
      sourceMode: "FIXTURE",
      batchId: `PROJ-TEST-${stamp}`,
      headers: [...FANTASY_V1_HEADERS],
      rows,
      cursor: { kind: "FULL_SNAPSHOT", token: null },
    },
    { mode: "PERSIST", db, provenance: FIXTURE_PROVENANCE },
  );
  assert(ingestion.batchId !== null, "The test batch was ingested");
  const batchId = ingestion.batchId!;

  // The trap this whole section exists for: a row ingestion refused still HAS a
  // normalized record, so it looks projectable.
  const ingestedRows = await db.fantasyRawRow.findMany({
    where: { batchId },
    select: { sourceRowNumber: true, outcome: true, normalizedRecordJson: true },
    orderBy: { sourceRowNumber: "asc" },
  });
  const refusedRow = ingestedRows.find((r) => r.outcome !== "ACCEPTED_RAW");
  assert(refusedRow !== undefined, "The batch contains a row ingestion did not accept");
  assert(
    refusedRow!.normalizedRecordJson !== null,
    "That refused row still carries a normalized record — it would decode cleanly if allowed",
  );

  assert(rowSkipReason("ACCEPTED_RAW") === null, "ACCEPTED_RAW is the only projectable outcome");
  assert(rowSkipReason("QUARANTINED") === "ROW_SKIPPED_QUARANTINED_AT_INGESTION", "QUARANTINED is skipped");
  assert(rowSkipReason("REJECTED_STRUCTURE") === "ROW_SKIPPED_REJECTED_AT_INGESTION", "REJECTED_STRUCTURE is skipped");
  assert(rowSkipReason("SOMETHING_NEW") === "ROW_SKIPPED_OUTCOME_UNRECOGNIZED", "An unknown outcome is skipped, not trusted");

  const shadow = await runProjection({ batchId, mode: "SHADOW", requestedByUserId: null });
  assert(shadow.status === "COMPLETED", "The shadow projection completed");
  assert(shadow.rowsRead === rows.length, `All ${rows.length} rows were read`);
  assert(shadow.idempotentReplay === false, "The first run is not a replay");

  const acceptedCount = ingestedRows.filter((r) => r.outcome === "ACCEPTED_RAW").length;
  const refusedCount = ingestedRows.length - acceptedCount;
  assert(shadow.rowsEligible === acceptedCount, "Only accepted rows were treated as eligible");
  assert(
    shadow.rowsSkippedRejected + shadow.rowsSkippedQuarantined === refusedCount,
    "Every refused row was counted under a fixed skip code",
  );
  assert(refusedCount > 0, "The fixture exercises at least one refused row");

  const candidates = await db.fantasyProjectionCandidate.findMany({
    where: { runId: shadow.runId },
    orderBy: { sourceRowNumber: "asc" },
  });
  assert(candidates.length === acceptedCount, "One candidate per ACCEPTED_RAW row, and none for the others");
  assert(
    !candidates.some((c) => c.sourceRowNumber === refusedRow!.sourceRowNumber),
    "The refused row produced NO candidate at all",
  );
  assert(
    !candidates.some((c) => c.legacyLotId === null),
    "No candidate exists without an identity — the unidentifiable row never entered projection",
  );
  assert(
    shadow.candidatesProjected + shadow.candidatesReviewRequired + shadow.candidatesQuarantined === candidates.length,
    "Persisted candidates and run counters agree exactly",
  );

  const byLot = new Map(candidates.map((c) => [c.legacyLotId, c]));
  const a = byLot.get("PROJ-A")!;

  // A raw provider row carries no hold value this build can interpret: the fixture
  // profile maps only the application's own adapter sentinel, and that sentinel is
  // refused when it arrives on a source row. So hold is UNKNOWN, and the classifier
  // blocks before the status is ever consulted.
  assert(a.holdState === "UNKNOWN", "A raw row with no On Hold value has UNKNOWN hold");
  assert(a.classificationState === "BLOCKED", "Unknown hold blocks classification");
  assert(a.inventoryClass === "EXCLUDED", "A blocked row is excluded, never available");
  assert(a.classificationAvailable === false, "A blocked row is not available");
  assert((a.classificationReasons ?? "").includes("HOLD_MISSING"), "The blocking reason is recorded as a fixed code");
  assert(a.candidateState === "QUARANTINED", "A row that cannot be classified is quarantined");

  // Measurement, quantity and weight handling is independent of classification.
  assert(a.actualShape === "ROUND" && a.shapeProvenance === "ACTUAL", "A measured shape is stored with ACTUAL provenance");
  assert(a.actualWeight !== null && Number(a.actualWeight) === 1.25, "The measured weight is stored");
  assert(a.quantityState === "USABLE" && a.quantityPieces === 1, "A fixture quantity of 1 is usable");
  assert(a.weightUnit === "CARAT", "The fixture weight unit is recorded on the candidate");
  assert(a.lotStatusRaw === "STOCK", "The raw status is preserved for review");

  const c = byLot.get("PROJ-C")!;
  assert(c.actualShape === null, "A row with only an estimated shape stores no measured shape");
  assert(c.estimatedShapeId === "17", "The estimated shape identifier is stored separately");
  assert(c.shapeProvenance === "NONE", "The shape provenance is NONE, not ESTIMATED");
  assert(c.estimatedShapeIdState === "LOOKUP_NOT_CONFIGURED", "The identifier is stored as unresolved");
  assert(c.containsEstimatedValues === false, "Projection promoted no estimate");

  const d = byLot.get("PROJ-D")!;
  assert(d.inventoryClass === "EXCLUDED", "An unmapped status is excluded");
  assert(d.inventoryClass !== "MEMO", "An unmapped status never falls through to memo");

  const e = byLot.get("PROJ-E")!;
  assert(e.structureReviewRequired === true, "A jewellery-shaped row is flagged for review");
  assert((e.structureRiskCodes ?? "").includes("METAL_IDENTIFIER_PRESENT"), "The structure risk codes are recorded");

  assert(
    candidates.every((x) => x.identityPolicyVersion === IDENTITY_POLICY_VERSION),
    "Every candidate records the identity policy version",
  );
  assert(!Object.keys(candidates[0]).some((k) => /remark/i.test(k)), "The candidate model carries no Remark column");

  // =========================================================================
  section("H1. Idempotency, replay and concurrency");
  // =========================================================================
  assert(typeof shadow.fingerprint === "string" && shadow.fingerprint.length === 64, "A run records a SHA-256 fingerprint");

  const fp1 = projectionFingerprint(FINGERPRINT_BASE);
  const fp2 = projectionFingerprint({ ...FINGERPRINT_BASE });
  assert(fp1 === fp2, "The fingerprint is deterministic for identical inputs");

  for (const [field, value] of [
    ["batchHash", "different-hash"],
    ["mode", "DRY_RUN"],
    ["contractVersion", "OTHER"],
    ["encodingVersion", "OTHER"],
    ["effectiveSourceState", "LIVE_FANTASY"],
    ["classificationProfile", "OTHER"],
    ["classificationProfileVersion", 99],
    ["identityPolicyVersion", 99],
    ["measurementPolicy", "PERMISSIVE"],
    ["quantitySemantics", "NOT_CONFIGURED"],
    ["weightUnit", "UNIT_NOT_CONFIGURED"],
  ] as Array<[string, unknown]>) {
    const altered = projectionFingerprint({ ...FINGERPRINT_BASE, [field]: value } as typeof FINGERPRINT_BASE);
    assert(altered !== fp1, `Changing ${field} changes the fingerprint`);
  }

  const replay = await runProjection({ batchId, mode: "SHADOW", requestedByUserId: null });
  assert(replay.idempotentReplay === true, "An identical completed run replays instead of re-running");
  assert(replay.runId === shadow.runId, "The replay returns the original run, not a new one");
  assert(replay.candidatesQuarantined === shadow.candidatesQuarantined, "The replay reports the original counts");

  const runCount = await db.fantasyProjectionRun.count({
    where: { sourceBatchId: batchId, mode: "SHADOW" },
  });
  assert(runCount === 1, "A second identical request created NO second run");

  const candidateCountAfterReplay = await db.fantasyProjectionCandidate.count({ where: { runId: shadow.runId } });
  assert(candidateCountAfterReplay === candidates.length, "The replay wrote no duplicate candidates");

  // Two genuinely overlapping requests. Without a database-enforced claim, both would
  // observe "no existing run" and both would insert.
  const overlappingBatch = await ingestFantasyRawBatch(
    {
      contractVersion: FANTASY_ROW_CONTRACT_V1,
      sourceMode: "FIXTURE",
      batchId: `PROJ-RACE-${stamp}`,
      headers: [...FANTASY_V1_HEADERS],
      rows: [fantasyRow({ "Lot ID": "RACE-1" }), fantasyRow({ "Lot ID": "RACE-2" })],
      cursor: { kind: "FULL_SNAPSHOT", token: null },
    },
    { mode: "PERSIST", db, provenance: FIXTURE_PROVENANCE },
  );

  const raced = await Promise.allSettled([
    runProjection({ batchId: overlappingBatch.batchId!, mode: "SHADOW", requestedByUserId: null }),
    runProjection({ batchId: overlappingBatch.batchId!, mode: "SHADOW", requestedByUserId: null }),
  ]);
  const fulfilled = raced.filter((r) => r.status === "fulfilled");
  const racedRuns = await db.fantasyProjectionRun.count({
    where: { sourceBatchId: overlappingBatch.batchId!, mode: "SHADOW" },
  });
  assert(racedRuns === 1, "Two overlapping identical requests produced exactly ONE run");
  assert(fulfilled.length >= 1, "At least one of the overlapping requests succeeded");
  const rejectedRace = raced.find((r) => r.status === "rejected");
  if (rejectedRace && rejectedRace.status === "rejected") {
    const err = rejectedRace.reason;
    assert(
      err instanceof ProjectionError && err.code === "PROJECTION_ALREADY_RUNNING",
      "The losing request was refused with a fixed conflict code",
    );
  } else {
    // Both completed: one ran, the other replayed. Equally correct.
    assert(
      fulfilled.some((r) => r.status === "fulfilled" && r.value.idempotentReplay === true),
      "When both requests succeed, exactly one of them is a replay",
    );
  }
  const racedCandidates = await db.fantasyProjectionCandidate.count({
    where: { run: { sourceBatchId: overlappingBatch.batchId! } },
  });
  assert(racedCandidates === 2, "The race wrote each row's candidate exactly once");

  // A DRY_RUN has a different fingerprint, so it is a separate run that stores nothing.
  const dry = await runProjection({ batchId, mode: "DRY_RUN", requestedByUserId: null });
  assert(dry.persisted === false, "A dry run reports that nothing was persisted");
  assert(dry.runId !== shadow.runId, "A dry run is a distinct run from the shadow run");
  assert(dry.rowsRead === shadow.rowsRead, "A dry run reads the same rows");
  assert(dry.rowsEligible === shadow.rowsEligible, "A dry run applies the same eligibility filter");
  assert(dry.candidatesProjected === shadow.candidatesProjected, "A dry run computes the same projected count");
  assert((await db.fantasyProjectionCandidate.count({ where: { runId: dry.runId } })) === 0, "A dry run wrote no candidates");

  // =========================================================================
  section("H3. Multi-page processing — every row exactly once");
  // =========================================================================
  // More rows than one page, so the keyset cursor is genuinely exercised at a boundary.
  const bigRowCount = PROJECTION_PAGE_SIZE + 37;
  const bigRows = Array.from({ length: bigRowCount }, (_, i) =>
    fantasyRow({ "Lot ID": `PAGE-${String(i + 1).padStart(5, "0")}`, "Lot Status DB": "STOCK" }),
  );
  const bigBatch = await ingestFantasyRawBatch(
    {
      contractVersion: FANTASY_ROW_CONTRACT_V1,
      sourceMode: "FIXTURE",
      batchId: `PROJ-PAGES-${stamp}`,
      headers: [...FANTASY_V1_HEADERS],
      rows: bigRows,
      cursor: { kind: "FULL_SNAPSHOT", token: null },
    },
    { mode: "PERSIST", db, provenance: FIXTURE_PROVENANCE },
  );
  assert(bigRowCount > PROJECTION_PAGE_SIZE, "The paging fixture spans more than one page");

  const bigRun = await runProjection({ batchId: bigBatch.batchId!, mode: "SHADOW", requestedByUserId: null });
  assert(bigRun.rowsRead === bigRowCount, `All ${bigRowCount} rows were read across pages`);
  assert(bigRun.rowsEligible === bigRowCount, "Every row was eligible");

  const bigNumbers = await db.fantasyProjectionCandidate.findMany({
    where: { runId: bigRun.runId },
    select: { sourceRowNumber: true },
    orderBy: { sourceRowNumber: "asc" },
  });
  assert(bigNumbers.length === bigRowCount, "Exactly one candidate per row — no omissions");
  const distinct = new Set(bigNumbers.map((r) => r.sourceRowNumber));
  assert(distinct.size === bigRowCount, "No source row was processed twice");
  assert(bigNumbers[0].sourceRowNumber === 1, "The first row was not skipped");
  assert(bigNumbers[bigNumbers.length - 1].sourceRowNumber === bigRowCount, "The last row was not skipped");
  let contiguous = true;
  for (let i = 0; i < bigNumbers.length; i++) {
    if (bigNumbers[i].sourceRowNumber !== i + 1) contiguous = false;
  }
  assert(contiguous, "Row numbers are contiguous — no gap at any page boundary");

  // =========================================================================
  section("H4. Batch status and provenance gating");
  // =========================================================================
  assert(decideProjectionEligibility({ ...ELIGIBLE_INPUT, batchStatus: "REJECTED" }).code === "BATCH_STATUS_REJECTED",
    "A REJECTED batch is refused");
  assert(decideProjectionEligibility({ ...ELIGIBLE_INPUT, batchStatus: "CONFLICT" }).code === "BATCH_STATUS_CONFLICT",
    "A CONFLICT batch is refused — which of the two is authoritative is unanswered");
  assert(decideProjectionEligibility({ ...ELIGIBLE_INPUT, batchStatus: "SOMETHING_ELSE" }).code === "BATCH_STATUS_NOT_PROJECTABLE",
    "An unrecognized batch status is refused by default");
  assert(decideProjectionEligibility({ ...ELIGIBLE_INPUT, batchStatus: "ACCEPTED_WITH_ISSUES" }).eligible,
    "ACCEPTED_WITH_ISSUES is eligible at batch level; its bad rows are filtered per row");

  assert(
    decideProjectionEligibility({ ...ELIGIBLE_INPUT, effectiveSourceStateAtIngestion: null }).code ===
      "SOURCE_PROVENANCE_NOT_CONFIGURED",
    "A batch with no recorded provenance fails closed",
  );
  assert(
    decideProjectionEligibility({ ...ELIGIBLE_INPUT, effectiveSourceStateAtIngestion: "NONSENSE" }).code ===
      "SOURCE_PROVENANCE_NOT_CONFIGURED",
    "An unrecognized provenance value fails closed",
  );
  assert(
    decideProjectionEligibility({ ...ELIGIBLE_INPUT, effectiveSourceStateAtIngestion: "LIVE_FANTASY" }).code ===
      "SOURCE_PROVENANCE_MISMATCH",
    "A FIXTURE batch claiming live provenance is refused",
  );
  assert(
    decideProjectionEligibility({
      ...ELIGIBLE_INPUT,
      batchSourceMode: "FANTASY_API",
      effectiveSourceStateAtIngestion: "FIXTURE_SIMULATION",
    }).code === "SOURCE_PROVENANCE_MISMATCH",
    "A FANTASY_API batch claiming fixture provenance is refused",
  );
  assert(
    decideProjectionEligibility({ ...ELIGIBLE_INPUT, batchSourceMode: "FILE_IMPORT" }).code === "SOURCE_MODE_NOT_SUPPORTED",
    "FILE_IMPORT is not a supported projection source",
  );
  assert(
    decideProjectionEligibility({ ...ELIGIBLE_INPUT, batchSourceMode: "SOMETHING" }).code === "SOURCE_MODE_NOT_SUPPORTED",
    "An unknown source mode is refused",
  );

  // The rule that matters most: live data must never meet the simulation profile.
  const liveWithSimProfile = decideProjectionEligibility({
    batchStatus: "ACCEPTED",
    batchSourceMode: "FANTASY_API",
    effectiveSourceStateAtIngestion: "LIVE_FANTASY",
    providerIdAtIngestion: "some-provider",
    profile: classificationProfile,
  });
  assert(liveWithSimProfile.eligible === false, "A live batch is not eligible under a simulation-only profile");
  assert(
    liveWithSimProfile.code === "CLASSIFICATION_PROFILE_NOT_APPLICABLE",
    "It is refused specifically because the profile does not apply to live data",
  );
  assert(
    decideProjectionEligibility({
      batchStatus: "ACCEPTED",
      batchSourceMode: "FANTASY_API",
      effectiveSourceStateAtIngestion: "LIVE_FANTASY",
      providerIdAtIngestion: null,
      profile: null,
    }).code === "CLASSIFICATION_PROFILE_NOT_AVAILABLE_FOR_SOURCE",
    "With no live profile installed, a live batch is refused rather than left unclassified",
  );
  assert(
    decideProjectionEligibility({ ...ELIGIBLE_INPUT, profile: { ...classificationProfile, isActive: false } }).code ===
      "CLASSIFICATION_PROFILE_INACTIVE",
    "An inactive profile is refused",
  );
  assert(decideProjectionEligibility(ELIGIBLE_INPUT).eligible, "A coherent fixture batch is eligible");

  // Now prove the service honours it, not just the decision function.
  const legacyBatchId = (
    await db.fantasyRawBatch.findFirstOrThrow({ where: { id: batchId }, select: { id: true } })
  ).id;
  await db.fantasyRawBatch.update({
    where: { id: legacyBatchId },
    data: { effectiveSourceStateAtIngestion: null },
  });
  let provenanceRefused = "";
  try {
    await runProjection({ batchId: legacyBatchId, mode: "DRY_RUN", requestedByUserId: null });
  } catch (error) {
    provenanceRefused = error instanceof ProjectionError ? error.code : "WRONG_ERROR";
  }
  assert(provenanceRefused === "SOURCE_PROVENANCE_NOT_CONFIGURED", "The service refuses a batch with no provenance");
  await db.fantasyRawBatch.update({
    where: { id: legacyBatchId },
    data: { effectiveSourceStateAtIngestion: "FIXTURE_SIMULATION" },
  });

  await db.fantasyRawBatch.update({ where: { id: legacyBatchId }, data: { status: "CONFLICT" } });
  let conflictRefused = "";
  try {
    await runProjection({ batchId: legacyBatchId, mode: "DRY_RUN", requestedByUserId: null });
  } catch (error) {
    conflictRefused = error instanceof ProjectionError ? error.code : "WRONG_ERROR";
  }
  assert(conflictRefused === "BATCH_STATUS_CONFLICT", "The service refuses a CONFLICT batch");

  await db.fantasyRawBatch.update({ where: { id: legacyBatchId }, data: { status: "REJECTED" } });
  let rejectedRefused = "";
  try {
    await runProjection({ batchId: legacyBatchId, mode: "DRY_RUN", requestedByUserId: null });
  } catch (error) {
    rejectedRefused = error instanceof ProjectionError ? error.code : "WRONG_ERROR";
  }
  assert(rejectedRefused === "BATCH_STATUS_REJECTED", "The service refuses a REJECTED batch");
  await db.fantasyRawBatch.update({ where: { id: legacyBatchId }, data: { status: "ACCEPTED" } });

  let missingBatch = "";
  try {
    await runProjection({ batchId: "does-not-exist", mode: "DRY_RUN", requestedByUserId: null });
  } catch (error) {
    missingBatch = error instanceof ProjectionError ? error.code : "WRONG_ERROR";
  }
  assert(missingBatch === "BATCH_NOT_FOUND", "A missing batch is refused with a fixed code");
  section("H2. The classifiable path, once a hold value is mapped");
  // =========================================================================
  // The run above is blocked purely because no source hold value is mapped. To prove the
  // rest of the projection is correct rather than merely blocked, `projectRow` is
  // exercised directly against a profile that does map one. `projectRow` is pure, so
  // this exercises the real assembly with no database write.
  const profileWithHold = {
    ...classificationProfile,
    holdMappings: [
      ...classificationProfile.holdMappings,
      { sourceValue: "N", holdState: "NOT_HELD", isActive: true },
      { sourceValue: "Y", holdState: "HELD", isActive: true },
    ],
  };
  const ctx = {
    runId: "test-run",
    batchId: "test-batch",
    classificationProfile: profileWithHold,
    measurementProfile: FIXTURE_MEASUREMENT_PROFILE,
    effectiveSourceState: "FIXTURE_SIMULATION" as const,
  };
  const rowMeta = { sourceRowNumber: 1, id: "row-1", rowHash: "hash-1" };

  const stockRow = projectRow(
    { lotId: "H2-A", companyId: "CO-1", lotStatusRaw: "STOCK", onHoldRaw: "N", shapeRaw: "ROUND", weightRaw: "1.25", quantityRaw: "1" },
    rowMeta,
    ctx,
  );
  assert(stockRow.data.holdState === "NOT_HELD", "A mapped hold value resolves to NOT_HELD");
  assert(stockRow.data.inventoryClass === "PHYSICAL_AVAILABLE", "A STOCK row with a mapped hold is physically available");
  assert(stockRow.data.classificationAvailable === true, "That row is available");
  assert(stockRow.candidateState === "PROJECTED", "A fully classifiable row needs no review");
  assert(stockRow.reasonCodes.length === 0, "A fully classifiable row records no reason codes");
  assert(stockRow.data.eligibleForConfirmedShortage === true, "A measured, available row may count against shortage");

  const memoRow = projectRow(
    { lotId: "H2-B", companyId: "CO-1", lotStatusRaw: "MEMO", onHoldRaw: "N", shapeRaw: "PEAR", weightRaw: "0.90", quantityRaw: "1" },
    rowMeta,
    ctx,
  );
  assert(memoRow.data.inventoryClass === "MEMO", "A MEMO row with a mapped hold is memo");
  assert(memoRow.data.classificationAvailable === false, "A memo row is never available");
  assert(memoRow.data.eligibleForConfirmedShortage === false, "A memo row cannot count against shortage");

  const heldRow = projectRow(
    { lotId: "H2-C", companyId: "CO-1", lotStatusRaw: "STOCK", onHoldRaw: "Y", shapeRaw: "ROUND", weightRaw: "1.25", quantityRaw: "1" },
    rowMeta,
    ctx,
  );
  assert(heldRow.data.holdState === "HELD", "An active hold resolves to HELD");
  assert(heldRow.data.inventoryClass === "EXCLUDED", "A held STOCK row is excluded despite its status");
  assert(heldRow.data.classificationAvailable === false, "A held row is never available");

  const estimatedOnlyRow = projectRow(
    { lotId: "H2-D", companyId: "CO-1", lotStatusRaw: "STOCK", onHoldRaw: "N", shapeRaw: null, estimatedShapeId: "17", weightRaw: "1.25", quantityRaw: "1" },
    rowMeta,
    ctx,
  );
  assert(estimatedOnlyRow.data.actualShape === null, "An estimate never fills the measured shape, even when classifiable");
  assert(estimatedOnlyRow.data.shapeProvenance === "NONE", "Provenance stays NONE");
  assert(estimatedOnlyRow.data.estimatedShapeId === "17", "The estimate is still carried");

  const unsupportedQtyRow = projectRow(
    { lotId: "H2-E", companyId: "CO-1", lotStatusRaw: "STOCK", onHoldRaw: "N", shapeRaw: "ROUND", weightRaw: "1.25", quantityRaw: "5" },
    rowMeta,
    ctx,
  );
  assert(unsupportedQtyRow.data.quantityState === "UNSUPPORTED_VALUE", "A multi-piece quantity is unsupported");
  assert(unsupportedQtyRow.data.quantityPieces === null, "No piece count is derived from an unsupported quantity");
  assert(unsupportedQtyRow.candidateState === "REVIEW_REQUIRED", "It is projected for review, not silently accepted");
  assert(unsupportedQtyRow.data.structureReviewRequired === true, "A quantity above one also raises a structure risk");

  // =========================================================================

  // =========================================================================
  section("I. ACTIVE projection is impossible");
  // =========================================================================
  assert(!(PROJECTION_MODES as readonly string[]).includes("ACTIVE"), "ACTIVE is not in the mode vocabulary");
  assert(isProjectionMode("ACTIVE") === false, "ACTIVE is rejected by the mode guard");

  let dbRefusedActive = false;
  try {
    await db.$executeRawUnsafe(
      `INSERT INTO "FantasyProjectionRun" ("id","mode","status","fingerprint","contractVersion","effectiveSourceState","identityPolicyVersion","quantitySemantics","weightUnit","startedAt","createdAt")
       VALUES ('active-probe-${stamp}','ACTIVE','RUNNING','probe-${stamp}','${FANTASY_ROW_CONTRACT_V1}','FIXTURE_SIMULATION',1,'PIECE_COUNT','CARAT',NOW(),NOW())`,
    );
  } catch {
    dbRefusedActive = true;
  }
  assert(dbRefusedActive, "The DATABASE refuses an ACTIVE run, not merely the application");
  assert((await db.fantasyProjectionRun.count({ where: { mode: "ACTIVE" } })) === 0, "No ACTIVE run exists");

  // =========================================================================
  section("I2. Candidate immutability is enforced by the database");
  // =========================================================================
  const probeCandidate = candidates[0];

  let updateRefused = false;
  try {
    await db.$executeRawUnsafe(
      `UPDATE "FantasyProjectionCandidate" SET "actualShape" = 'TAMPERED' WHERE "id" = '${probeCandidate.id}'`,
    );
  } catch {
    updateRefused = true;
  }
  assert(updateRefused, "A direct SQL UPDATE of a candidate is rejected by the database");

  let deleteRefused = false;
  try {
    await db.$executeRawUnsafe(`DELETE FROM "FantasyProjectionCandidate" WHERE "id" = '${probeCandidate.id}'`);
  } catch {
    deleteRefused = true;
  }
  assert(deleteRefused, "A direct SQL DELETE of a candidate is rejected by the database");

  const unchanged = await db.fantasyProjectionCandidate.findUnique({
    where: { id: probeCandidate.id },
    select: { actualShape: true },
  });
  assert(unchanged !== null, "The candidate still exists after the delete attempt");
  assert(unchanged!.actualShape === probeCandidate.actualShape, "The candidate's value is unchanged after the update attempt");

  let ormUpdateRefused = false;
  try {
    await db.fantasyProjectionCandidate.update({
      where: { id: probeCandidate.id },
      data: { actualShape: "TAMPERED" },
    });
  } catch {
    ormUpdateRefused = true;
  }
  assert(ormUpdateRefused, "An ORM update of a candidate is rejected by the same database trigger");

  // The parent run must still be able to close itself out.
  const runStatusBefore = await db.fantasyProjectionRun.findUniqueOrThrow({
    where: { id: dry.runId },
    select: { status: true },
  });
  assert(runStatusBefore.status === "COMPLETED", "The run reached COMPLETED — the controlled transition still works");

  let badStateRefused = false;
  try {
    await db.$executeRawUnsafe(
      `INSERT INTO "FantasyProjectionCandidate" ("id","runId","sourceRowNumber","rowHash","projectionIdentityKey","identityPolicyVersion","quantityState","quantitySemantics","weightUnit","candidateState","createdAt")
       VALUES ('bad-state-${stamp}','${shadow.runId}',999999,'h','k',1,'MISSING','PIECE_COUNT','CARAT','PROMOTED',NOW())`,
    );
  } catch {
    badStateRefused = true;
  }
  assert(badStateRefused, "The database refuses an unknown candidate state such as PROMOTED");

  // =========================================================================
  section("I3. Lineage retention — raw evidence cannot be deleted");
  // =========================================================================
  const citedRow = await db.fantasyProjectionCandidate.findFirstOrThrow({
    where: { runId: shadow.runId, sourceRowId: { not: null } },
    select: { sourceRowId: true },
  });

  let rawRowDeleteRefused = false;
  try {
    await db.$executeRawUnsafe(`DELETE FROM "FantasyRawRow" WHERE "id" = '${citedRow.sourceRowId}'`);
  } catch {
    rawRowDeleteRefused = true;
  }
  assert(rawRowDeleteRefused, "A raw row cited by a candidate cannot be deleted");
  assert(
    (await db.fantasyRawRow.count({ where: { id: citedRow.sourceRowId! } })) === 1,
    "The cited raw row still exists",
  );

  let rawBatchDeleteRefused = false;
  try {
    await db.$executeRawUnsafe(`DELETE FROM "FantasyRawBatch" WHERE "id" = '${batchId}'`);
  } catch {
    rawBatchDeleteRefused = true;
  }
  assert(rawBatchDeleteRefused, "A raw batch a projection run cites cannot be deleted");

  let runDeleteRefused = false;
  try {
    await db.$executeRawUnsafe(`DELETE FROM "FantasyProjectionRun" WHERE "id" = '${shadow.runId}'`);
  } catch {
    runDeleteRefused = true;
  }
  assert(runDeleteRefused, "A run does NOT cascade-delete its candidates — the delete is refused");
  assert(
    (await db.fantasyProjectionCandidate.count({ where: { runId: shadow.runId } })) === candidates.length,
    "Every candidate survived the attempted run deletion",
  );

  // No delete endpoint exists in this phase.
  const apiFiles = walk(path.join(REPO, "src", "app", "api"));
  const projectionDeleteRoutes = apiFiles.filter(
    (f) => /projection/.test(f) && /export const DELETE/.test(codeOf(f)),
  );
  assert(projectionDeleteRoutes.length === 0, "No projection delete endpoint exists");

  // =========================================================================
  section("J. Structural isolation from the canonical records");
  // =========================================================================
  const schema = readFileSync(path.join(REPO, "prisma", "schema.prisma"), "utf8");
  const masterBlock = schema.slice(
    schema.indexOf("model LotMasterRecord {"),
    schema.indexOf("model LotHistoryRecord {"),
  );
  assert(!masterBlock.includes("FantasyProjection"), "LotMasterRecord has no relation to a projection table");
  const historyStart = schema.indexOf("model LotHistoryRecord {");
  const historyBlock = schema.slice(historyStart, schema.indexOf("}", schema.indexOf("@@index", historyStart)));
  assert(!historyBlock.includes("FantasyProjection"), "LotHistoryRecord has no relation to a projection table");

  const projectionSource = codeOf(path.join(REPO, "src", "lib", "fantasy", "projection.ts"));
  assert(!/lotMasterRecord\s*\./.test(projectionSource), "Projection never touches LotMasterRecord at all");
  assert(!/lotHistoryRecord\s*\./.test(projectionSource), "Projection never touches LotHistoryRecord at all");
  assert(!/demandMetric\s*\.|requirement\s*\./.test(projectionSource), "Projection never touches demand or requirements");
  assert(!/syncCheckpoint\s*\.|integrationSyncRun\s*\./.test(projectionSource),
    "Projection never advances the operational Fantasy checkpoint");

  const reconciliationSource = codeOf(path.join(REPO, "src", "lib", "fantasy", "projection-reconciliation.ts"));
  assert(
    !/lotMasterRecord\s*\.\s*(create|update|upsert|delete|createMany|updateMany|deleteMany)/.test(reconciliationSource),
    "Reconciliation never writes a canonical record",
  );
  assert(
    !/fantasyProjectionCandidate\s*\.\s*(update|upsert|delete)/.test(reconciliationSource),
    "Reconciliation never mutates a candidate",
  );

  const appFiles = [
    ...walk(path.join(REPO, "src")),
    ...walk(path.join(REPO, "scripts")).filter((f) => !f.endsWith("test-fantasy-projection.ts")),
  ];
  const mutators = appFiles.filter((f) =>
    /fantasyProjectionCandidate\s*\.\s*(update|updateMany|upsert|delete|deleteMany)/.test(codeOf(f)),
  );
  assert(mutators.length === 0, `No application code mutates a projection candidate (found ${mutators.length})`);

  // Operational consumers must not read projection tables.
  const operationalModules = [
    path.join(REPO, "src", "lib", "demand", "demand-service.ts"),
    path.join(REPO, "src", "lib", "fantasy", "sync-service.ts"),
  ];
  for (const file of operationalModules) {
    const src = codeOf(file);
    assert(
      !/fantasyProjection(Run|Candidate)/.test(src),
      `${path.basename(file)} does not read or write projection tables`,
    );
  }

  // Nothing operational moved while projection ran.
  const canonicalBefore = await db.lotMasterRecord.count();
  const historyBefore = await db.lotHistoryRecord.count();
  const checkpointBefore = await db.syncCheckpoint.count();
  const demandBefore = await db.demandMetric.count();
  const requirementBefore = await db.requirement.count();
  await runProjection({ batchId: bigBatch.batchId!, mode: "DRY_RUN", requestedByUserId: null });
  assert((await db.lotMasterRecord.count()) === canonicalBefore, "A projection run changed no canonical record count");
  assert((await db.lotHistoryRecord.count()) === historyBefore, "A projection run changed no history record count");
  assert((await db.syncCheckpoint.count()) === checkpointBefore, "A projection run advanced no sync checkpoint");

  // =========================================================================
  section("K. Reconciliation");
  // =========================================================================
  const recon = await reconcileProjectionRun(shadow.runId);
  assert(recon.candidatesTotal === candidates.length, "Reconciliation reports the run's real candidate total");
  assert(recon.candidatesCompared === candidates.length, "Reconciliation compared every candidate");
  assert(recon.candidatesNotCompared === 0, "Nothing was left uncompared");
  assert(recon.complete === true, "Reconciliation reports completeness explicitly");
  assert(recon.ceilingReached === false, "The ceiling was not reached");
  assert(recon.ceiling === RECONCILIATION_MAX_CANDIDATES, "The configured ceiling is always reported");
  assert(recon.activationBlockedReason === ACTIVATION_BLOCKED_REASON, "Reconciliation still reports activation blocked");
  assert(recon.matched + recon.differing === recon.candidatesCompared, "Every compared candidate is accounted for once");
  assert(recon.differenceCounts.CANDIDATE_QUARANTINED >= 1, "A quarantined candidate is a difference, not a match");

  const reconJson = JSON.stringify(recon);
  for (const leaked of ["PROJ-A", "BANANA", "Diamond Ring", "18KT", "ROUND", "STOCK"]) {
    assert(!reconJson.includes(leaked), `Reconciliation output does not leak the source value "${leaked}"`);
  }

  // A multi-page reconciliation must also count every candidate exactly once.
  const bigRecon = await reconcileProjectionRun(bigRun.runId);
  assert(bigRecon.candidatesTotal === bigRowCount, "A multi-page run reports its full total");
  assert(bigRecon.candidatesCompared === bigRowCount, "Every candidate across pages was compared exactly once");
  assert(bigRecon.complete === true, "The multi-page reconciliation is complete");
  assert(bigRecon.matched + bigRecon.differing === bigRowCount, "No candidate was double-counted across a page boundary");

  // The ceiling must report the real total and remainder, not the cutoff position.
  const capped = await reconcileProjectionRun(bigRun.runId, { maxCandidates: 10 });
  assert(capped.ceiling === 10, "The effective ceiling is reported");
  assert(capped.ceilingReached === true, "Reaching the ceiling is reported explicitly");
  assert(capped.complete === false, "A ceiling-truncated reconciliation is NOT complete");
  assert(capped.candidatesCompared === 10, "Only the ceiling's worth of candidates was compared");
  assert(capped.candidatesTotal === bigRowCount, "The REAL total is reported, not the cutoff position");
  assert(capped.candidatesNotCompared === bigRowCount - 10, "The remaining count is reported");

  let dryRefused = "";
  try {
    await reconcileProjectionRun(dry.runId);
  } catch (error) {
    dryRefused = error instanceof ReconciliationError ? error.code : "WRONG_ERROR";
  }
  assert(dryRefused === "RUN_NOT_COMPARABLE", "A dry run cannot be reconciled: it stored no candidates");

  let missingRefused = "";
  try {
    await reconcileProjectionRun("does-not-exist");
  } catch (error) {
    missingRefused = error instanceof ReconciliationError ? error.code : "WRONG_ERROR";
  }
  assert(missingRefused === "RUN_NOT_FOUND", "An unknown run id is refused with a fixed code");

  // A RUNNING run is still writing; a FAILED one wrote an unknown subset.
  await db.fantasyProjectionRun.update({ where: { id: bigRun.runId }, data: { status: "RUNNING" } });
  let runningRefused = "";
  try {
    await reconcileProjectionRun(bigRun.runId);
  } catch (error) {
    runningRefused = error instanceof ReconciliationError ? error.code : "WRONG_ERROR";
  }
  assert(runningRefused === "RUN_STILL_RUNNING", "A RUNNING run cannot be reconciled");

  await db.fantasyProjectionRun.update({ where: { id: bigRun.runId }, data: { status: "FAILED" } });
  let failedRefused = "";
  try {
    await reconcileProjectionRun(bigRun.runId);
  } catch (error) {
    failedRefused = error instanceof ReconciliationError ? error.code : "WRONG_ERROR";
  }
  assert(failedRefused === "RUN_NOT_SUCCESSFUL", "A FAILED run cannot be reconciled");

  // Reached through the real abort service rather than a forced status write: the
  // database now refuses an ABORTED row with no actor, timestamp or reason.
  const abortProbe = await db.fantasyProjectionRun.findUniqueOrThrow({
    where: { id: bigRun.runId },
    select: { version: true },
  });
  await db.fantasyProjectionRun.update({
    where: { id: bigRun.runId },
    data: { status: "RUNNING", completedAt: null },
  });
  await abortProjectionAttempt(
    {
      runId: bigRun.runId,
      expectedVersion: abortProbe.version,
      actorUserId: "test-operator",
      reasonCode: "OPERATOR_REQUESTED",
      note: null,
    },
    async () => {},
  );
  let abortedRefused = "";
  try {
    await reconcileProjectionRun(bigRun.runId);
  } catch (error) {
    abortedRefused = error instanceof ReconciliationError ? error.code : "WRONG_ERROR";
  }
  assert(abortedRefused === "RUN_NOT_SUCCESSFUL", "An ABORTED run cannot be reconciled");

  let unattributedAbortRefused = false;
  try {
    await db.$executeRawUnsafe(
      `UPDATE "FantasyProjectionRun" SET "status" = 'ABORTED', "abortReasonCode" = NULL WHERE "id" = '${shadow.runId}'`,
    );
  } catch {
    unattributedAbortRefused = true;
  }
  assert(unattributedAbortRefused, "The database refuses an ABORTED attempt with no reason or timestamp");

  await db.fantasyProjectionRun.update({
    where: { id: bigRun.runId },
    data: { status: "COMPLETED", completedAt: new Date(), abortedAt: null, abortReasonCode: null, abortedByUserId: null },
  });

  const reconCanonicalBefore = await db.lotMasterRecord.count();
  const reconCandidatesBefore = await db.fantasyProjectionCandidate.count({ where: { runId: shadow.runId } });
  await reconcileProjectionRun(shadow.runId);
  assert((await db.lotMasterRecord.count()) === reconCanonicalBefore, "Reconciliation created no canonical record");
  assert(
    (await db.fantasyProjectionCandidate.count({ where: { runId: shadow.runId } })) === reconCandidatesBefore,
    "Reconciliation created or removed no candidate",
  );

  // =========================================================================
  section("K2. Failed runs leave no half-finished claim");
  // =========================================================================
  const failBatch = await ingestFantasyRawBatch(
    {
      contractVersion: FANTASY_ROW_CONTRACT_V1,
      sourceMode: "FIXTURE",
      batchId: `PROJ-FAIL-${stamp}`,
      headers: [...FANTASY_V1_HEADERS],
      rows: [fantasyRow({ "Lot ID": "FAIL-1" })],
      cursor: { kind: "FULL_SNAPSHOT", token: null },
    },
    { mode: "PERSIST", db, provenance: FIXTURE_PROVENANCE },
  );
  const failRun = await runProjection({ batchId: failBatch.batchId!, mode: "SHADOW", requestedByUserId: null });
  const failRunCandidates = await db.fantasyProjectionCandidate.count({ where: { runId: failRun.runId } });
  await db.fantasyProjectionRun.update({
    where: { id: failRun.runId },
    data: { status: "FAILED", terminalReasonCode: "EXECUTION_ERROR", ownerTokenHash: null, completedAt: new Date() },
  });

  // The defect the attempt model fixes: an unsuccessful run must not permanently block
  // its own work, and the escape must not be to alter an input so the work hashes
  // differently — that would falsify what the operation is.
  const retryAfterFailure = await runProjection({
    batchId: failBatch.batchId!,
    mode: "SHADOW",
    requestedByUserId: null,
  });
  assert(retryAfterFailure.attemptNumber === 2, "A failed attempt is retryable as the next attempt");
  assert(
    retryAfterFailure.fingerprint === failRun.fingerprint,
    "The retry runs under the SAME fingerprint — the work's identity is unchanged",
  );
  assert(
    (await db.fantasyProjectionCandidate.count({ where: { runId: failRun.runId } })) === failRunCandidates,
    "The failed attempt's candidates survive the retry as immutable evidence",
  );
  assert(
    (await db.fantasyProjectionRun.count({ where: { sourceBatchId: failBatch.batchId!, mode: "SHADOW" } })) === 2,
    "Both attempts exist; neither overwrote the other",
  );

  // =========================================================================
  section("R1. Attempts — failure and abort no longer block the same work");
  // =========================================================================
  const makeBatch = async (suffix: string, rowCount = 2) =>
    ingestFantasyRawBatch(
      {
        contractVersion: FANTASY_ROW_CONTRACT_V1,
        sourceMode: "FIXTURE",
        batchId: `PROJ-${suffix}-${stamp}`,
        headers: [...FANTASY_V1_HEADERS],
        rows: Array.from({ length: rowCount }, (_, i) => fantasyRow({ "Lot ID": `${suffix}-${i + 1}` })),
        cursor: { kind: "FULL_SNAPSHOT", token: null },
      },
      { mode: "PERSIST", db, provenance: FIXTURE_PROVENANCE },
    );

  // --- A failed attempt must be retryable under the SAME fingerprint -------
  const retryBatch = await makeBatch("RETRY");
  const attempt1 = await runProjection({ batchId: retryBatch.batchId!, mode: "SHADOW", requestedByUserId: null });
  assert(attempt1.attemptNumber === 1, "The first attempt is numbered 1");
  const attempt1Candidates = await db.fantasyProjectionCandidate.count({ where: { runId: attempt1.runId } });
  assert(attempt1Candidates === 2, "Attempt 1 wrote its candidates");

  // Simulate the attempt having failed.
  await db.fantasyProjectionRun.update({
    where: { id: attempt1.runId },
    data: { status: "FAILED", terminalReasonCode: "EXECUTION_ERROR", ownerTokenHash: null, completedAt: new Date() },
  });

  const attempt2 = await runProjection({ batchId: retryBatch.batchId!, mode: "SHADOW", requestedByUserId: null });
  assert(attempt2.attemptNumber === 2, "A failed attempt can be retried as attempt 2");
  assert(attempt2.fingerprint === attempt1.fingerprint, "The retry keeps the SAME logical fingerprint");
  assert(attempt2.runId !== attempt1.runId, "The retry is a distinct attempt row");
  assert(attempt2.status === "COMPLETED", "The retry completed");

  const failedStillThere = await db.fantasyProjectionRun.findUnique({
    where: { id: attempt1.runId },
    select: { status: true, attemptNumber: true },
  });
  assert(failedStillThere?.status === "FAILED", "The failed attempt is preserved, not overwritten");
  assert(
    (await db.fantasyProjectionCandidate.count({ where: { runId: attempt1.runId } })) === attempt1Candidates,
    "Candidates written by the failed attempt are preserved as evidence",
  );
  const chain = await db.fantasyProjectionRun.findUniqueOrThrow({
    where: { id: attempt2.runId },
    select: { previousAttemptId: true },
  });
  assert(chain.previousAttemptId === attempt1.runId, "The retry records which attempt it follows");

  // --- An aborted attempt must be retryable too ----------------------------
  const abortBatch = await makeBatch("ABORT");
  const abortAttempt1 = await runProjection({ batchId: abortBatch.batchId!, mode: "SHADOW", requestedByUserId: null });
  const abortRow = await db.fantasyProjectionRun.findUniqueOrThrow({
    where: { id: abortAttempt1.runId },
    select: { version: true },
  });
  await db.fantasyProjectionRun.update({
    where: { id: abortAttempt1.runId },
    data: { status: "RUNNING", completedAt: null },
  });
  const aborted = await abortProjectionAttempt(
    {
      runId: abortAttempt1.runId,
      expectedVersion: abortRow.version,
      actorUserId: "test-operator",
      reasonCode: "SUSPECTED_STALLED_WORKER",
      note: "stalled during nightly window",
    },
    async () => {},
  );
  assert(aborted.status === "ABORTED", "The attempt was aborted");
  assert(aborted.version === abortRow.version + 1, "The abort advanced the optimistic version");

  const abortAttempt2 = await runProjection({ batchId: abortBatch.batchId!, mode: "SHADOW", requestedByUserId: null });
  assert(abortAttempt2.attemptNumber === 2, "An aborted attempt can be retried as attempt 2");
  assert(abortAttempt2.fingerprint === abortAttempt1.fingerprint, "The retry keeps the same fingerprint");
  assert(
    (await db.fantasyProjectionCandidate.count({ where: { runId: abortAttempt1.runId } })) > 0,
    "Candidates written by the aborted attempt are preserved as evidence",
  );

  // --- A completed attempt still replays, and creates no new attempt -------
  const replayed = await runProjection({ batchId: abortBatch.batchId!, mode: "SHADOW", requestedByUserId: null });
  assert(replayed.idempotentReplay === true, "A completed attempt replays");
  assert(replayed.runId === abortAttempt2.runId, "The replay returns the completed attempt");
  assert(
    (await db.fantasyProjectionRun.count({ where: { fingerprint: abortAttempt1.fingerprint } })) === 2,
    "The replay created no third attempt",
  );

  // --- A crashed RUNNING attempt: blocked, then recoverable by abort -------
  const crashBatch = await makeBatch("CRASH");
  const crashAttempt = await runProjection({ batchId: crashBatch.batchId!, mode: "SHADOW", requestedByUserId: null });
  const crashRow = await db.fantasyProjectionRun.findUniqueOrThrow({
    where: { id: crashAttempt.runId },
    select: { version: true },
  });
  // A worker that died leaves the row RUNNING with its owner hash still set.
  await db.fantasyProjectionRun.update({
    where: { id: crashAttempt.runId },
    data: { status: "RUNNING", completedAt: null, ownerTokenHash: hashOwnerToken("dead-worker-token") },
  });

  let crashedBlocked = "";
  try {
    await runProjection({ batchId: crashBatch.batchId!, mode: "SHADOW", requestedByUserId: null });
  } catch (error) {
    crashedBlocked = error instanceof ProjectionError ? error.code : "WRONG_ERROR";
  }
  assert(crashedBlocked === "PROJECTION_ALREADY_RUNNING", "A crashed RUNNING attempt blocks a duplicate start");

  await abortProjectionAttempt(
    {
      runId: crashAttempt.runId,
      expectedVersion: crashRow.version,
      actorUserId: "test-operator",
      reasonCode: "SUSPECTED_STALLED_WORKER",
      note: null,
    },
    async () => {},
  );
  const recovered = await runProjection({ batchId: crashBatch.batchId!, mode: "SHADOW", requestedByUserId: null });
  assert(recovered.attemptNumber === 2, "After an explicit abort the crashed work is recoverable");
  assert(recovered.status === "COMPLETED", "The recovery attempt completed");

  // --- Two simultaneous retries create exactly one next attempt ------------
  const raceRetryBatch = await makeBatch("RACERETRY");
  const raceFirst = await runProjection({ batchId: raceRetryBatch.batchId!, mode: "SHADOW", requestedByUserId: null });
  await db.fantasyProjectionRun.update({
    where: { id: raceFirst.runId },
    data: { status: "FAILED", terminalReasonCode: "EXECUTION_ERROR", ownerTokenHash: null, completedAt: new Date() },
  });
  await Promise.allSettled([
    runProjection({ batchId: raceRetryBatch.batchId!, mode: "SHADOW", requestedByUserId: null }),
    runProjection({ batchId: raceRetryBatch.batchId!, mode: "SHADOW", requestedByUserId: null }),
  ]);
  const retryAttempts = await db.fantasyProjectionRun.count({ where: { fingerprint: raceFirst.fingerprint } });
  assert(retryAttempts === 2, "Two simultaneous retries created exactly ONE next attempt");

  // =========================================================================
  section("R2. Database-enforced attempt invariants");
  // =========================================================================
  const invariantRun = await db.fantasyProjectionRun.findUniqueOrThrow({
    where: { id: attempt2.runId },
    select: { fingerprint: true },
  });

  let twoRunningRefused = false;
  try {
    await db.$executeRawUnsafe(
      `INSERT INTO "FantasyProjectionRun" ("id","mode","status","fingerprint","attemptNumber","contractVersion","effectiveSourceState","identityPolicyVersion","quantitySemantics","weightUnit","startedAt","createdAt")
       VALUES ('two-running-a-${stamp}','SHADOW','RUNNING','${invariantRun.fingerprint}',900,'${FANTASY_ROW_CONTRACT_V1}','FIXTURE_SIMULATION',1,'PIECE_COUNT','CARAT',NOW(),NOW())`,
    );
    await db.$executeRawUnsafe(
      `INSERT INTO "FantasyProjectionRun" ("id","mode","status","fingerprint","attemptNumber","contractVersion","effectiveSourceState","identityPolicyVersion","quantitySemantics","weightUnit","startedAt","createdAt")
       VALUES ('two-running-b-${stamp}','SHADOW','RUNNING','${invariantRun.fingerprint}',901,'${FANTASY_ROW_CONTRACT_V1}','FIXTURE_SIMULATION',1,'PIECE_COUNT','CARAT',NOW(),NOW())`,
    );
  } catch {
    twoRunningRefused = true;
  }
  assert(twoRunningRefused, "The database refuses two RUNNING attempts for one fingerprint");
  await db.$executeRawUnsafe(`DELETE FROM "FantasyProjectionRun" WHERE "id" = 'two-running-a-${stamp}'`);

  let twoCompletedRefused = false;
  try {
    await db.$executeRawUnsafe(
      `INSERT INTO "FantasyProjectionRun" ("id","mode","status","fingerprint","attemptNumber","contractVersion","effectiveSourceState","identityPolicyVersion","quantitySemantics","weightUnit","startedAt","createdAt","completedAt")
       VALUES ('two-completed-${stamp}','SHADOW','COMPLETED','${invariantRun.fingerprint}',902,'${FANTASY_ROW_CONTRACT_V1}','FIXTURE_SIMULATION',1,'PIECE_COUNT','CARAT',NOW(),NOW(),NOW())`,
    );
  } catch {
    twoCompletedRefused = true;
  }
  assert(twoCompletedRefused, "The database refuses two COMPLETED attempts for one fingerprint");

  let badAttemptNumberRefused = false;
  try {
    await db.$executeRawUnsafe(
      `INSERT INTO "FantasyProjectionRun" ("id","mode","status","fingerprint","attemptNumber","contractVersion","effectiveSourceState","identityPolicyVersion","quantitySemantics","weightUnit","startedAt","createdAt","completedAt")
       VALUES ('bad-attempt-${stamp}','SHADOW','FAILED','fp-bad-${stamp}',0,'${FANTASY_ROW_CONTRACT_V1}','FIXTURE_SIMULATION',1,'PIECE_COUNT','CARAT',NOW(),NOW(),NOW())`,
    );
  } catch {
    badAttemptNumberRefused = true;
  }
  assert(badAttemptNumberRefused, "The database refuses attempt number 0");

  let terminalWithoutTimestampRefused = false;
  try {
    await db.$executeRawUnsafe(
      `INSERT INTO "FantasyProjectionRun" ("id","mode","status","fingerprint","attemptNumber","contractVersion","effectiveSourceState","identityPolicyVersion","quantitySemantics","weightUnit","startedAt","createdAt")
       VALUES ('no-ts-${stamp}','SHADOW','COMPLETED','fp-nots-${stamp}',1,'${FANTASY_ROW_CONTRACT_V1}','FIXTURE_SIMULATION',1,'PIECE_COUNT','CARAT',NOW(),NOW())`,
    );
  } catch {
    terminalWithoutTimestampRefused = true;
  }
  assert(terminalWithoutTimestampRefused, "The database refuses a terminal attempt with no completion timestamp");

  let terminalOwnedRefused = false;
  try {
    await db.$executeRawUnsafe(
      `UPDATE "FantasyProjectionRun" SET "ownerTokenHash" = 'deadbeef' WHERE "id" = '${attempt1.runId}'`,
    );
  } catch {
    terminalOwnedRefused = true;
  }
  assert(terminalOwnedRefused, "The database refuses an owner token on a terminal attempt");

  let longNoteRefused = false;
  try {
    await db.$executeRawUnsafe(
      `UPDATE "FantasyProjectionRun" SET "abortReasonNote" = repeat('x', 501) WHERE "id" = '${attempt1.runId}'`,
    );
  } catch {
    longNoteRefused = true;
  }
  assert(longNoteRefused, "The database bounds the operator abort note");

  // =========================================================================
  section("R3. Owner token and heartbeat");
  // =========================================================================
  const token = issueOwnerToken();
  assert(token.token.length === 64, "An owner token is 32 random bytes");
  assert(token.hash !== token.token, "Only the hash is stored, never the token");
  assert(token.hash === hashOwnerToken(token.token), "The hash is reproducible from the token");
  assert(issueOwnerToken().token !== issueOwnerToken().token, "Each token is distinct");

  const ownedBatch = await makeBatch("OWNED");
  const ownedFirst = await runProjection({ batchId: ownedBatch.batchId!, mode: "SHADOW", requestedByUserId: null });
  await db.fantasyProjectionRun.update({
    where: { id: ownedFirst.runId },
    data: { status: "FAILED", terminalReasonCode: "EXECUTION_ERROR", ownerTokenHash: null, completedAt: new Date() },
  });

  // Stand up a RUNNING attempt this test owns, to exercise the guarded writes directly.
  const ownedAttempt = await db.fantasyProjectionRun.create({
    data: {
      mode: "SHADOW",
      status: "RUNNING",
      fingerprint: `owned-${stamp}`,
      attemptNumber: 1,
      contractVersion: FANTASY_ROW_CONTRACT_V1,
      effectiveSourceState: "FIXTURE_SIMULATION",
      identityPolicyVersion: 1,
      quantitySemantics: "PIECE_COUNT",
      weightUnit: "CARAT",
      ownerTokenHash: token.hash,
      heartbeatAt: new Date(Date.now() - 60_000),
    },
    select: { id: true, version: true, heartbeatAt: true },
  });

  const beat1 = await touchHeartbeatOwned(ownedAttempt.id, token.hash, ownedAttempt.version);
  assert(beat1 === ownedAttempt.version + 1, "A guarded heartbeat advances the version");
  const afterBeat = await db.fantasyProjectionRun.findUniqueOrThrow({
    where: { id: ownedAttempt.id },
    select: { heartbeatAt: true },
  });
  assert(
    afterBeat.heartbeatAt !== null && afterBeat.heartbeatAt.getTime() > ownedAttempt.heartbeatAt!.getTime(),
    "The heartbeat advanced",
  );

  let wrongTokenRejected = "";
  try {
    await touchHeartbeatOwned(ownedAttempt.id, hashOwnerToken("some-other-token"), beat1);
  } catch (error) {
    wrongTokenRejected = error instanceof ProjectionRecoveryError ? error.code : "WRONG_ERROR";
  }
  assert(wrongTokenRejected === "PROJECTION_OWNERSHIP_LOST", "A wrong owner token is rejected");

  let staleVersionRejected = "";
  try {
    await touchHeartbeatOwned(ownedAttempt.id, token.hash, ownedAttempt.version);
  } catch (error) {
    staleVersionRejected = error instanceof ProjectionRecoveryError ? error.code : "WRONG_ERROR";
  }
  assert(staleVersionRejected === "PROJECTION_OWNERSHIP_LOST", "A stale version is rejected");

  // --- After an abort, the old worker can neither write nor finalize -------
  const preAbort = await db.fantasyProjectionRun.findUniqueOrThrow({
    where: { id: ownedAttempt.id },
    select: { version: true },
  });
  await abortProjectionAttempt(
    {
      runId: ownedAttempt.id,
      expectedVersion: preAbort.version,
      actorUserId: "test-operator",
      reasonCode: "OPERATOR_REQUESTED",
      note: null,
    },
    async () => {},
  );
  const afterAbort = await db.fantasyProjectionRun.findUniqueOrThrow({
    where: { id: ownedAttempt.id },
    select: { status: true, ownerTokenHash: true, abortedByUserId: true, abortReasonCode: true, version: true },
  });
  assert(afterAbort.status === "ABORTED", "The attempt is aborted");
  assert(afterAbort.ownerTokenHash === null, "The abort cleared the worker's ownership");
  assert(afterAbort.abortedByUserId === "test-operator", "The abort recorded the actor");
  assert(afterAbort.abortReasonCode === "OPERATOR_REQUESTED", "The abort recorded a fixed reason code");

  const candidatesBeforeLateWrite = await db.fantasyProjectionCandidate.count({ where: { runId: ownedAttempt.id } });
  let lateWriteRejected = "";
  try {
    await writeCandidatePageOwned(ownedAttempt.id, token.hash, preAbort.version, [
      {
        runId: ownedAttempt.id,
        sourceRowNumber: 1,
        rowHash: "late",
        projectionIdentityKey: "late",
        identityPolicyVersion: 1,
        quantityState: "MISSING",
        quantitySemantics: "PIECE_COUNT",
        weightUnit: "CARAT",
        candidateState: "PROJECTED",
      },
    ]);
  } catch (error) {
    lateWriteRejected = error instanceof ProjectionRecoveryError ? error.code : "WRONG_ERROR";
  }
  assert(lateWriteRejected === "PROJECTION_OWNERSHIP_LOST", "The old worker cannot write a page after the abort");
  assert(
    (await db.fantasyProjectionCandidate.count({ where: { runId: ownedAttempt.id } })) === candidatesBeforeLateWrite,
    "No candidate landed after the abort — the check and the insert are one transaction",
  );

  const lateFinalize = await finalizeOwnedAttempt({
    runId: ownedAttempt.id,
    ownerTokenHash: token.hash,
    expectedVersion: preAbort.version,
    status: "COMPLETED",
    terminalReasonCode: "COMPLETED_NORMALLY",
    counters: {},
  });
  assert(lateFinalize === false, "The old worker cannot finalize after the abort");
  const stillAborted = await db.fantasyProjectionRun.findUniqueOrThrow({
    where: { id: ownedAttempt.id },
    select: { status: true },
  });
  assert(stillAborted.status === "ABORTED", "The operator's abort stands; it was not overwritten by the worker");

  // =========================================================================
  section("R4. Abort service rules");
  // =========================================================================
  let abortCompletedRefused = "";
  try {
    await abortProjectionAttempt(
      { runId: attempt2.runId, expectedVersion: 0, actorUserId: "op", reasonCode: "OPERATOR_REQUESTED", note: null },
      async () => {},
    );
  } catch (error) {
    abortCompletedRefused = error instanceof ProjectionRecoveryError ? error.code : "WRONG_ERROR";
  }
  assert(abortCompletedRefused === "RUN_NOT_RUNNING", "A COMPLETED attempt cannot be aborted");

  let abortFailedRefused = "";
  try {
    await abortProjectionAttempt(
      { runId: attempt1.runId, expectedVersion: 0, actorUserId: "op", reasonCode: "OPERATOR_REQUESTED", note: null },
      async () => {},
    );
  } catch (error) {
    abortFailedRefused = error instanceof ProjectionRecoveryError ? error.code : "WRONG_ERROR";
  }
  assert(abortFailedRefused === "RUN_NOT_RUNNING", "A FAILED attempt cannot be aborted");

  let abortAgainRefused = "";
  try {
    await abortProjectionAttempt(
      { runId: ownedAttempt.id, expectedVersion: afterAbort.version, actorUserId: "op", reasonCode: "OPERATOR_REQUESTED", note: null },
      async () => {},
    );
  } catch (error) {
    abortAgainRefused = error instanceof ProjectionRecoveryError ? error.code : "WRONG_ERROR";
  }
  assert(abortAgainRefused === "RUN_NOT_RUNNING", "An already-ABORTED attempt cannot be aborted again");

  let abortMissingRefused = "";
  try {
    await abortProjectionAttempt(
      { runId: "does-not-exist", expectedVersion: 0, actorUserId: "op", reasonCode: "OPERATOR_REQUESTED", note: null },
      async () => {},
    );
  } catch (error) {
    abortMissingRefused = error instanceof ProjectionRecoveryError ? error.code : "WRONG_ERROR";
  }
  assert(abortMissingRefused === "RUN_NOT_FOUND", "An unknown attempt is refused with a fixed code");

  // --- Optimistic version conflict ----------------------------------------
  const conflictAttempt = await db.fantasyProjectionRun.create({
    data: {
      mode: "SHADOW",
      status: "RUNNING",
      fingerprint: `conflict-${stamp}`,
      attemptNumber: 1,
      contractVersion: FANTASY_ROW_CONTRACT_V1,
      effectiveSourceState: "FIXTURE_SIMULATION",
      identityPolicyVersion: 1,
      quantitySemantics: "PIECE_COUNT",
      weightUnit: "CARAT",
      ownerTokenHash: hashOwnerToken("conflict-token"),
    },
    select: { id: true, version: true },
  });
  let versionConflict = "";
  try {
    await abortProjectionAttempt(
      {
        runId: conflictAttempt.id,
        expectedVersion: conflictAttempt.version + 5,
        actorUserId: "op",
        reasonCode: "OPERATOR_REQUESTED",
        note: null,
      },
      async () => {},
    );
  } catch (error) {
    versionConflict = error instanceof ProjectionRecoveryError ? error.code : "WRONG_ERROR";
  }
  assert(versionConflict === "VERSION_CONFLICT", "An abort with a stale expected version is refused");
  const unaffected = await db.fantasyProjectionRun.findUniqueOrThrow({
    where: { id: conflictAttempt.id },
    select: { status: true },
  });
  assert(unaffected.status === "RUNNING", "The refused abort changed nothing");

  let longNoteServiceRefused = "";
  try {
    await abortProjectionAttempt(
      {
        runId: conflictAttempt.id,
        expectedVersion: conflictAttempt.version,
        actorUserId: "op",
        reasonCode: "OPERATOR_REQUESTED",
        note: "x".repeat(ABORT_NOTE_MAX_LENGTH + 1),
      },
      async () => {},
    );
  } catch (error) {
    longNoteServiceRefused = error instanceof ProjectionRecoveryError ? error.code : "WRONG_ERROR";
  }
  assert(longNoteServiceRefused === "ABORT_NOTE_TOO_LONG", "An over-long operator note is refused");

  assert(isAbortReasonCode("OPERATOR_REQUESTED"), "A known abort reason is accepted");
  assert(!isAbortReasonCode("BECAUSE_I_SAID_SO"), "An unlisted abort reason is rejected");

  // --- Audit failure must roll the abort back ------------------------------
  let auditRollback = false;
  try {
    await abortProjectionAttempt(
      {
        runId: conflictAttempt.id,
        expectedVersion: conflictAttempt.version,
        actorUserId: "op",
        reasonCode: "OPERATOR_REQUESTED",
        note: null,
      },
      async () => {
        throw new Error("audit write failed");
      },
    );
  } catch {
    auditRollback = true;
  }
  assert(auditRollback, "An abort whose audit write fails propagates the failure");
  const notSilentlyAborted = await db.fantasyProjectionRun.findUniqueOrThrow({
    where: { id: conflictAttempt.id },
    select: { status: true },
  });
  assert(
    notSilentlyAborted.status === "RUNNING",
    "The abort rolled back with its audit record — an executed recovery is never invisible",
  );

  // Release the probe attempt. Candidates are immutable and attempts are append-only, so
  // a suite that leaves RUNNING rows behind would slowly consume global capacity for
  // every later run against this database.
  const conflictFinal = await db.fantasyProjectionRun.findUniqueOrThrow({
    where: { id: conflictAttempt.id },
    select: { version: true },
  });
  await abortProjectionAttempt(
    {
      runId: conflictAttempt.id,
      expectedVersion: conflictFinal.version,
      actorUserId: "test-operator",
      reasonCode: "OPERATOR_REQUESTED",
      note: null,
    },
    async () => {},
  );

  // =========================================================================
  section("R5. Database-coordinated workload limits");
  // =========================================================================
  const limits = resolveProjectionWorkloadLimits({});
  assert(limits.maxActivePerActor === 1, "The default allows one active projection per actor");
  assert(limits.usedFallback === false, "An empty environment uses defaults without reporting a fallback");

  for (const bad of ["0", "-1", "abc", "1.5", "999999999"]) {
    const resolved = resolveProjectionWorkloadLimits({ FANTASY_PROJECTION_MAX_ACTIVE: bad });
    assert(resolved.usedFallback === true, `An invalid global limit "${bad}" reports a fallback`);
    assert(
      resolved.maxActiveGlobal === DEFAULT_PROJECTION_WORKLOAD_LIMITS.maxActiveGlobal,
      `An invalid global limit "${bad}" falls back to the safe default, never to unlimited`,
    );
  }
  const configured = resolveProjectionWorkloadLimits({ FANTASY_PROJECTION_MAX_ACTIVE: "5" });
  // Headroom on every dimension except the one each case below deliberately exhausts,
  // so a failure names the rule that actually fired.
  const GENEROUS = { ...limits, maxActiveGlobal: 50, maxStartsPerActorPerWindow: 1000 };
  assert(configured.maxActiveGlobal === 5 && configured.usedFallback === false, "A valid limit is honoured");

  // Per-actor: a live RUNNING attempt for this actor blocks a second start.
  const actorId = `limit-actor-${stamp}`;
  const busyAttempt = await db.fantasyProjectionRun.create({
    data: {
      mode: "SHADOW",
      status: "RUNNING",
      fingerprint: `busy-${stamp}`,
      attemptNumber: 1,
      contractVersion: FANTASY_ROW_CONTRACT_V1,
      effectiveSourceState: "FIXTURE_SIMULATION",
      identityPolicyVersion: 1,
      quantitySemantics: "PIECE_COUNT",
      weightUnit: "CARAT",
      requestedByUserId: actorId,
      ownerTokenHash: hashOwnerToken(`busy-${stamp}`),
    },
    select: { id: true, version: true },
  });

  const limitBatch = await makeBatch("LIMIT");
  let actorBusy = "";
  try {
    await runProjection({
      batchId: limitBatch.batchId!,
      mode: "SHADOW",
      requestedByUserId: actorId,
      limits: GENEROUS,
    });
  } catch (error) {
    actorBusy = error instanceof ProjectionRecoveryError ? error.code : "WRONG_ERROR";
  }
  assert(actorBusy === "PROJECTION_ACTOR_BUSY", "An actor with a running projection cannot start another");
  assert(
    (await db.fantasyProjectionRun.count({ where: { sourceBatchId: limitBatch.batchId! } })) === 0,
    "The refused start created no attempt row",
  );

  // Global capacity, decided against the database rather than in process memory.
  let globalFull = "";
  try {
    await runProjection({
      batchId: limitBatch.batchId!,
      mode: "SHADOW",
      requestedByUserId: `other-${stamp}`,
      limits: { ...limits, maxActiveGlobal: 1 },
    });
  } catch (error) {
    globalFull = error instanceof ProjectionRecoveryError ? error.code : "WRONG_ERROR";
  }
  assert(globalFull === "PROJECTION_GLOBAL_CAPACITY_REACHED", "A full global capacity refuses a different actor too");

  // Per-actor start limit over a window.
  let startLimit = "";
  try {
    await runProjection({
      batchId: limitBatch.batchId!,
      mode: "SHADOW",
      requestedByUserId: actorId,
      limits: { ...GENEROUS, maxActivePerActor: 99, maxStartsPerActorPerWindow: 1 },
    });
  } catch (error) {
    startLimit = error instanceof ProjectionRecoveryError ? error.code : "WRONG_ERROR";
  }
  assert(startLimit === "PROJECTION_ACTOR_START_LIMIT_REACHED", "The per-actor start limit over a window is enforced");

  // Release the slot and confirm the actor can proceed.
  await abortProjectionAttempt(
    {
      runId: busyAttempt.id,
      expectedVersion: busyAttempt.version,
      actorUserId: "test-operator",
      reasonCode: "RESOURCE_PRESSURE",
      note: null,
    },
    async () => {},
  );
  const afterRelease = await runProjection({
    batchId: limitBatch.batchId!,
    mode: "SHADOW",
    requestedByUserId: actorId,
    limits: GENEROUS,
  });
  assert(afterRelease.status === "COMPLETED", "Once the slot is released the actor can run again");

  // An idempotent replay must not consume a slot.
  const busyAgain = await db.fantasyProjectionRun.create({
    data: {
      mode: "SHADOW",
      status: "RUNNING",
      fingerprint: `busy2-${stamp}`,
      attemptNumber: 1,
      contractVersion: FANTASY_ROW_CONTRACT_V1,
      effectiveSourceState: "FIXTURE_SIMULATION",
      identityPolicyVersion: 1,
      quantitySemantics: "PIECE_COUNT",
      weightUnit: "CARAT",
      requestedByUserId: actorId,
      ownerTokenHash: hashOwnerToken(`busy2-${stamp}`),
    },
    select: { id: true, version: true },
  });
  const replayWhileBusy = await runProjection({
    batchId: limitBatch.batchId!,
    mode: "SHADOW",
    requestedByUserId: actorId,
  });
  assert(
    replayWhileBusy.idempotentReplay === true,
    "Replaying a completed attempt succeeds even while the actor holds a slot",
  );
  await abortProjectionAttempt(
    {
      runId: busyAgain.id,
      expectedVersion: busyAgain.version,
      actorUserId: "test-operator",
      reasonCode: "RESOURCE_PRESSURE",
      note: null,
    },
    async () => {},
  );

  // --- Two independent database clients see the same limits ----------------
  const secondClient = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL! } } });
  try {
    const viaFirst = await db.fantasyProjectionRun.count({ where: { status: "RUNNING" } });
    const viaSecond = await secondClient.fantasyProjectionRun.count({ where: { status: "RUNNING" } });
    assert(viaFirst === viaSecond, "Two independent clients observe the same active-run count");

    const crossBatch = await makeBatch("CROSS");
    const crossActor = `cross-actor-${stamp}`;
    const held = await secondClient.fantasyProjectionRun.create({
      data: {
        mode: "SHADOW",
        status: "RUNNING",
        fingerprint: `cross-${stamp}`,
        attemptNumber: 1,
        contractVersion: FANTASY_ROW_CONTRACT_V1,
        effectiveSourceState: "FIXTURE_SIMULATION",
        identityPolicyVersion: 1,
        quantitySemantics: "PIECE_COUNT",
        weightUnit: "CARAT",
        requestedByUserId: crossActor,
        ownerTokenHash: hashOwnerToken(`cross-${stamp}`),
      },
      select: { id: true, version: true },
    });

    // The slot was taken by a *different client* — a process-local limiter would miss it.
    let crossBlocked = "";
    try {
      await runProjection({
        batchId: crossBatch.batchId!,
        mode: "SHADOW",
        requestedByUserId: crossActor,
        limits: GENEROUS,
      });
    } catch (error) {
      crossBlocked = error instanceof ProjectionRecoveryError ? error.code : "WRONG_ERROR";
    }
    assert(
      crossBlocked === "PROJECTION_ACTOR_BUSY",
      "A slot held via a second client blocks a start made through the first",
    );

    await abortProjectionAttempt(
      {
        runId: held.id,
        expectedVersion: held.version,
        actorUserId: "test-operator",
        reasonCode: "RESOURCE_PRESSURE",
        note: null,
      },
      async () => {},
    );
  } finally {
    await secondClient.$disconnect();
  }

  // =========================================================================
  section("R6. No secret ever leaves the database");
  // =========================================================================
  const runFields = await db.fantasyProjectionRun.findUniqueOrThrow({
    where: { id: attempt2.runId },
    select: { ownerTokenHash: true },
  });
  assert(runFields.ownerTokenHash === null, "A completed attempt holds no owner token hash");

  const listRouteSource = codeOf(path.join(REPO, "src", "app", "api", "fantasy", "projection", "route.ts"));
  assert(!/ownerTokenHash/.test(listRouteSource), "The projection list route never selects the owner token hash");
  const abortRouteSource = codeOf(
    path.join(REPO, "src", "app", "api", "fantasy", "projection", "[runId]", "abort", "route.ts"),
  );
  assert(!/ownerTokenHash/.test(abortRouteSource), "The abort route never selects or returns the owner token hash");

  const recoverySource = codeOf(path.join(REPO, "src", "lib", "fantasy", "projection-recovery.ts"));
  assert(!/log\(|console\./.test(recoverySource), "The recovery module logs nothing, so no token can reach a log line");

  const summaryJson = JSON.stringify(attempt2);
  assert(!summaryJson.includes(token.hash), "A run summary carries no owner token hash");
  assert(!/ownerToken/.test(summaryJson), "A run summary has no owner-token field at all");

  // =========================================================================
  section("R7. Operational records untouched by the whole recovery flow");
  // =========================================================================
  assert(
    (await db.lotMasterRecord.count()) === canonicalBefore,
    "Master records unchanged across every attempt, abort and retry",
  );
  assert((await db.lotHistoryRecord.count()) === historyBefore, "History records unchanged");
  assert((await db.syncCheckpoint.count()) === checkpointBefore, "Sync checkpoints unchanged");
  assert((await db.demandMetric.count()) === demandBefore, "Demand metrics unchanged");
  assert((await db.requirement.count()) === requirementBefore, "Requirements unchanged");

  // =========================================================================
  section("L. Downstream source policy");
  // =========================================================================
  const summary = downstreamPolicySummary();
  assert(summary.active === "LEGACY_FIXTURE", "The active downstream source is still the legacy pipeline");
  assert(policyAvailability("LEGACY_FIXTURE").usableForOperationalReads === true, "Legacy reads are available");
  assert(policyAvailability("SHADOW_COMPARE").usableForOperationalReads === false, "Shadow output is diagnostic only");
  assert(policyAvailability("CANONICAL_PROJECTED").availability === "NOT_IMPLEMENTED", "Projected reads are not implemented");
  assert(
    policyAvailability("CANONICAL_PROJECTED").reasonCode === ACTIVATION_BLOCKED_REASON,
    "The projected policy reports the same activation reason as a run",
  );

  for (const refused of ["SHADOW_COMPARE", "CANONICAL_PROJECTED"] as const) {
    let threw = false;
    let fellBack = false;
    try {
      const result = assertOperationalPolicy(refused);
      fellBack = result === "LEGACY_FIXTURE";
    } catch (error) {
      threw = error instanceof DownstreamSourcePolicyError;
    }
    assert(threw, `${refused} is refused for operational reads`);
    assert(!fellBack, `${refused} does NOT silently fall back to the legacy source`);
  }
  assert(assertOperationalPolicy("LEGACY_FIXTURE") === "LEGACY_FIXTURE", "The legacy policy resolves");

  // =========================================================================
  section("M. Repository scan — forbidden derivations are absent");
  // =========================================================================
  const forbidden: Array<{ pattern: RegExp; label: string }> = [
    { pattern: /quantity\s*\*\s*\w*[aA]v(g|erage)Weight/, label: "Qty × Avg Weight derivation" },
    { pattern: /\w*[aA]v(g|erage)Weight\s*\*\s*quantity/, label: "Avg Weight × Qty derivation" },
    { pattern: /quantity\s*:\s*1\s*,?\s*\/\/\s*assume/i, label: "assumed quantity of 1" },
    { pattern: /actualShape\s*[:=]\s*\w*[eE]stimated/, label: "estimated shape written to the measured field" },
    { pattern: /actualColor\s*[:=]\s*\w*[eE]stimated/, label: "estimated color written to the measured field" },
    { pattern: /actualClarity\s*[:=]\s*\w*[eE]stimated/, label: "estimated clarity written to the measured field" },
    { pattern: /actualWeight\s*[:=]\s*\w*[eE]stimated/, label: "estimated weight written to the measured field" },
    { pattern: /weightRaw\s*\?\?\s*\w*[eE]stimatedWeight/, label: "measured weight defaulting to the estimate" },
    { pattern: /shapeRaw\s*\?\?\s*\w*[eE]stimatedShape/, label: "measured shape defaulting to the estimate" },
  ];

  for (const { pattern, label } of forbidden) {
    const hits = appFiles.filter((f) => pattern.test(codeOf(f)));
    assert(hits.length === 0, `No ${label} anywhere in the repository`);
    if (hits.length > 0) for (const h of hits) console.error(`      ${path.relative(REPO, h)}`);
  }

  // The unit and semantics constants may only be relaxed in the fixture profile.
  const qwSource = codeOf(path.join(REPO, "src", "lib", "fantasy", "quantity-weight.ts"));
  const caratAssignments = qwSource.match(/weightUnit:\s*"CARAT"/g) ?? [];
  assert(caratAssignments.length === 1, "Exactly one profile declares a carat unit");
  const pieceAssignments = qwSource.match(/quantitySemantics:\s*"PIECE_COUNT"/g) ?? [];
  assert(pieceAssignments.length === 1, "Exactly one profile declares piece-count semantics");

  // =========================================================================
  console.log("\n===============================================================================");
  console.log(`RESULT: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log("\nFailures:");
    for (const f of failures) console.log(`  - ${f}`);
  }
  console.log("===============================================================================");

  await db.$disconnect();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(async (error) => {
  console.error("FATAL:", error instanceof Error ? error.message : String(error));
  await db.$disconnect();
  process.exit(1);
});
