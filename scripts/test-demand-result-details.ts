import { db } from "../src/lib/db";
import { SECTEST_DB } from "../tests/security/test-db";
import { proveDisposableDatabase } from "../src/lib/fantasy/database-environment";
import { call, makeUser } from "../tests/security/helpers";
import { resetRateLimits } from "../src/lib/api/rate-limit";
import { runDemandCalculation } from "../src/lib/demand/demand-service";
import { CONFIRMED_WEIGHT_BANDS } from "../src/lib/domain/diamond-rules";
import { toBusinessReason, toBusinessStatus } from "../src/lib/demand/demand-result-presentation";
import { GET as demandResultGET } from "../src/app/api/analysis/demand-trace/route";

const url = process.env.DATABASE_URL ?? "";
if (!proveDisposableDatabase(url).proven) {
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

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY);

const FORBIDDEN_KEYS = [
  "steps",
  "step",
  "formula",
  "source",
  "sourceTable",
  "sourceModel",
  "ruleId",
  "ruleCode",
  "ruleVersion",
  "mappingFingerprint",
  "mappingVersion",
  "configuration",
  "configurationJson",
  "query",
  "algorithm",
  "methodology",
  "internalTrace",
  "debug",
  "traceJson",
  "traceDetails",
  "traceItems",
  "sourcePolicy",
  "monthlyAverage",
  "unroundedTarget",
  "fourNumbers",
];

