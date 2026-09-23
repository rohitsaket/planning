/**
 * FANTASY CLASSIFICATION — status, hold and availability (Master Phase 1, Checkpoint 2)
 *
 * Runs against the isolated security-test database only (planning_sectest).
 *
 * Proves: the classifier is the single authority; hold is tri-state and fails closed;
 * an unmapped or missing status can never become memo, stock or available; a status
 * mapping cannot override a hold; a simulation-only profile cannot classify live data;
 * the fixture compatibility sentinel is honoured only from the application's own adapter
 * and only for simulated data; a profile edit produces a new version without rewriting
 * past classifications; and the hardcoded `STOCK -> PHYSICAL, else MEMO` rule is gone
 * from the repository.
 *
 * Usage: npx tsx scripts/with-sectest-db.ts npx tsx scripts/test-fantasy-classification.ts
 */

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { db } from "../src/lib/db";
import { SECTEST_DB } from "../tests/security/test-db";
import {
  AVAILABLE_LEGACY_PLANNING_CLASSES,
  LEGACY_FIXTURE_HOLD_SENTINEL,
  classifyFantasyRecord,
  isMirroredInventoryClass,
  legacyFixtureClassificationInput,
  resolveEffectiveClassification,
  resolveHoldState,
  toLegacyPlanningClass,
  type ClassificationInput,
  type ClassificationProfile,
} from "../src/lib/fantasy/classification";
import {
  LEGACY_FIXTURE_PROFILE,
  loadClassificationProfile,
  loadProfileForSourceState,
} from "../src/lib/fantasy/classification-profile";

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

/** A fixture-shaped input with one field overridden. */
function input(overrides: Partial<ClassificationInput> = {}): ClassificationInput {
  return { ...legacyFixtureClassificationInput({ currentStatus: "STOCK" }), ...overrides };
}

