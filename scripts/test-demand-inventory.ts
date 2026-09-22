/**
 * DEMAND & INVENTORY — BEHAVIOURAL, RBAC AND PAGINATION TEST SUITE
 *
 * Runs against the isolated security-test database only (planning_sectest) and
 * refuses to start anywhere else.
 *
 * What this suite proves:
 *   A. WIP classification: the WIP page and the demand engine classify the same
 *      records identically; every stage outcome; missing/inactive BR-WIP-001;
 *      ambiguous attributes; no double counting with polished output or plans.
 *   B. Country positions computed per exact category and never netted; transfer
 *      candidates limited by both sides, advisory, with a real count.
 *   C. Valuation unavailable without an approved model; metadata when configured.
 *   D. Genuine server pagination: first/middle/last page, filtered paging, no
 *      duplicates or gaps, large volume, honest totals.
 *   E. API authorization across the real authenticated route boundary, including
 *      demand-trace lot-level non-disclosure and client-supplied identity being
 *      ignored.
 *   F. Export authorization policy: no table inherits demand.export by default.
 *
 * Usage: npx tsx scripts/with-sectest-db.ts npx tsx scripts/test-demand-inventory.ts
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { db } from "../src/lib/db";
import { SECTEST_DB } from "../tests/security/test-db";
import { call, makeUser } from "../tests/security/helpers";
import { resetRateLimits } from "../src/lib/api/rate-limit";
import { PERMISSIONS, type Permission } from "../src/lib/auth/permissions";
import { runDemandCalculation } from "../src/lib/demand/demand-service";
import { classifyCurrentWip, loadWipPolicy, normalizeWipStage } from "../src/lib/demand/wip-classification";
import { analyzeTransfers } from "../src/lib/analytics/stock-position";
import { loadValuationPolicy } from "../src/lib/analytics/valuation";
import { CONFIRMED_WEIGHT_BANDS } from "../src/lib/domain/diamond-rules";

// Route handlers — exercised through withApi, so authentication, permission checks,
// rate limiting, validation and error mapping all run exactly as in production.
import { GET as wipGET } from "../src/app/api/analysis/wip/route";
import { GET as traceGET } from "../src/app/api/analysis/demand-trace/route";
import { GET as countriesGET } from "../src/app/api/analysis/countries/route";
import { GET as transfersGET } from "../src/app/api/analysis/transfer-candidates/route";
import { GET as polishedGET } from "../src/app/api/analysis/polished/route";
import { GET as agingGET } from "../src/app/api/analysis/aging/route";
import { GET as agingDashGET } from "../src/app/api/analysis/aging-dashboard/route";
import { GET as customersGET } from "../src/app/api/analysis/customers/route";
import { GET as timelineGET } from "../src/app/api/analysis/customers/[id]/timeline/route";
import { GET as ordersGET } from "../src/app/api/analysis/orders/route";
import { GET as memoGET } from "../src/app/api/analysis/memo/route";
import { GET as reorderGET } from "../src/app/api/analysis/reorder-signals/route";
import { GET as historyGET } from "../src/app/api/demand/history/route";
import { GET as exportGET } from "../src/app/api/demand/export/route";
import { POST as demandRunPOST } from "../src/app/api/demand/run/route";
import { POST as demandUnlockPOST } from "../src/app/api/demand/run/unlock/route";

// ---------------------------------------------------------------------------
// Safety: this suite truncates tables, so it must never see a real database.
// ---------------------------------------------------------------------------
const url = process.env.DATABASE_URL ?? "";
if (!url || !new URL(url).pathname.startsWith(`/${SECTEST_DB}`)) {
  console.error(`REFUSING TO RUN: DATABASE_URL must point at the isolated ${SECTEST_DB} database.`);
  console.error("Use: npx tsx scripts/with-sectest-db.ts npx tsx scripts/test-demand-inventory.ts");
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

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY);

// ---------------------------------------------------------------------------
// Fixture construction
// ---------------------------------------------------------------------------
const TABLES = [
  "DemandMetricTraceItem",
  "DemandMetric",
  "DemandRun",
  "DemandCalculationLock",
  "DataQualityIssue",
  "RequirementAllocation",
  "Requirement",
  "PlanOptionPiece",
  "PlanOption",
  "PlanVersion",
  "PlanningCase",
  "RoughReservation",
  "RoughStone",
  "LotHistoryRecord",
  "LotMasterRecord",
  "PolishedStone",
  "SalesOrderLine",
  "SalesOrder",
  "MemoRecord",
  "SalesRecord",
  "Customer",
  "PlanningCategory",
  "WeightBand",
  "LabMapping",
  "ShapeMapping",
  "BusinessRule",
  "Session",
  "User",
  "AuditLog",
];

async function resetAll() {
  await db.$executeRawUnsafe(`TRUNCATE ${TABLES.map((t) => `"${t}"`).join(", ")} CASCADE`);
  resetRateLimits();
}

interface Fixture {
  bandRound: { id: string; code: string; label: string };
  bandBig: { id: string; code: string; label: string };
  customerId: string;
}

async function seedMasterData(): Promise<Fixture> {
  const bands = CONFIRMED_WEIGHT_BANDS.slice(0, 6);
  for (const b of bands) {
    await db.weightBand.create({
      data: { code: b.code, label: b.label, minCt: b.minCt, maxCt: b.maxCt, sortOrder: b.sortOrder, active: true },
    });
  }
  for (const raw of ["GIA", ""]) {
    await db.labMapping.create({ data: { rawLab: raw, normalizedLab: raw === "" ? "Non-Cert" : "GIA", active: true } });
  }
  for (const s of ["ROUND", "OVAL"]) {
    await db.shapeMapping.create({ data: { rawShape: s, normalizedShape: s, active: true } });
  }

  const bandRound = (await db.weightBand.findFirstOrThrow({ where: { code: bands[0].code } }));
  const bandBig = (await db.weightBand.findFirstOrThrow({ where: { code: bands[4].code } }));

  const customer = await db.customer.create({
    data: { customerCode: "CUST-T1", name: "Test Customer One", country: "IN", branch: "Surat" },
  });

  return {
    bandRound: { id: bandRound.id, code: bandRound.code, label: bandRound.label },
    bandBig: { id: bandBig.id, code: bandBig.code, label: bandBig.label },
    customerId: customer.id,
  };
}

let lotSeq = 0;
async function makeSale(o: { weight: number; shape?: string; lab?: string; customerId: string; days?: number }) {
  lotSeq++;
  const lotId = `SALE-${lotSeq}`;
  const docDate = daysAgo(o.days ?? 10);
  await db.lotMasterRecord.create({
    data: {
      lotId,
      entityType: "POLISHED",
      currentStatus: "SOLD",
      statusEffectiveDate: docDate,
      docDate,
      shape: o.shape ?? "ROUND",
      shapeNormalized: o.shape ?? "ROUND",
      weight: o.weight,
      labRaw: o.lab ?? "GIA",
      labNormalized: o.lab ?? "GIA",
      country: "IN",
      branch: "Surat",
      roughOrPolished: "POLISHED",
      isCurrent: true,
      removalReason: "EXPLICIT_SALE",
      lastSyncBatchId: "T-BATCH",
    },
  });
  await db.lotHistoryRecord.create({
    data: {
      lotId,
      version: 1,
      status: "SOLD",
      docDate,
      statusEffectiveDate: docDate,
      shape: o.shape ?? "ROUND",
      shapeNormalized: o.shape ?? "ROUND",
      weight: o.weight,
      labRaw: o.lab ?? "GIA",
      labNormalized: o.lab ?? "GIA",
      country: "IN",
      branch: "Surat",
      roughOrPolished: "POLISHED",
      isCurrent: true,
      removalReason: "EXPLICIT_SALE",
      syncBatchId: "T-BATCH",
      checkpoint: 1,
    },
  });
  return lotId;
}

async function makeWip(o: {
  lotId: string;
  stage: string;
  weight: number;
  shape?: string;
  lab?: string | null;
  country?: string;
  branch?: string;
}) {
  return db.lotMasterRecord.create({
    data: {
      lotId: o.lotId,
      entityType: "WIP",
      currentStatus: o.stage,
      statusEffectiveDate: daysAgo(3),
      docDate: daysAgo(3),
      wipStage: o.stage,
      shape: o.shape ?? "ROUND",
      shapeNormalized: o.shape ?? "ROUND",
      weight: o.weight,
      labRaw: o.lab === null ? null : o.lab ?? "GIA",
      labNormalized: o.lab === null ? null : o.lab ?? "GIA",
      country: o.country ?? "IN",
      branch: o.branch ?? "Surat",
      roughOrPolished: "WIP",
      isCurrent: true,
      lastSyncBatchId: "T-BATCH",
    },
  });
}

async function makePolished(o: {
  lotId: string;
  weight: number;
  bandId: string;
  shape?: string;
  lab?: string;
  country?: string;
  branch?: string;
  planningClass?: string;
  lastUpdated?: Date;
}) {
  return db.polishedStone.create({
    data: {
      fantasyLotId: o.lotId,
      country: o.country ?? "IN",
      branch: o.branch ?? "Surat",
      fantasyStatus: "IN_STOCK",
      shape: o.shape ?? "ROUND",
      shapeNormalized: o.shape ?? "ROUND",
      labRaw: o.lab ?? "GIA",
      labNormalized: o.lab ?? "GIA",
      weight: o.weight,
      weightBandId: o.bandId,
      planningClass: o.planningClass ?? "PHYSICAL",
      lastUpdated: o.lastUpdated ?? daysAgo(5),
    },
  });
}

async function setWipRule(o: { status: string; stages?: string[] }) {
  await db.businessRule.deleteMany({ where: { ruleId: "BR-WIP-001" } });
  await db.businessRule.create({
    data: {
      ruleId: "BR-WIP-001",
      domain: "WIP",
      name: "WIP Contribution to Shortage",
      version: "1.0",
      effectiveDate: daysAgo(30),
      status: o.status,
      configuration: o.stages ? JSON.stringify({ eligibleStages: o.stages }) : null,
    },
  });
}

// ---------------------------------------------------------------------------
async function main() {
  console.log("===============================================================================");
  console.log("DEMAND & INVENTORY — WIP, COUNTRY, VALUATION, PAGINATION & API RBAC TEST SUITE");
  console.log("===============================================================================");

  await resetAll();
  const fx = await seedMasterData();

  // =========================================================================
  section("A1. WIP stage normalization is deterministic and not substring-based");
  // =========================================================================
  assert(normalizeWipStage("WIP_POLISHING") === "POLISHING", "WIP_POLISHING normalizes to POLISHING");
  assert(normalizeWipStage("wip polishing") === "POLISHING", "'wip polishing' normalizes to POLISHING");
  assert(normalizeWipStage("Polishing") === "POLISHING", "'Polishing' normalizes to POLISHING");
  assert(normalizeWipStage("PRE_POLISHING") === "PRE_POLISHING", "PRE_POLISHING stays a distinct stage (no substring match)");
  assert(normalizeWipStage(null) === "UNKNOWN", "null stage normalizes to UNKNOWN");

  // =========================================================================
  section("A2. Missing BR-WIP-001 produces an explicit NOT_CONFIGURED state");
  // =========================================================================
  // 6 sales in 90 days -> monthly avg 2 -> target 4; no stock -> shortage 4.
  for (let i = 0; i < 6; i++) await makeSale({ weight: 1.05, customerId: fx.customerId, days: 10 + i });
  await makeWip({ lotId: "WIP-POL-1", stage: "WIP_POLISHING", weight: 1.05 });
  await makeWip({ lotId: "WIP-POL-2", stage: "WIP_POLISHING", weight: 1.05 });

  let policy = await loadWipPolicy(db);
  assert(policy.status === "NOT_CONFIGURED", "Policy is NOT_CONFIGURED when BR-WIP-001 does not exist");
  assert(policy.reason === "RULE_MISSING", "Reason is RULE_MISSING");
  assert(policy.eligibleStages.length === 0, "No eligible stages are substituted when the rule is missing");
  assert(policy.appliesCoverage === false, "Coverage is not applied without a confirmed rule");

  let run = await runDemandCalculation({ actor: "test" });
  let cat = run.categories.find((c) => c.category === `GIA|ROUND|${fx.bandRound.label}`);
  assert(cat?.sales90d === 6, `90-day sales counted: expected 6, got ${cat?.sales90d}`);
  assert(cat?.roundedTarget === 4, `Target = round_half_up((6/3)*2) = 4, got ${cat?.roundedTarget}`);
  assert(cat?.physicalShortage === 4, `Physical shortage = 4, got ${cat?.physicalShortage}`);
  assert(cat?.wipCoverage === 0, "No WIP coverage is applied while the policy is NOT_CONFIGURED");
  assert(cat?.unallocatedWip === 2, `Both WIP lots are reported as unallocated, got ${cat?.unallocatedWip}`);
  assert(cat?.pipelineNeed === 4, "Pipeline requirement is not reduced by WIP when the policy is unavailable");
  assert(run.wipPolicy.status === "NOT_CONFIGURED", "Run result carries the NOT_CONFIGURED policy");

  const storedRun = await db.demandRun.findUniqueOrThrow({ where: { id: run.runId } });
  assert(storedRun.wipPolicyStatus === "NOT_CONFIGURED", "Run row records the WIP policy status it applied");

  // =========================================================================
  section("A3. A CONFIRMED rule with no eligible stages is still NOT_CONFIGURED");
  // =========================================================================
  await setWipRule({ status: "CONFIRMED", stages: [] });
  policy = await loadWipPolicy(db);
  assert(policy.status === "NOT_CONFIGURED" && policy.reason === "NO_ELIGIBLE_STAGES", "CONFIRMED rule with an empty stage list stays NOT_CONFIGURED");

  await setWipRule({ status: "OPEN", stages: ["POLISHING"] });
  policy = await loadWipPolicy(db);
  assert(policy.status === "NOT_CONFIGURED" && policy.reason === "RULE_NOT_CONFIRMED", "An OPEN rule does not activate WIP coverage");

  // =========================================================================
  section("A4. Confirmed policy: every stage outcome is classified correctly");
  // =========================================================================
  await setWipRule({ status: "CONFIRMED", stages: ["POLISHING", "GRADING"] });
  await makeWip({ lotId: "WIP-PLAN-1", stage: "WIP_PLANNING", weight: 1.05 });          // ineligible stage
  await makeWip({ lotId: "WIP-AMB-1", stage: "WIP_POLISHING", weight: 1.05, shape: "MYSTERY" }); // ambiguous shape
  await makeWip({ lotId: "WIP-DONE-1", stage: "WIP_COMPLETED", weight: 1.05 });          // completed
  await makeWip({ lotId: "WIP-MIRROR-1", stage: "WIP_POLISHING", weight: 1.05 });        // already polished
  await makePolished({ lotId: "WIP-MIRROR-1", weight: 1.05, bandId: fx.bandRound.id, planningClass: "PHYSICAL" });

  // One genuine piece of finished stock: canonical record plus its operational mirror.
  await db.lotMasterRecord.create({
    data: {
      lotId: "STOCK-1",
      entityType: "POLISHED",
      currentStatus: "STOCK",
      statusEffectiveDate: daysAgo(5),
      docDate: daysAgo(5),
      shape: "ROUND",
      shapeNormalized: "ROUND",
      weight: 1.05,
      labRaw: "GIA",
      labNormalized: "GIA",
      country: "IN",
      branch: "Surat",
      roughOrPolished: "POLISHED",
      isCurrent: true,
      lastSyncBatchId: "T-BATCH",
    },
  });
  await makePolished({ lotId: "STOCK-1", weight: 1.05, bandId: fx.bandRound.id, planningClass: "PHYSICAL" });

  const classified = await classifyCurrentWip(db);
  const outcomeOf = (lotId: string) => classified.results.find((r) => r.lotId === lotId)?.outcome;
  assert(outcomeOf("WIP-POL-1") === "ELIGIBLE", "Configured eligible stage is ELIGIBLE");
  assert(outcomeOf("WIP-PLAN-1") === "INELIGIBLE_STAGE", "Stage outside the configured list is INELIGIBLE_STAGE");
  assert(outcomeOf("WIP-AMB-1") === "AMBIGUOUS", "Unmapped shape is AMBIGUOUS, never mapped into a category");
  assert(outcomeOf("WIP-DONE-1") === "COMPLETED", "Completed manufacturing is COMPLETED");
  assert(outcomeOf("WIP-MIRROR-1") === "ALREADY_POLISHED", "Output already in polished stock is ALREADY_POLISHED");
  assert(
    classified.results.find((r) => r.lotId === "WIP-AMB-1")?.category === null,
    "Ambiguous WIP carries no planning category",
  );
  assert(
    classified.summary.eligiblePieces === 2,
    `Exactly the two polishing lots count as coverage, got ${classified.summary.eligiblePieces}`,
  );
  assert(
    classified.summary.unallocatedPieces === 2,
    `Ineligible + ambiguous are unallocated (2), got ${classified.summary.unallocatedPieces}`,
  );
  assert(
    classified.summary.completedPieces === 1 && classified.summary.alreadyPolishedPieces === 1,
    "Completed and already-polished pieces are reported separately and excluded from coverage",
  );

  // =========================================================================
  section("A5. Demand engine and WIP page reconcile from the same classifier");
  // =========================================================================
  run = await runDemandCalculation({ actor: "test" });
  cat = run.categories.find((c) => c.category === `GIA|ROUND|${fx.bandRound.label}`);
  assert(cat?.wipCoverage === 2, `Engine applies 2 eligible WIP pieces, got ${cat?.wipCoverage}`);
  assert(cat?.availableStock === 1, `Finished stock counts once as available stock, got ${cat?.availableStock}`);
  assert(cat?.physicalShortage === 3, `Shortage = 4 - 1 = 3, got ${cat?.physicalShortage}`);
  assert(cat?.pipelineNeed === 1, `Pipeline = 3 - 2 = 1, got ${cat?.pipelineNeed}`);

  const admin = await makeUser("wip-admin", "ADMIN");
  let res = await call(wipGET, { path: "/api/analysis/wip", cookie: admin.cookie });
  assert(res.status === 200, "WIP API responds to an authorized caller");
  const totalEngineWip = (await db.demandMetric.aggregate({ where: { runId: run.runId }, _sum: { wipCoverage: true } }))._sum.wipCoverage ?? 0;
  assert(
    res.json.eligibleWipPieces === totalEngineWip,
    `WIP page eligible pieces (${res.json.eligibleWipPieces}) equals engine WIP coverage (${totalEngineWip})`,
  );
  assert(res.json.policy.status === "CONFIGURED", "WIP API reports the configured policy");
  assert(
    Array.isArray(res.json.policy.eligibleStages) && res.json.policy.eligibleStages.join(",") === "GRADING,POLISHING",
    "WIP API returns the configured eligible stages",
  );

  const dqAmbiguous = await db.dataQualityIssue.findFirst({ where: { recordId: "WIP-AMB-1" } });
  assert(dqAmbiguous !== null, "Ambiguous WIP raises a data quality issue");
  const quarantined = await db.demandMetricTraceItem.findFirst({
    where: { runId: run.runId, lotId: "WIP-AMB-1" },
  });
  assert(
    quarantined?.planningCategory === "UNMAPPED_QUARANTINE",
    `Ambiguous WIP is quarantined, not placed in a business category (got ${quarantined?.planningCategory})`,
  );

  // =========================================================================
  section("A6. Approved plan coverage never double-counts WIP or polished output");
  // =========================================================================
  const rough = await db.roughStone.create({
    data: { fantasyRoughId: "RGH-T1", kapan: "K1", packet: "P1", stoneName: "S1", roughWeight: 10, country: "IN", branch: "Surat", fantasyStatus: "IN_STOCK" },
  });
  const pcase = await db.planningCase.create({
    data: { caseCode: "PC-T1", roughId: rough.id, stoneName: "S1", kapan: "K1", packet: "P1", originalRoughWeight: 10, planner: "planner", status: "APPROVED" },
  });
  const pver = await db.planVersion.create({ data: { planningCaseId: pcase.id, versionNumber: 1, createdBy: "planner", status: "APPROVED" } });
  const popt = await db.planOption.create({
    data: { optionCode: "OPT-T1", versionId: pver.id, optionNumber: 1, expectedPieces: 2, expectedTotalWeight: 2.1, yieldPct: 40, selected: true, approvalStatus: "APPROVED" },
  });
  await db.planOptionPiece.create({
    data: { pieceCode: "PC-T1-1", planOptionId: popt.id, sequence: 1, expectedShape: "ROUND", expectedWeight: 1.05, certificationIntent: "GIA" },
  });
  await db.planOptionPiece.create({
    // Already became WIP lot WIP-POL-1: its coverage is counted as WIP, not twice.
    data: { pieceCode: "PC-T1-2", planOptionId: popt.id, sequence: 2, expectedShape: "ROUND", expectedWeight: 1.05, certificationIntent: "GIA", fantasyChildId: "WIP-POL-1" },
  });

  run = await runDemandCalculation({ actor: "test" });
  cat = run.categories.find((c) => c.category === `GIA|ROUND|${fx.bandRound.label}`);
  assert(cat?.approvedPlanCoverage === 1, `Only the piece not already tracked as WIP counts (expected 1, got ${cat?.approvedPlanCoverage})`);
  assert(cat?.remainingUnplanned === 0, `Remaining unplanned = MAX(0, 1 - 1) = 0, got ${cat?.remainingUnplanned}`);

  await db.planOptionPiece.update({ where: { pieceCode: "PC-T1-1" }, data: { actualPolishedLotId: "WIP-MIRROR-1" } });
  run = await runDemandCalculation({ actor: "test" });
  cat = run.categories.find((c) => c.category === `GIA|ROUND|${fx.bandRound.label}`);
  assert(cat?.approvedPlanCoverage === 0, "A piece already linked to polished output is excluded from plan coverage");
  await db.planOptionPiece.update({ where: { pieceCode: "PC-T1-1" }, data: { actualPolishedLotId: null } });

  // =========================================================================
  section("B. Country positions are per category and transfers are limited by both sides");
  // =========================================================================
  // IN: excess of GIA|ROUND (stock 5, target 2). HK: shortage of the same category (target 4, stock 0).
  // IN also has a shortage in a different category, which must NOT be netted against its excess.
  await db.requirement.create({
    data: { requirementCode: "REQ-IN-1", type: "STOCK_REPLENISHMENT", groupCode: "G", companyCode: "C", country: "IN", branch: "Surat", labNormalized: "GIA", shape: "ROUND", weightBandId: fx.bandRound.id, requiredQty: 2 },
  });
  await db.requirement.create({
    data: { requirementCode: "REQ-IN-2", type: "STOCK_REPLENISHMENT", groupCode: "G", companyCode: "C", country: "IN", branch: "Surat", labNormalized: "GIA", shape: "OVAL", weightBandId: fx.bandBig.id, requiredQty: 7 },
  });
  await db.requirement.create({
    data: { requirementCode: "REQ-HK-1", type: "STOCK_REPLENISHMENT", groupCode: "G", companyCode: "C", country: "HK", branch: "Central HK", labNormalized: "GIA", shape: "ROUND", weightBandId: fx.bandRound.id, requiredQty: 4 },
  });
  for (let i = 0; i < 5; i++) {
    await makePolished({ lotId: `IN-STOCK-${i}`, weight: 1.05, bandId: fx.bandRound.id, country: "IN", branch: "Surat" });
  }

  const analysis = await analyzeTransfers(db);
  const inRound = analysis.positions.find((p) => p.country === "IN" && p.shape === "ROUND" && p.weightBandCode === fx.bandRound.code);
  const inOval = analysis.positions.find((p) => p.country === "IN" && p.shape === "OVAL");
  const hkRound = analysis.positions.find((p) => p.country === "HK" && p.shape === "ROUND");

  assert(inRound !== undefined && inOval !== undefined && hkRound !== undefined, "Positions exist per country and category");
  assert(inRound!.excess === 5, `IN GIA|ROUND excess = 7 stock - 2 target = 5, got ${inRound!.excess}`);
  assert(inOval!.physicalShortage === 7, `IN GIA|OVAL shortage = 7 (not netted against the ROUND excess), got ${inOval!.physicalShortage}`);
  assert(hkRound!.remainingUnplanned === 4, `HK GIA|ROUND remaining shortage = 4, got ${hkRound!.remainingUnplanned}`);

  const candidate = analysis.transfers.candidates.find((c) => c.fromCountry === "IN" && c.toCountry === "HK");
  assert(candidate !== undefined, "A cross-country candidate is produced for the matching category");
  assert(candidate!.transferQty === 4, `Transfer qty = MIN(excess 4, shortage 4) = 4, got ${candidate!.transferQty}`);
  assert(
    analysis.transfers.candidates.every((c) => c.fromCountry !== c.toCountry),
    "No candidate transfers a category to the same country",
  );
  assert(
    analysis.transfers.candidates.every((c) => c.category.includes("ROUND")),
    "Candidates only pair identical categories",
  );
  assert(analysis.transfers.status === "ADVISORY_UNCONFIRMED", "Transfer status is advisory while BR-TRANSFER-001 is unconfirmed");
  assert(analysis.transfers.candidateCount === analysis.transfers.candidates.length, "Candidate count is the real number of pairs");
  assert(analysis.transfers.autoExecuted === false, "Nothing is executed automatically");

  const beforeCounts = {
    requirements: await db.requirement.count(),
    reservations: await db.roughReservation.count(),
    orders: await db.salesOrder.count(),
  };
  res = await call(transfersGET, { path: "/api/analysis/transfer-candidates", cookie: admin.cookie });
  assert(res.status === 200 && res.json.summary.candidateCount === analysis.transfers.candidateCount, "Transfer API returns the shared service result");
  assert(
    (await db.requirement.count()) === beforeCounts.requirements &&
      (await db.roughReservation.count()) === beforeCounts.reservations &&
      (await db.salesOrder.count()) === beforeCounts.orders,
    "Reading transfer candidates creates no requirement, reservation or order",
  );

  res = await call(countriesGET, { path: "/api/analysis/countries", cookie: admin.cookie });
  const inRow = res.json.rows.find((r: { country: string }) => r.country === "IN");
  assert(res.status === 200 && inRow !== undefined, "Country API returns country rows");
  assert(
    inRow.physicalShortage === 7 && inRow.excess === 5,
    `Country roll-up sums category results without netting (shortage ${inRow.physicalShortage}, excess ${inRow.excess})`,
  );
  assert(typeof inRow.transferCandidates === "number", "Country rows carry a real transfer candidate count");

  // Transfer analysis with no positions at all reports UNAVAILABLE, never zero.
  const savedRequirements = await db.requirement.findMany();
  const savedPolished = await db.polishedStone.findMany();
  const savedWip = await db.lotMasterRecord.findMany({ where: { roughOrPolished: "WIP" } });
  const savedPieces = await db.planOptionPiece.findMany();
  await db.requirement.deleteMany({});
  await db.polishedStone.deleteMany({});
  await db.lotMasterRecord.deleteMany({ where: { roughOrPolished: "WIP" } });
  await db.planOptionPiece.deleteMany({});
  const emptyAnalysis = await analyzeTransfers(db);
  assert(emptyAnalysis.transfers.status === "UNAVAILABLE", "Transfer analysis reports UNAVAILABLE when no positions can be derived");
  assert(emptyAnalysis.transfers.candidateCount === null, "Candidate count is null (not 0) when the analysis cannot run");
  for (const r of savedRequirements) await db.requirement.create({ data: { ...r, id: undefined } });
  for (const p of savedPolished) await db.polishedStone.create({ data: { ...p, id: undefined } });
  for (const w of savedWip) await db.lotMasterRecord.create({ data: { ...w, id: undefined } });
  for (const pc of savedPieces) await db.planOptionPiece.create({ data: { ...pc, id: undefined } });

  // =========================================================================
  section("C. Valuation is unavailable until an approved model exists");
  // =========================================================================
  let valuation = await loadValuationPolicy(db);
  assert(valuation.status === "NOT_CONFIGURED" && valuation.reason === "RULE_MISSING", "Valuation is NOT_CONFIGURED without BR-VALUATION-001");

  res = await call(polishedGET, { path: "/api/analysis/polished?dimension=lab", cookie: admin.cookie });
  assert(res.status === 200, "Polished API responds");
  assert(res.json.valuation.status === "NOT_CONFIGURED", "Polished API reports valuation as NOT_CONFIGURED");
  assert(
    res.json.rows.every((r: { estimatedValue: number | null }) => r.estimatedValue === null),
    "No monetary value is invented when no model is configured",
  );
  assert(res.json.summary.estimatedValue === null, "Summary value is null, not zero, when valuation is unavailable");
  assert(res.json.summary.pieces > 0 && res.json.summary.carats > 0, "Pieces and carats are still reported without valuation");

  await db.businessRule.create({
    data: {
      ruleId: "BR-VALUATION-001",
      domain: "VALUATION",
      name: "Polished valuation model",
      version: "2.0",
      effectiveDate: daysAgo(10),
      status: "CONFIRMED",
      configuration: JSON.stringify({
        currency: "USD",
        priceSource: "TEST-FIXTURE-PRICE-LIST",
        prices: [
          { lab: "GIA", shape: "ROUND", pricePerCarat: 1000 },
          { lab: "GIA", pricePerCarat: 500 },
        ],
      }),
    },
  });
  valuation = await loadValuationPolicy(db);
  assert(valuation.status === "CONFIGURED" && valuation.modelVersion === "2.0", "An approved model activates valuation with its version");
  assert(valuation.currency === "USD" && valuation.priceSource === "TEST-FIXTURE-PRICE-LIST", "Currency and price source are returned with the model");

  res = await call(polishedGET, { path: "/api/analysis/polished?dimension=lab", cookie: admin.cookie });
  assert(res.json.valuation.status === "CONFIGURED" && res.json.valuation.isEstimate === true, "Configured valuation is still labelled an estimate");
  const giaRow = res.json.rows.find((r: { dimension: string }) => r.dimension === "GIA");
  assert(giaRow && giaRow.estimatedValue !== null && giaRow.estimatedValue > 0, "Values appear once an approved model exists");

  await db.businessRule.update({ where: { ruleId: "BR-VALUATION-001" }, data: { status: "PROPOSED" } });
  valuation = await loadValuationPolicy(db);
  assert(valuation.status === "NOT_CONFIGURED" && valuation.reason === "RULE_NOT_CONFIRMED", "An unconfirmed model stops producing values");
  await db.businessRule.update({ where: { ruleId: "BR-VALUATION-001" }, data: { status: "CONFIRMED" } });

  // =========================================================================
  section("D. Genuine server pagination");
  // =========================================================================
  // 120 customers, each with memo exposure, across two countries.
  for (let i = 0; i < 120; i++) {
    const country = i % 2 === 0 ? "IN" : "HK";
    const c = await db.customer.create({
      data: {
        customerCode: `PAGE-${String(i).padStart(3, "0")}`,
        name: `Paged Customer ${String(i).padStart(3, "0")}`,
        country,
        branch: country === "IN" ? "Surat" : "Central HK",
      },
    });
    await db.memoRecord.create({
      data: {
        lotId: `MEMO-${i}`,
        memoDate: daysAgo(i % 200),
        customerId: c.id,
        country,
        branch: country === "IN" ? "Surat" : "Central HK",
        shape: "ROUND",
        weight: 1.05,
        labNormalized: "GIA",
        memoValueUsd: 1000 + i,
        status: "OPEN",
        memoAgeDays: i % 200,
      },
    });
  }

  const customerTotal = await db.customer.count();
  const seen = new Set<string>();
  let pageCount = 0;
  let lastPageRows = 0;
  for (let page = 1; page <= 10; page++) {
    const r = await call(customersGET, { path: `/api/analysis/customers?page=${page}&pageSize=25&sort=name`, cookie: admin.cookie });
    if (page === 1) {
      assert(r.json.total === customerTotal, `Customer total is the server-side count (${r.json.total} vs ${customerTotal})`);
      assert(r.json.rows.length === 25, `First page returns exactly pageSize rows, got ${r.json.rows.length}`);
    }
    for (const row of r.json.rows) seen.add(row.id);
    pageCount++;
    lastPageRows = r.json.rows.length;
    if (!r.json.hasMore) break;
  }
  assert(seen.size === customerTotal, `Every customer appears exactly once across pages (${seen.size} of ${customerTotal})`);
  assert(pageCount === Math.ceil(customerTotal / 25), `Paging walked ${Math.ceil(customerTotal / 25)} pages, got ${pageCount}`);
  assert(lastPageRows === customerTotal % 25 || customerTotal % 25 === 0, "Last page returns the remainder, not a full page");

  const mid = await call(customersGET, { path: "/api/analysis/customers?page=3&pageSize=25&sort=name", cookie: admin.cookie });
  assert(mid.json.rows.length === 25 && mid.json.page === 3 && mid.json.hasMore === true, "A middle page reports its own page number and that more remain");

  const filtered = await call(customersGET, { path: "/api/analysis/customers?country=HK&page=1&pageSize=25&sort=name", cookie: admin.cookie });
  const hkCount = await db.customer.count({ where: { country: "HK" } });
  assert(filtered.json.total === hkCount, `Filters are applied before paging (total ${filtered.json.total} vs ${hkCount})`);
  assert(
    filtered.json.rows.every((r: { country: string }) => r.country === "HK"),
    "A filtered page contains only matching rows",
  );

  const search = await call(customersGET, { path: "/api/analysis/customers?q=PAGE-001&page=1&pageSize=25", cookie: admin.cookie });
  assert(search.json.total === 1 && search.json.rows[0].customerCode === "PAGE-001", "Server-side search filters before paging");

  const memoP1 = await call(memoGET, { path: "/api/analysis/memo?page=1&pageSize=40", cookie: admin.cookie });
  const memoTotal = await db.memoRecord.count();
  assert(memoP1.json.total === memoTotal, `Memo total is the server count (${memoP1.json.total} vs ${memoTotal})`);
  assert(memoP1.json.totalQty === memoTotal, "Memo aggregate covers the whole filtered set, not the page");
  assert(memoP1.json.rows.length === 40, "Memo page returns pageSize rows");
  const memoLast = await call(memoGET, { path: `/api/analysis/memo?page=${Math.ceil(memoTotal / 40)}&pageSize=40`, cookie: admin.cookie });
  assert(memoLast.json.hasMore === false, "The last memo page reports hasMore = false");

  const memoFiltered = await call(memoGET, { path: "/api/analysis/memo?country=HK&page=1&pageSize=40", cookie: admin.cookie });
  const memoHk = await db.memoRecord.count({ where: { country: "HK" } });
  assert(memoFiltered.json.total === memoHk, "Memo filters apply before paging");

  const agingRes = await call(agingGET, { path: "/api/analysis/aging?page=1&pageSize=5", cookie: admin.cookie });
  assert(agingRes.status === 200 && typeof agingRes.json.total === "number", "Aging API returns a paginated lot list with a real total");
  assert(agingRes.json.buckets.length === 6, "Aging buckets are aggregated in the database");

  const reorderRes = await call(reorderGET, { path: "/api/analysis/reorder-signals?page=1&pageSize=10", cookie: admin.cookie });
  assert(reorderRes.status === 200 && reorderRes.json.total >= 120, "Reorder signals are paginated with a real total");
  assert(reorderRes.json.rows.length === 10, "Reorder signals return one page of rows");
  assert(reorderRes.json.advisory === true, "Reorder signals stay advisory");

  const historyRes = await call(historyGET, { path: "/api/demand/history?page=1&pageSize=2", cookie: admin.cookie });
  assert(historyRes.status === 200 && historyRes.json.rows.length <= 2, "Demand history is paginated");
  assert(historyRes.json.total >= 4, "Demand history reports the total number of runs");

  const timelineRes = await call(timelineGET, {
    path: `/api/analysis/customers/${fx.customerId}/timeline?page=1&pageSize=5`,
    cookie: admin.cookie,
    params: { id: fx.customerId },
  });
  assert(timelineRes.status === 200 && timelineRes.json.monthly.length === 12, "Customer timeline returns 12 aggregated months");
  assert(typeof timelineRes.json.total === "number", "Customer timeline transactions are paginated with a total");

  const ordersRes = await call(ordersGET, { path: "/api/analysis/orders?page=1&pageSize=10", cookie: admin.cookie });
  assert(ordersRes.status === 200 && typeof ordersRes.json.total === "number", "Orders API returns a real total");

  const dashRes = await call(agingDashGET, { path: "/api/analysis/aging-dashboard?page=1&pageSize=10", cookie: admin.cookie });
  assert(dashRes.status === 200 && typeof dashRes.json.total === "number", "Aging dashboard paginates its slow-moving list");

  // =========================================================================
  section("E. API authorization across the real authenticated route boundary");
  // =========================================================================
  resetRateLimits();
  const viewer = await makeUser("rbac-viewer", "VIEWER");
  const analyst = await makeUser("rbac-analyst", "DATA_ANALYST");
  const planner = await makeUser("rbac-planner", "PLANNER");
  const superAdmin = await makeUser("rbac-super", "SUPER_ADMIN");
  const salesMgr = await makeUser("rbac-sales", "SALES_MANAGER");

  // Unauthenticated
  assert((await call(demandRunPOST, { method: "POST", path: "/api/demand/run", body: {} })).status === 401, "POST /api/demand/run rejects an anonymous caller");
  assert((await call(demandUnlockPOST, { method: "POST", path: "/api/demand/run/unlock", body: { reason: "test reason" } })).status === 401, "POST /api/demand/run/unlock rejects an anonymous caller");
  assert((await call(exportGET, { path: "/api/demand/export" })).status === 401, "GET /api/demand/export rejects an anonymous caller");
  assert((await call(traceGET, { path: "/api/analysis/demand-trace" })).status === 401, "GET /api/analysis/demand-trace rejects an anonymous caller");
  assert((await call(wipGET, { path: "/api/analysis/wip" })).status === 401, "GET /api/analysis/wip rejects an anonymous caller");
  assert((await call(customersGET, { path: "/api/analysis/customers" })).status === 401, "GET /api/analysis/customers rejects an anonymous caller");
  assert((await call(ordersGET, { path: "/api/analysis/orders" })).status === 401, "GET /api/analysis/orders rejects an anonymous caller");
  assert((await call(memoGET, { path: "/api/analysis/memo" })).status === 401, "GET /api/analysis/memo rejects an anonymous caller");

  // Authenticated without permission
  assert((await call(demandRunPOST, { method: "POST", path: "/api/demand/run", cookie: viewer.cookie, body: {} })).status === 403, "VIEWER cannot run the demand calculation");
  assert((await call(demandRunPOST, { method: "POST", path: "/api/demand/run", cookie: analyst.cookie, body: {} })).status === 403, "DATA_ANALYST cannot run the demand calculation");
  assert((await call(demandUnlockPOST, { method: "POST", path: "/api/demand/run/unlock", cookie: analyst.cookie, body: { reason: "not allowed" } })).status === 403, "DATA_ANALYST cannot unlock the demand calculation");
  assert((await call(exportGET, { path: "/api/demand/export", cookie: viewer.cookie })).status === 403, "VIEWER cannot export demand data");
  assert((await call(customersGET, { path: "/api/analysis/customers", cookie: planner.cookie })).status === 403, "PLANNER cannot read customer data");
  assert((await call(memoGET, { path: "/api/analysis/memo", cookie: planner.cookie })).status === 403, "PLANNER cannot read memo data");
  assert((await call(wipGET, { path: "/api/analysis/wip", cookie: salesMgr.cookie })).status === 200, "SALES_MANAGER may read WIP aggregates (analysis.read)");

  // Authenticated with permission
  assert((await call(exportGET, { path: "/api/demand/export", cookie: analyst.cookie })).status === 200, "DATA_ANALYST may export demand data");
  assert((await call(customersGET, { path: "/api/analysis/customers", cookie: analyst.cookie })).status === 200, "DATA_ANALYST may read customer data");
  resetRateLimits();
  const runRes = await call(demandRunPOST, { method: "POST", path: "/api/demand/run", cookie: superAdmin.cookie, body: {} });
  assert(runRes.status === 200, `SUPER_ADMIN may run the demand calculation (got ${runRes.status})`);

  // Expired / revoked sessions
  const expiring = await makeUser("rbac-expired", "ADMIN");
  await db.session.update({ where: { id: expiring.session.id }, data: { expiresAt: daysAgo(1) } });
  assert((await call(wipGET, { path: "/api/analysis/wip", cookie: expiring.cookie })).status === 401, "An expired session is rejected");
  const revoked = await makeUser("rbac-revoked", "ADMIN");
  await db.session.update({ where: { id: revoked.session.id }, data: { revokedAt: new Date() } });
  assert((await call(wipGET, { path: "/api/analysis/wip", cookie: revoked.cookie })).status === 401, "A revoked session is rejected");
  const disabled = await makeUser("rbac-disabled", "ADMIN");
  await db.user.update({ where: { id: disabled.user.id }, data: { status: "DISABLED" } });
  assert((await call(wipGET, { path: "/api/analysis/wip", cookie: disabled.cookie })).status === 401, "A disabled user's session is rejected");

  // Client-supplied identity must never override the authenticated principal.
  resetRateLimits();
  const unlockRes = await call(demandUnlockPOST, {
    method: "POST",
    path: "/api/demand/run/unlock",
    cookie: superAdmin.cookie,
    body: { reason: "operator unlock for test", actor: "someone-else", role: "SUPER_ADMIN", userId: "forged-id" },
  });
  assert(unlockRes.status === 200, "An authorized unlock succeeds");
  const unlockAudit = await db.auditLog.findFirst({ where: { action: "DEMAND_CALCULATION_UNLOCK" }, orderBy: { timestamp: "desc" } });
  assert(unlockAudit?.actor === "rbac-super", `Audit actor is the authenticated principal, not the request body (got ${unlockAudit?.actor})`);
  assert(unlockAudit?.actorUserId === superAdmin.user.id, "Audit actorUserId comes from the session");
  assert(unlockAudit?.reason?.includes("operator unlock for test") === true, "The unlock justification is recorded");
  const shortReason = await call(demandUnlockPOST, { method: "POST", path: "/api/demand/run/unlock", cookie: superAdmin.cookie, body: { reason: "no" } });
  assert(shortReason.status === 400, "Unlock without a sufficient justification is rejected");

  // =========================================================================
  section("F. Demand trace lot-level disclosure requires demand.trace");
  // =========================================================================
  resetRateLimits();
  const traceViewer = await makeUser("trace-viewer", "SALES_VIEWER"); // analysis.read, no demand.trace
  const traceAnalyst = analyst; // analysis.read + demand.trace

  const noTrace = await call(traceGET, { path: "/api/analysis/demand-trace", cookie: traceViewer.cookie });
  assert(noTrace.status === 200, "A caller with analysis.read may read aggregate trace values");
  assert(noTrace.json.hasTracePermission === false, "The response states that lot-level access is restricted");
  assert(noTrace.json.summary.totalShortage >= 0 && noTrace.json.categories.length > 0, "Aggregate figures are still returned");
  assert(Array.isArray(noTrace.json.traceItems) && noTrace.json.traceItems.length === 0, "No trace items are returned without demand.trace");
  assert(
    noTrace.json.categories.every((c: { traceDetails?: unknown; traceAccessRestricted: boolean }) => c.traceDetails === undefined && c.traceAccessRestricted === true),
    "No nested lot detail is attached to categories without demand.trace",
  );
  const noTraceBody = JSON.stringify(noTrace.json);
  const knownLotIds = ["SALE-1", "WIP-POL-1", "WIP-MIRROR-1", "IN-STOCK-0"];
  assert(
    knownLotIds.every((lot) => !noTraceBody.includes(lot)),
    "No lot identifier leaks anywhere in the response body without demand.trace",
  );

  const withTrace = await call(traceGET, { path: "/api/analysis/demand-trace", cookie: traceAnalyst.cookie });
  assert(withTrace.json.hasTracePermission === true, "demand.trace unlocks lot-level access");
  assert(withTrace.json.traceItems.length > 0, "Trace items are returned to an authorized caller");
  assert(typeof withTrace.json.total === "number" && typeof withTrace.json.hasMore === "boolean", "Trace items follow the pagination contract");
  assert(withTrace.json.rules.formula.length === 5, "Trace API serves the five calculation formulas as rule metadata");
  assert(
    withTrace.json.rules.statements.some((s: { code: string; text: string }) => s.code === "WIP" && s.text.includes("pipeline")),
    "Rule metadata states that eligible WIP reduces the pipeline requirement only",
  );
  assert(
    withTrace.json.rules.statements.some((s: { code: string; applies: boolean }) => s.code === "MEMO" && s.applies === true),
    "Rule metadata states that memo does not reduce physical shortage",
  );
  assert(
    !JSON.stringify(withTrace.json.rules).includes("never auto-applied"),
    "No contradictory 'never auto-applied' WIP claim remains in the served rules",
  );

  // Lot-level WIP records follow the same rule as the trace endpoint.
  const wipNoTrace = await call(wipGET, { path: "/api/analysis/wip", cookie: traceViewer.cookie });
  assert(wipNoTrace.status === 200 && wipNoTrace.json.detailAccessRestricted === true, "WIP API restricts lot-level rows without demand.trace");
  assert(wipNoTrace.json.rows.length === 0, "WIP API returns no lot rows without demand.trace");
  assert(!JSON.stringify(wipNoTrace.json).includes("WIP-POL-1"), "WIP API does not leak lot ids without demand.trace");
  assert(wipNoTrace.json.summary.totalPieces > 0, "WIP aggregates remain visible with analysis.read");

  // =========================================================================
  section("G. Export authorization policy");
  // =========================================================================
  const viewsDir = path.join(process.cwd(), "src", "components", "diamond", "views");
  const viewFiles: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".tsx")) viewFiles.push(full);
    }
  };
  walk(viewsDir);

  const missingPolicy: string[] = [];
  const unknownPermission: string[] = [];
  const permissionSet = new Set<string>(PERMISSIONS as readonly string[]);
  for (const file of viewFiles) {
    const src = readFileSync(file, "utf8");
    const exportsEnabled = /\bexportable\b/.test(src) || /\bexcelExportable\b/.test(src) || /\bpdfExportable\b/.test(src);
    if (!exportsEnabled) continue;
    const matches = [...src.matchAll(/exportPermission="([^"]+)"/g)].map((m) => m[1]);
    if (matches.length === 0) missingPolicy.push(path.basename(file));
    for (const m of matches) if (!permissionSet.has(m)) unknownPermission.push(`${path.basename(file)}:${m}`);
  }
  assert(missingPolicy.length === 0, `Every view with exports declares an export permission (missing: ${missingPolicy.join(", ") || "none"})`);
  assert(unknownPermission.length === 0, `Every declared export permission exists in the central matrix (unknown: ${unknownPermission.join(", ") || "none"})`);

  const dataTableSrc = readFileSync(path.join(process.cwd(), "src", "components", "diamond", "shared", "data-table.tsx"), "utf8");
  assert(!/exportPermission\s*=\s*"demand\.export"/.test(dataTableSrc), "DataTable no longer defaults exports to demand.export");
  assert(/exportPermission\?:\s*Permission/.test(dataTableSrc), "DataTable types exportPermission against the central permission union");

  const demandExportViews = viewFiles.filter((f) => readFileSync(f, "utf8").includes('exportPermission="demand.export"')).map((f) => path.basename(f));
  assert(
    demandExportViews.every((f) => ["demand-calculation-overview.tsx", "demand-history-view.tsx", "demand-trace-view.tsx", "wip-view.tsx"].includes(f)),
    `demand.export is only used by demand views (found: ${demandExportViews.join(", ")})`,
  );

  // =========================================================================
  section("H. Honest product states");
  // =========================================================================
  await db.demandMetricTraceItem.deleteMany({});
  await db.demandMetric.deleteMany({});
  await db.demandRun.deleteMany({});
  const noRun = await call(traceGET, { path: "/api/analysis/demand-trace", cookie: admin.cookie });
  assert(noRun.json.hasEverRun === false, "With no completed run the trace reports hasEverRun = false");
  assert(noRun.json.summary.totalShortage === 0 && noRun.json.categories.length === 0, "No fabricated figures are shown before a run exists");
  assert(noRun.json.rules.wipPolicy.status === "CONFIGURED", "Rule metadata is still served when no run exists");

  const noRunHistory = await call(historyGET, { path: "/api/demand/history", cookie: admin.cookie });
  assert(noRunHistory.json.hasEverRun === false && noRunHistory.json.summary.lastStatus === "NOT_RUN", "Demand history reports NOT_RUN rather than a fabricated success");
  assert(typeof noRunHistory.json.isSimulated === "boolean" && typeof noRunHistory.json.sourceMode === "string", "The data source mode is labelled (fixture vs live)");

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