const FORBIDDEN_VALUE_PATTERNS: Array<{ label: string; re: RegExp }> = [
  { label: "SQL COUNT(", re: /COUNT\s*\(/ },
  { label: "SQL SUM(", re: /SUM\s*\(/ },
  { label: "SQL MAX(", re: /MAX\s*\(/ },
  { label: "SQL MIN(", re: /MIN\s*\(/ },
  { label: "SQL WHERE clause", re: /\bWHERE\s+[A-Za-z_"']/ },
  { label: "round_half_up", re: /round_half_up/i },
  { label: "rule identifier (BR-…)", re: /\bBR-[A-Z]+-\d+/ },
  { label: "rule version (DEMAND-V…)", re: /\bDEMAND-V\d/ },
  { label: "rule version (CONFIG-V…)", re: /\bCONFIG-V\d/ },
  { label: "valuation model id (VAL-…)", re: /\bVAL-[A-Z]+/ },
  { label: "model name LotHistoryRecord", re: /LotHistoryRecord/ },
  { label: "model name LotMasterRecord", re: /LotMasterRecord/ },
  { label: "model name PolishedStone", re: /PolishedStone/ },
  { label: "model name DemandMetric", re: /DemandMetric/ },
  { label: "model name DemandRun", re: /DemandRun/ },
  { label: "model name ForecastPrediction", re: /ForecastPrediction/ },
  { label: "model name PlanOptionPiece", re: /PlanOptionPiece/ },
  { label: "model name ManufacturingWIP", re: /ManufacturingWIP/ },
  { label: "internal step reference", re: /Step\s+\d/i },
  { label: "prisma reference", re: /prisma/i },
  { label: "internal exclusion code", re: /UNMAPPED_[A-Z_]+|INELIGIBLE_[A-Z_]+|WIP_POLICY_NOT_CONFIGURED/ },
];

interface Finding {
  path: string;
  detail: string;
}

function scanForbidden(value: unknown, path = "$", findings: Finding[] = []): Finding[] {
  if (value === null || value === undefined) return findings;

  if (Array.isArray(value)) {
    value.forEach((v, i) => scanForbidden(v, `${path}[${i}]`, findings));
    return findings;
  }

  if (typeof value === "object") {
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      if (FORBIDDEN_KEYS.includes(key)) {
        findings.push({ path: `${path}.${key}`, detail: `forbidden field "${key}"` });
      }
      scanForbidden(v, `${path}.${key}`, findings);
    }
    return findings;
  }

  if (typeof value === "string") {
    for (const { label, re } of FORBIDDEN_VALUE_PATTERNS) {
      if (re.test(value)) {
        findings.push({ path, detail: `${label} in value: ${value.slice(0, 80)}` });
      }
    }
  }
  return findings;
}

async function seedRun() {
  const TABLES = [
    "DemandMetricTraceItem",
    "DemandMetric",
    "DemandRun",
    "DemandCalculationLock",
    "DataQualityIssue",
    "PlanOptionPiece",
    "PlanOption",
    "PlanVersion",
    "PlanningCase",
    "RoughReservation",
    "RoughStone",
    "LotHistoryRecord",
    "LotMasterRecord",
    "PolishedStone",
    "MemoRecord",
    "SalesRecord",
    "Requirement",
    "Customer",
    "WeightBand",
    "LabMapping",
    "ShapeMapping",
    "BusinessRule",
    "Session",
    "User",
    "AuditLog",
  ];
  await db.$executeRawUnsafe(`TRUNCATE ${TABLES.map((t) => `"${t}"`).join(", ")} CASCADE`);
  resetRateLimits();

  const band = CONFIRMED_WEIGHT_BANDS[0];
  await db.weightBand.create({
    data: { code: band.code, label: band.label, minCt: band.minCt, maxCt: band.maxCt, sortOrder: 1, active: true },
  });
  await db.labMapping.create({ data: { rawLab: "GIA", normalizedLab: "GIA", active: true } });
  await db.shapeMapping.create({ data: { rawShape: "ROUND", normalizedShape: "ROUND", active: true } });

  for (let i = 0; i < 6; i++) {
    const lotId = `RS-SALE-${i}`;
    const docDate = daysAgo(10 + i);
    const common = {
      shape: "ROUND",
      shapeNormalized: "ROUND",
      weight: 1.05,
      labRaw: "GIA",
      labNormalized: "GIA",
      country: "IN",
      branch: "Surat",
      roughOrPolished: "POLISHED",
      isCurrent: true,
      removalReason: "EXPLICIT_SALE",
      docDate,
      statusEffectiveDate: docDate,
    };
    await db.lotMasterRecord.create({
      data: { lotId, entityType: "POLISHED", currentStatus: "SOLD", lastSyncBatchId: "B1", ...common },
    });
    await db.lotHistoryRecord.create({
      data: { lotId, version: 1, status: "SOLD", syncBatchId: "B1", checkpoint: 1, ...common },
    });
  }

  await db.lotMasterRecord.create({
    data: {
      lotId: "RS-STOCK-1",
      entityType: "POLISHED",
      currentStatus: "STOCK",
      statusEffectiveDate: daysAgo(4),
      docDate: daysAgo(4),
      shape: "ROUND",
      shapeNormalized: "ROUND",
      weight: 1.05,
      labRaw: "GIA",
      labNormalized: "GIA",
      country: "IN",
      branch: "Surat",
      roughOrPolished: "POLISHED",
      isCurrent: true,
      lastSyncBatchId: "B1",
    },
  });
  const wb = await db.weightBand.findFirstOrThrow();
  await db.polishedStone.create({
    data: {
      fantasyLotId: "RS-STOCK-1",
      country: "IN",
      branch: "Surat",
      fantasyStatus: "IN_STOCK",
      shape: "ROUND",
      shapeNormalized: "ROUND",
      labRaw: "GIA",
      labNormalized: "GIA",
      weight: 1.05,
      weightBandId: wb.id,
      planningClass: "PHYSICAL",
    },
  });

  for (const [lotId, shape] of [
    ["RS-WIP-1", "ROUND"],
    ["RS-WIP-AMBIGUOUS", "MYSTERY"],
  ]) {
    await db.lotMasterRecord.create({
      data: {
        lotId,
        entityType: "WIP",
        currentStatus: "WIP_POLISHING",
        wipStage: "WIP_POLISHING",
        statusEffectiveDate: daysAgo(2),
        docDate: daysAgo(2),
        shape,
        shapeNormalized: shape,
        weight: 1.05,
        labRaw: "GIA",
        labNormalized: "GIA",
        country: "IN",
        branch: "Surat",
        roughOrPolished: "WIP",
        isCurrent: true,
        lastSyncBatchId: "B1",
      },
    });
  }

  return runDemandCalculation({ actor: "result-details-test" });
}

async function main() {
  console.log("===============================================================================");
  console.log("DEMAND RESULT DETAILS — SAFE RESPONSE, RBAC & PAGINATION SUITE");
  console.log("===============================================================================");

  const engineRun = await seedRun();
  const category = `GIA|ROUND|${CONFIRMED_WEIGHT_BANDS[0].label}`;

  const analyst = await makeUser("rd-analyst", "DATA_ANALYST");
  const viewer = await makeUser("rd-viewer", "VIEWER");
  const planner = await makeUser("rd-planner", "PLANNER");

  section("A. The browser response contains no calculation implementation");
  const full = await call(demandResultGET, {
    path: `/api/analysis/demand-trace?category=${encodeURIComponent(category)}&recordType=EXCLUDED&page=1&pageSize=50`,
    cookie: analyst.cookie,
  });
  assert(full.status === 200, "Demand Result Details responds to an authorized caller");

  const findings = scanForbidden(full.json);
  assert(
    findings.length === 0,
    `No forbidden field or implementation string anywhere in the response${findings.length ? `: ${findings.slice(0, 4).map((f) => `${f.path} — ${f.detail}`).join(" | ")}` : ""}`,
  );

  const serialized = JSON.stringify(full.json);
  assert(!serialized.includes('"steps"'), "Response contains no calculation steps");
  assert(!serialized.includes('"formula"'), "Response contains no formula field");
  assert(!/sourceTable|sourceModel/.test(serialized), "Response contains no source-table or source-model field");
  assert(!/"ruleId"|"ruleVersion"/.test(serialized), "Response contains no rule identifier or rule version");
  assert(!serialized.includes("mappingFingerprint"), "Response contains no mapping fingerprint");
  assert(
    !/COUNT\(|SUM\(|MAX\(|WHERE\s+[A-Za-z_"']/.test(serialized),
    "Response contains no SQL-like expression",
  );
  assert(
    !/LotHistoryRecord|PolishedStone|DemandMetric|DemandRun|ForecastPrediction|PlanOptionPiece/.test(serialized),
    "Response contains no database model name",
  );
  assert(!/round_half_up/i.test(serialized), "Response contains no rounding implementation reference");
  assert(serialized.includes("sourceMode"), "Legitimate business wording such as source mode is preserved");

  section("B. Authoritative values are unchanged");
  const storedMetric = await db.demandMetric.findFirstOrThrow({
    where: { runId: engineRun.runId, planningCategory: category },
  });
  const served = full.json.categories.find((c: { category: string }) => c.category === category);
  assert(served !== undefined, "The calculated category is served to the browser");
  assert(served.sales90d === storedMetric.sales90d, `Confirmed sales match the stored result (${served.sales90d})`);
  assert(served.roundedTarget === storedMetric.roundedTarget, `Target quantity matches the stored result (${served.roundedTarget})`);
  assert(served.availableStock === storedMetric.availableStock, "Available stock matches the stored result");
  assert(served.physicalShortage === storedMetric.physicalShortage, `Physical shortage matches the stored result (${served.physicalShortage})`);
  assert(served.pipelineNeed === storedMetric.pipelineNeed, "Pipeline requirement matches the stored result");
  assert(served.remainingUnplanned === storedMetric.remainingUnplanned, "Remaining unplanned matches the stored result");
  assert(served.excessStock === storedMetric.excessStock, "Excess stock matches the stored result");
  assert(
    full.json.summary.totalShortage === engineRun.totalShortage,
    `Total shortage matches the engine result (${full.json.summary.totalShortage})`,
  );

  assert(served.wipCoverage === null, "Manufacturing coverage is null (unavailable), not a misleading zero");
  assert(full.json.wipCoverage.available === false, "Coverage availability is reported honestly");
  assert(
    typeof full.json.wipCoverage.message === "string" && !/BR-|rule/i.test(full.json.wipCoverage.message),
    "The coverage message is business language with no rule reference",
  );

  section("C. Business status and safe reasons");
  assert(
    typeof served.businessStatus?.label === "string" && served.businessStatus.label.length > 0,
    `Category carries a business status label ("${served.businessStatus?.label}")`,
  );
  assert(
    toBusinessStatus({ metricStatus: "COMPLETED", physicalShortage: 0, remainingUnplanned: 0, excessStock: 0 }).code === "COVERED",
    "A fully covered category is labelled Covered",
  );
  assert(
    toBusinessStatus({ metricStatus: "REVIEW_REQUIRED", physicalShortage: 0, remainingUnplanned: 0, excessStock: 0 }).code === "REVIEW_REQUIRED",
    "A review-required result is labelled Review required",
  );
  assert(
    toBusinessReason(false, "Ambiguous WIP attributes (UNMAPPED_SHAPE); cannot be attributed to a planning category.") ===
      "Shape could not be confirmed",
    "Internal exclusion codes map to business reasons",
  );
  assert(
    toBusinessReason(false, "Stage PLANNING is not an eligible stage under BR-WIP-001.") ===
      "Manufacturing stage is not currently eligible for coverage",
    "Stored reason text containing a rule identifier never reaches the browser",
  );
  assert(toBusinessReason(true, "Stage POLISHING is eligible under BR-WIP-001 v1.0.") === null, "Included records carry no reason text");

  const excludedRows = (full.json.supportingRecords?.rows ?? []) as Array<{ reason: string | null; inclusionStatus: string }>;
  assert(excludedRows.length > 0, `Excluded records are available as evidence (${excludedRows.length})`);
  assert(
    excludedRows.every((r) => r.inclusionStatus === "EXCLUDED" && typeof r.reason === "string" && !/BR-|UNMAPPED_|INELIGIBLE_/.test(r.reason!)),
    "Every excluded record carries a business reason with no internal code",
  );

  section("D. RBAC — aggregates versus record-level evidence");
  const anon = await call(demandResultGET, { path: "/api/analysis/demand-trace" });
  assert(anon.status === 401, "An anonymous caller is rejected");

  const viewerRes = await call(demandResultGET, {
    path: `/api/analysis/demand-trace?category=${encodeURIComponent(category)}&recordType=CONFIRMED_SALE`,
    cookie: viewer.cookie,
  });
  assert(viewerRes.status === 200, "A caller with analysis.read may read aggregate results");
  assert(viewerRes.json.categories.length > 0, "Aggregate category results are returned without demand.trace");
  assert(viewerRes.json.canViewSupportingRecords === false, "The response states that supporting records are restricted");
  assert(viewerRes.json.supportingRecords === null, "No supporting records are returned without demand.trace");
  const viewerBody = JSON.stringify(viewerRes.json);
  assert(
    !["RS-SALE-0", "RS-STOCK-1", "RS-WIP-1", "RS-WIP-AMBIGUOUS"].some((lot) => viewerBody.includes(lot)),
    "No lot identifier appears anywhere in the response without demand.trace",
  );
  assert(scanForbidden(viewerRes.json).length === 0, "The restricted response is also free of implementation detail");

  const plannerRes = await call(demandResultGET, {
    path: `/api/analysis/demand-trace?category=${encodeURIComponent(category)}&recordType=EXCLUDED&page=2&pageSize=1`,
    cookie: planner.cookie,
  });
  assert(
    plannerRes.status === 200 && plannerRes.json.supportingRecords === null,
    "Record-level evidence cannot be obtained by changing query parameters",
  );

  const analystRecords = await call(demandResultGET, {
    path: `/api/analysis/demand-trace?category=${encodeURIComponent(category)}&recordType=CONFIRMED_SALE`,
    cookie: analyst.cookie,
  });
  assert(
    (analystRecords.json.supportingRecords?.rows ?? []).length > 0,
    "A caller with demand.trace receives authorized supporting records",
  );
  assert(
    analystRecords.json.supportingRecords.rows.every((r: { recordType: string }) => r.recordType === "CONFIRMED_SALE"),
    "Record-type filtering returns only the requested business record type",
  );

  section("E. Supporting-record pagination");
  const p1 = await call(demandResultGET, {
    path: `/api/analysis/demand-trace?category=${encodeURIComponent(category)}&recordType=CONFIRMED_SALE&page=1&pageSize=2`,
    cookie: analyst.cookie,
  });
  const total = p1.json.supportingRecords.total;
  assert(total >= 6, `The record total is the server-side count (${total})`);
  assert(p1.json.supportingRecords.rows.length === 2, "The first page returns exactly the requested page size");
  assert(p1.json.supportingRecords.hasMore === true, "More records are reported as available");

  const seen = new Set<string>();
  let pageNo = 1;
  let lastPage = p1;
  while (pageNo <= 10) {
    const res = await call(demandResultGET, {
      path: `/api/analysis/demand-trace?category=${encodeURIComponent(category)}&recordType=CONFIRMED_SALE&page=${pageNo}&pageSize=2`,
      cookie: analyst.cookie,
    });
    for (const row of res.json.supportingRecords.rows as Array<{ id: string }>) seen.add(row.id);
    lastPage = res;
    if (!res.json.supportingRecords.hasMore) break;
    pageNo++;
  }
  assert(seen.size === total, `Every record appears exactly once across pages (${seen.size} of ${total})`);
  assert(lastPage.json.supportingRecords.hasMore === false, "The last page reports that nothing remains");

  section("F. Safe states and honest labelling");
  const unknownCat = await call(demandResultGET, {
    path: "/api/analysis/demand-trace?category=GIA%7CNOT_A_REAL_SHAPE%7C9.99",
    cookie: analyst.cookie,
  });
  assert(unknownCat.status === 200, "An unknown category does not fail the request");
  assert(unknownCat.json.selectedCategory === null && unknownCat.json.selectedCategoryUnavailable === true, "An unknown category returns a safe unavailable state");
  assert(unknownCat.json.supportingRecords === null, "No records are returned for an unknown category");

  const badParam = await call(demandResultGET, { path: "/api/analysis/demand-trace?page=abc", cookie: analyst.cookie });
  assert(badParam.status === 400, "An invalid parameter is rejected with a validation error");
  assert(
    typeof badParam.json?.error?.message === "string" &&
      !/prisma|postgres|constraint|select |at .*\.ts:/i.test(badParam.json.error.message),
    `The validation error is business-safe ("${badParam.json?.error?.message}")`,
  );
  assert(typeof badParam.json?.error?.requestId === "string", "A support reference is preserved on errors");

  assert(full.json.sourceMode === "FIXTURE_SIMULATION", "Fixture data is labelled as Fixture Simulation");
  assert(full.json.isSimulated === true, "The simulated flag stays honest");
  assert(typeof full.json.calculatedAtIst === "string", "The calculation time is reported");

  section("G. Backend traceability is retained on the server");
  const storedRun = await db.demandRun.findFirstOrThrow({ where: { id: engineRun.runId } });
  assert(storedRun.ruleVersion === "DEMAND-V1", "The run still records its internal rule version");
  assert(typeof storedRun.mappingFingerprint === "string" && storedRun.mappingFingerprint.length > 0, "The run still records its mapping fingerprint");
  assert(storedRun.wipPolicyStatus.length > 0, "The run still records which coverage policy it applied");
  assert(storedRun.actor === "result-details-test", "The run still records the actor");

  const storedTraceItem = await db.demandMetricTraceItem.findFirst({
    where: { runId: engineRun.runId, isIncluded: false },
  });
  assert(storedTraceItem !== null, "Excluded records are still persisted for audit");
  assert(
    typeof storedTraceItem?.reason === "string" && storedTraceItem.reason.length > 0,
    "The original internal reason text is still stored server-side",
  );
  assert(typeof storedTraceItem?.lotId === "string", "Contributing record identifiers are still stored server-side");

  await db.demandMetricTraceItem.deleteMany({});
  await db.demandMetric.deleteMany({});
  await db.demandRun.deleteMany({});
  const notRun = await call(demandResultGET, { path: "/api/analysis/demand-trace", cookie: analyst.cookie });
  assert(notRun.json.hasEverRun === false, "With no calculation the response reports that none exists");
  assert(notRun.json.statusLabel === "No demand calculation available", "The not-run state uses business wording");
  assert(notRun.json.categories.length === 0 && notRun.json.supportingRecords === null, "No fabricated results are returned before a calculation exists");
  assert(scanForbidden(notRun.json).length === 0, "The not-run response is also free of implementation detail");

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