async function main() {
  console.log("===============================================================================");
  console.log("FANTASY CLASSIFICATION — STATUS, HOLD & AVAILABILITY");
  console.log("===============================================================================");

  const profile = await loadClassificationProfile(LEGACY_FIXTURE_PROFILE);
  if (profile === null) {
    console.error("REFUSING TO RUN: the LEGACY_FIXTURE profile is not configured. Deploy migrations first.");
    process.exit(1);
  }

  // =========================================================================
  section("A. Mapped fixture statuses produce the configured class");
  // =========================================================================
  const stock = classifyFantasyRecord(input({ rawStatus: "STOCK" }), profile);
  assert(stock.state === "CLASSIFIED", "A mapped status classifies");
  assert(stock.inventoryClass === "PHYSICAL_AVAILABLE", "STOCK is physically available");
  assert(stock.available === true && stock.planningEligible === true, "STOCK is available and planning eligible");
  assert(toLegacyPlanningClass(stock.inventoryClass) === "PHYSICAL", "STOCK still writes the legacy PHYSICAL mirror class");

  const memo = classifyFantasyRecord(input({ rawStatus: "MEMO" }), profile);
  assert(memo.inventoryClass === "MEMO", "MEMO classifies as memo");
  assert(memo.available === false, "Memo is never available");
  assert(toLegacyPlanningClass(memo.inventoryClass) === "MEMO", "MEMO still writes the legacy MEMO mirror class");

  const reserved = classifyFantasyRecord(input({ rawStatus: "RESERVED" }), profile);
  assert(reserved.inventoryClass === "RESERVED" && reserved.available === false, "RESERVED is classified and unavailable");

  for (const wip of ["WIP_PLANNING", "WIP_LASER", "WIP_POLISHING", "WIP_GRADING", "WIP_COMPLETED"]) {
    const r = classifyFantasyRecord(input({ rawStatus: wip }), profile);
    assert(r.inventoryClass === "WIP" && r.available === false, `${wip} is WIP and never counts as available stock`);
  }

  for (const terminal of ["SOLD", "INVOICE", "TRANSFERRED", "ARCHIVED", "CANCELLED"]) {
    const r = classifyFantasyRecord(input({ rawStatus: terminal }), profile);
    assert(r.terminal === true, `${terminal} is terminal`);
    assert(r.available === false && r.planningEligible === false, `${terminal} is neither available nor planning eligible`);
  }

  assert(classifyFantasyRecord(input({ rawStatus: "stock" }), profile).available === true, "Status matching is case-insensitive by normalization");
  assert(classifyFantasyRecord(input({ rawStatus: "  STOCK  " }), profile).available === true, "Surrounding whitespace is trimmed");

  // =========================================================================
  section("B. Unknown and missing statuses fail closed");
  // =========================================================================
  for (const unknown of ["BANANA", "AVAILABLE", "PLANNING_AVAILABLE", "QC_HOLD", "IN_TRANSIT"]) {
    const r = classifyFantasyRecord(input({ rawStatus: unknown }), profile);
    assert(r.inventoryClass === "EXCLUDED", `Unmapped status "${unknown}" is excluded`);
    assert(r.inventoryClass !== "MEMO", `Unmapped status "${unknown}" does NOT fall through to memo`);
    assert(r.available === false && r.planningEligible === false, `Unmapped status "${unknown}" is not available`);
    assert(r.reviewRequired === true, `Unmapped status "${unknown}" requires review`);
    assert(r.lifecycle === "UNKNOWN", `Unmapped status "${unknown}" has an UNKNOWN lifecycle`);
    assert(r.exclusionReasons.includes("STATUS_UNMAPPED"), `Unmapped status "${unknown}" reports STATUS_UNMAPPED`);
  }

  for (const missing of [null, undefined, "", "   ", 0, false]) {
    const r = classifyFantasyRecord(input({ rawStatus: missing }), profile);
    assert(r.available === false, `Missing status ${JSON.stringify(missing)} is not available`);
    assert(r.exclusionReasons.includes("STATUS_MISSING"), `Missing status ${JSON.stringify(missing)} reports STATUS_MISSING`);
  }

  // =========================================================================
  section("C. Hold is tri-state and blocks availability");
  // =========================================================================
  const sentinelHold = resolveHoldState(
    { rawHold: LEGACY_FIXTURE_HOLD_SENTINEL, holdOrigin: "ADAPTER_SENTINEL", effectiveSourceState: "FIXTURE_SIMULATION" },
    profile,
  );
  assert(sentinelHold.holdState === "NOT_HELD", "The fixture adapter sentinel resolves to NOT_HELD for simulated data");

  for (const falsey of [null, undefined, "", "   ", 0, false, "false", "FALSE", "N", "0", "no"]) {
    const r = resolveHoldState(
      { rawHold: falsey, holdOrigin: "SOURCE_ROW", effectiveSourceState: "FIXTURE_SIMULATION" },
      profile,
    );
    assert(r.holdState === "UNKNOWN", `Hold value ${JSON.stringify(falsey)} is UNKNOWN, never NOT_HELD`);
  }

  const heldByUnknown = classifyFantasyRecord(
    input({ rawStatus: "STOCK", rawHold: null, holdOrigin: "SOURCE_ROW" }),
    profile,
  );
  assert(heldByUnknown.holdState === "UNKNOWN", "A missing hold value leaves hold UNKNOWN");
  assert(heldByUnknown.available === false, "Unknown hold blocks availability even for a mapped STOCK status");
  assert(heldByUnknown.planningEligible === false, "Unknown hold blocks planning eligibility");
  assert(heldByUnknown.inventoryClass === "EXCLUDED", "Unknown hold excludes the record");
  assert(
    heldByUnknown.exclusionReasons.includes("HOLD_MISSING"),
    "Unknown hold reports why, by code",
  );

  // A status mapping cannot rescue a held record.
  assert(
    classifyFantasyRecord(input({ rawStatus: "STOCK", rawHold: "ANYTHING", holdOrigin: "SOURCE_ROW" }), profile).available === false,
    "A status mapping cannot override hold",
  );

  // =========================================================================
  section("D. The simulation sentinel cannot be used by live data");
  // =========================================================================
  const sentinelFromRow = classifyFantasyRecord(
    input({ rawStatus: "STOCK", rawHold: LEGACY_FIXTURE_HOLD_SENTINEL, holdOrigin: "SOURCE_ROW" }),
    profile,
  );
  assert(sentinelFromRow.available === false, "A provider row spelling the sentinel does not become available");
  assert(
    sentinelFromRow.exclusionReasons.includes("SIMULATION_SENTINEL_FROM_SOURCE_ROW"),
    "A sentinel arriving on a source row is reported as such",
  );

  const liveWithSentinel = classifyFantasyRecord(
    input({ rawStatus: "STOCK", effectiveSourceState: "LIVE_FANTASY" }),
    profile,
  );
  assert(liveWithSentinel.available === false, "A simulation-only profile cannot classify live data as available");
  assert(
    liveWithSentinel.exclusionReasons.includes("SIMULATION_PROFILE_ON_LIVE_DATA"),
    "Applying a simulation profile to live data is reported by code",
  );
  assert(liveWithSentinel.state === "BLOCKED", "Live data under a simulation profile is blocked");

  for (const state of ["LIVE_FANTASY", "LIVE_FANTASY_DEGRADED", "NOT_CONFIGURED"] as const) {
    assert(
      classifyFantasyRecord(input({ rawStatus: "STOCK", effectiveSourceState: state }), profile).available === false,
      `A non-simulated source state (${state}) cannot use the fixture profile`,
    );
  }

  assert((await loadProfileForSourceState("LIVE_FANTASY")) === null, "No profile exists for a live source");
  assert((await loadProfileForSourceState("NOT_CONFIGURED")) === null, "No profile exists for an unconfigured source");
  assert((await loadProfileForSourceState("FIXTURE_SIMULATION")) !== null, "The fixture source does resolve a profile");

  // =========================================================================
  section("E. No profile, or an inactive one, classifies nothing");
  // =========================================================================
  const noProfile = classifyFantasyRecord(input({ rawStatus: "STOCK" }), null);
  assert(noProfile.state === "NOT_CONFIGURED", "With no profile the state is NOT_CONFIGURED, not a guess");
  assert(noProfile.available === false, "With no profile nothing is available");
  assert(noProfile.exclusionReasons.includes("PROFILE_NOT_CONFIGURED"), "Absence of a profile is reported by code");

  const inactive: ClassificationProfile = { ...profile, isActive: false };
  assert(classifyFantasyRecord(input({ rawStatus: "STOCK" }), inactive).available === false, "An inactive profile classifies nothing as available");

  const inactiveMapping: ClassificationProfile = {
    ...profile,
    statusMappings: profile.statusMappings.map((m) => (m.sourceStatus === "STOCK" ? { ...m, isActive: false } : m)),
  };
  const viaInactive = classifyFantasyRecord(input({ rawStatus: "STOCK" }), inactiveMapping);
  assert(viaInactive.available === false, "An inactive status mapping does not classify");
  assert(viaInactive.exclusionReasons.includes("STATUS_MAPPING_INACTIVE"), "An inactive mapping is reported by code");

  // A mapping that contradicts itself is refused rather than half-applied.
  const contradictory: ClassificationProfile = {
    ...profile,
    statusMappings: profile.statusMappings.map((m) =>
      m.sourceStatus === "STOCK" ? { ...m, inventoryClass: "EXCLUDED", countsAvailable: true } : m,
    ),
  };
  const viaContradiction = classifyFantasyRecord(input({ rawStatus: "STOCK" }), contradictory);
  assert(viaContradiction.available === false, "A mapping claiming both available and excluded is refused");
  assert(viaContradiction.exclusionReasons.includes("MAPPING_FLAGS_INCONSISTENT"), "Inconsistent mapping flags are reported");

  const terminalButAvailable: ClassificationProfile = {
    ...profile,
    statusMappings: profile.statusMappings.map((m) =>
      m.sourceStatus === "STOCK" ? { ...m, terminalState: true } : m,
    ),
  };
  assert(
    classifyFantasyRecord(input({ rawStatus: "STOCK" }), terminalButAvailable).available === false,
    "Nothing terminal is available, whatever the mapping claims",
  );

  // =========================================================================
  section("F. Structural and data-quality state excludes a mapped record");
  // =========================================================================
  assert(
    classifyFantasyRecord(input({ rawStatus: "STOCK", structurallyValid: false }), profile).available === false,
    "A structurally invalid record is excluded despite a good status",
  );
  assert(
    classifyFantasyRecord(input({ rawStatus: "STOCK", hasBlockingDataQuality: true }), profile).available === false,
    "A record with a blocking data-quality issue is excluded",
  );
  assert(
    classifyFantasyRecord(input({ rawStatus: "STOCK", structurallyValid: false }), profile).exclusionReasons.includes("STRUCTURALLY_INVALID"),
    "Structural invalidity is reported by code",
  );

  // =========================================================================
  section("G. Mapping versions keep past classifications reproducible");
  // =========================================================================
  const before = await db.fantasyClassificationProfile.findUniqueOrThrow({ where: { code: LEGACY_FIXTURE_PROFILE } });
  assert(before.version >= 1, "The profile carries a version");
  assert(before.applicability === "SIMULATION_ONLY", "The fixture profile is simulation-only");

  const classifiedAtV1 = classifyFantasyRecord(input({ rawStatus: "STOCK" }), profile);
  assert(classifiedAtV1.profileVersion === before.version, "A classification records the profile version that produced it");
  assert(classifiedAtV1.profileCode === LEGACY_FIXTURE_PROFILE, "A classification records the profile code");

  // A record already classified keeps its stored answer; editing the profile does not
  // silently reinterpret it.
  const storedAtV1 = {
    classificationState: "CLASSIFIED",
    holdState: "NOT_HELD",
    inventoryClass: "PHYSICAL_AVAILABLE",
    classificationAvailable: true,
    classificationPlanningEligible: true,
    classificationReasons: null,
    classificationProfile: LEGACY_FIXTURE_PROFILE,
    classificationProfileVersion: before.version,
    currentStatus: "STOCK",
  };
  const changedProfile: ClassificationProfile = {
    ...profile,
    version: before.version + 1,
    statusMappings: profile.statusMappings.map((m) =>
      m.sourceStatus === "STOCK" ? { ...m, countsAvailable: false, inventoryClass: "EXCLUDED" } : m,
    ),
  };
  const reread = resolveEffectiveClassification(storedAtV1, changedProfile);
  assert(reread.fromPersisted === true, "A stored classification is read back, not recomputed");
  assert(reread.available === true, "A past classification is not rewritten by a later mapping change");
  assert(reread.profileVersion === before.version, "The stored classification keeps its original profile version");

  // A record with no stored classification is classified on read by the same service.
  const unstored = {
    classificationState: null,
    holdState: null,
    inventoryClass: null,
    classificationAvailable: null,
    classificationPlanningEligible: null,
    classificationReasons: null,
    classificationProfile: null,
    classificationProfileVersion: null,
    currentStatus: "STOCK",
  };
  const computed = resolveEffectiveClassification(unstored, profile);
  assert(computed.fromPersisted === false, "An unclassified record is classified on read");
  assert(computed.available === true, "On-read classification reaches the same answer for a mapped status");
  assert(
    resolveEffectiveClassification({ ...unstored, currentStatus: "BANANA" }, profile).available === false,
    "On-read classification still fails closed for an unmapped status",
  );
  assert(
    resolveEffectiveClassification({ ...unstored, currentStatus: "STOCK" }, null).available === false,
    "With no profile, an unclassified record is never available",
  );

  // =========================================================================
  section("H. The operational mirror can only restrict, never promote");
  // =========================================================================
  assert(
    resolveEffectiveClassification(unstored, profile, "RESERVED").inventoryClass === "RESERVED",
    "A mirror marked RESERVED restricts an otherwise-available record",
  );
  assert(
    resolveEffectiveClassification(unstored, profile, "RESERVED").available === false,
    "A restricted record is not available",
  );
  assert(
    resolveEffectiveClassification({ ...unstored, currentStatus: "MEMO" }, profile, "PHYSICAL").inventoryClass === "MEMO",
    "A mirror marked PHYSICAL cannot promote a memo record",
  );
  assert(
    resolveEffectiveClassification({ ...unstored, currentStatus: "BANANA" }, profile, "PHYSICAL").available === false,
    "A mirror cannot make an unmapped status available",
  );
  assert(
    resolveEffectiveClassification({ ...unstored, currentStatus: "STOCK" }, profile, "OTHER").inventoryClass === "EXCLUDED",
    "An unrecognised mirror class excludes the record",
  );

  // =========================================================================
  section("I. Mirror gating matches what the removed gate admitted");
  // =========================================================================
  assert(isMirroredInventoryClass("PHYSICAL_AVAILABLE"), "Physically available records get an operational mirror");
  assert(isMirroredInventoryClass("MEMO"), "Memo records get an operational mirror");
  assert(!isMirroredInventoryClass("RESERVED"), "Reserved records are not mirrored, exactly as before");
  assert(!isMirroredInventoryClass("WIP"), "WIP records are not mirrored, exactly as before");
  assert(!isMirroredInventoryClass("EXCLUDED"), "Excluded records are not mirrored");
  assert(
    JSON.stringify([...AVAILABLE_LEGACY_PLANNING_CLASSES]) === JSON.stringify(["PHYSICAL", "PLANNING_AVAILABLE"]),
    "Analytics availability filter is sourced from the classifier",
  );

  // =========================================================================
  section("J. The hardcoded rules are gone from the repository");
  // =========================================================================
  const walk = (dir: string, acc: string[] = []): string[] => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, acc);
      else if (/\.tsx?$/.test(entry.name)) acc.push(full);
    }
    return acc;
  };
  const sources = walk(path.join(process.cwd(), "src"));
  const classificationFile = path.join(process.cwd(), "src", "lib", "fantasy", "classification.ts");

  /**
   * Source with comments removed. The scan below looks for the removed rules as *code*;
   * the modules that replaced them describe what they replaced, and a doc comment is not
   * a classification decision.
   */
  const codeOf = (file: string) =>
    readFileSync(file, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");

  const ternary = sources.filter(
    (f) => /currentStatus === "STOCK"\s*\?\s*"PHYSICAL"\s*:\s*"MEMO"/.test(codeOf(f)),
  );
  assert(ternary.length === 0, `No STOCK -> PHYSICAL, else MEMO ternary remains${ternary.length ? `: ${ternary.join(", ")}` : ""}`);

  const literalPhysical = sources.filter((f) => /planningClass:\s*"PHYSICAL"/.test(codeOf(f)));
  assert(literalPhysical.length === 0, `No unconditional planningClass: "PHYSICAL" remains${literalPhysical.length ? `: ${literalPhysical.join(", ")}` : ""}`);

  const inlineFilter = sources.filter(
    (f) => f !== classificationFile && /planningClass:\s*\{\s*in:\s*\["PHYSICAL"/.test(codeOf(f)),
  );
  assert(inlineFilter.length === 0, `No inline available-planning-class filter remains${inlineFilter.length ? `: ${inlineFilter.join(", ")}` : ""}`);

  const syncSource = readFileSync(path.join(process.cwd(), "src", "lib", "fantasy", "sync-service.ts"), "utf8");
  const syncCode = codeOf(path.join(process.cwd(), "src", "lib", "fantasy", "sync-service.ts"));
  assert(syncSource.includes("classifyRecord("), "The synchronization service calls the classifier");
  assert(
    !/rec\.currentStatus === "STOCK" \|\| rec\.currentStatus === "MEMO"/.test(syncCode),
    "The literal STOCK || MEMO mirror gate is gone",
  );

  const demandSource = readFileSync(path.join(process.cwd(), "src", "lib", "demand", "demand-service.ts"), "utf8");
  const demandCode = codeOf(path.join(process.cwd(), "src", "lib", "demand", "demand-service.ts"));
  assert(demandSource.includes("resolveEffectiveClassification"), "The demand service uses the central classification");
  assert(
    !/inv\.currentStatus === "(STOCK|MEMO|RESERVED)"/.test(demandCode),
    "The demand service no longer reinterprets the raw status",
  );

  const classificationSource = readFileSync(classificationFile, "utf8");
  assert(/typeof window !== "undefined"/.test(classificationSource), "The classifier is server-only");
  assert(!/console\.(log|warn|error|info|debug)/.test(classificationSource), "The classifier logs nothing");

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
