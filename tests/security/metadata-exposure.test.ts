import { beforeAll, describe, expect, test } from "./harness";
import { call, db, makeUser, resetDb } from "./helpers";
import { resetRateLimits } from "@/lib/api/rate-limit";
import { GET as demandHistory } from "@/app/api/demand/history/route";
import { POST as demandRun } from "@/app/api/demand/run/route";
import { GET as dashboard } from "@/app/api/dashboard/route";
import { GET as forecast } from "@/app/api/forecast/route";
import { GET as wip } from "@/app/api/analysis/wip/route";
import { GET as countries } from "@/app/api/analysis/countries/route";
import { GET as transferCandidates } from "@/app/api/analysis/transfer-candidates/route";
import { GET as dataQuality } from "@/app/api/data-quality/route";
import { GET as auditLog } from "@/app/api/admin/audit/route";
import { GET as overallExport, OVERALL_EXPORT_ROW_LIMIT } from "@/app/api/fantasy/overall/export/route";
import { GET as overallList } from "@/app/api/fantasy/overall/route";
import { ROLE_PERMISSIONS } from "@/lib/auth/permissions";
import { AUDITABLE_ENTITIES, ENTITY_LABELS, entityLabel } from "@/lib/domain/entity-labels";

/**
 * Internal metadata at the ordinary-user boundary.
 *
 * The rule under test is narrow: a response an ordinary role can obtain describes what
 * happened in business terms and nothing about how the system is built. Provenance the
 * engine needs — mapping fingerprints, sync cursors, batch keys, rule identifiers,
 * internal source-policy names — stays server-side, and model methodology is reachable
 * only with a permission granted for that purpose.
 *
 * Every assertion inspects the serialized response through the real route handler, and
 * the field lists are allow-lists rather than a sample of forbidden names, so a field
 * added later fails the test instead of slipping through.
 */

/** Never acceptable in a response an ordinary role can obtain. */
const INTERNAL_FIELDS = [
  "mappingFingerprint",
  "mappingVersion",
  "lastBatchId",
  "sourcePolicy",
  "ruleId",
  "ruleVersion",
  "wipRuleVersion",
  "algorithm",
  "rmse",
  "RMSE",
  "trainingPeriod",
  "validationPeriod",
  "errorSummary",
  "lockToken",
  "BR-WIP-001",
  "BR-TRANSFER-001",
  "DEMAND-V1",
];

function assertNoInternalFields(serialized: string) {
  for (const f of INTERNAL_FIELDS) expect(serialized.includes(f)).toBe(false);
}

describe("demand run history publishes business fields only", () => {
  let viewerCookie = "";

  /** Exactly what an `analysis.read` caller may receive for a run. */
  const ALLOWED_ROW_FIELDS = [
    "id", "runDate", "businessDateIst", "windowDays", "lookbackStart", "lookbackEnd",
    "startedAt", "finishedAt", "status", "totalShortage", "totalExcess", "salesCount",
    "inventoryCount", "wipCount", "planCount", "excludedCount", "sourceCutoff",
    "isSimulated", "actor", "durationMs", "metricCount", "failure",
    "wipPolicyStatus", "wipEligibleStages",
  ].sort();

  beforeAll(async () => {
    await resetDb();
    resetRateLimits();
    viewerCookie = (await makeUser("meta-viewer", "VIEWER")).cookie;
    await db.demandRun.create({
      data: {
        status: "COMPLETED",
        windowDays: 90,
        ruleVersion: "DEMAND-V1",
        sourcePolicy: "CANONICAL_FANTASY",
        mappingFingerprint: "abcdef0123456789",
        mappingVersion: "MAP-V3",
        lastBatchId: "BATCH-META-1",
        checkpoint: 4,
        wipRuleVersion: "WIP-V2",
        startedAt: new Date(),
        finishedAt: new Date(),
        actor: "meta-test",
      },
    });
  });

  test("returns exactly the approved fields and nothing more", async () => {
    const res = await call(demandHistory, { path: "/api/demand/history", cookie: viewerCookie });
    expect(res.status).toBe(200);

    const row = res.json.rows[0];
    expect(Object.keys(row).sort()).toEqual(ALLOWED_ROW_FIELDS);
    assertNoInternalFields(JSON.stringify(res.json));
  });

  test("keeps the run id, so trace links and bookmarks still resolve", async () => {
    const res = await call(demandHistory, { path: "/api/demand/history", cookie: viewerCookie });
    expect(typeof res.json.rows[0].id).toBe("string");
    expect(res.json.rows[0].id.length > 0).toBe(true);
  });

  test("still reports the honest source state and paging", async () => {
    const res = await call(demandHistory, { path: "/api/demand/history?page=1&pageSize=1", cookie: viewerCookie });
    expect(typeof res.json.sourceMode).toBe("string");
    expect(typeof res.json.isSimulated).toBe("boolean");
    expect(res.json.pageSize).toBe(1);
    expect(typeof res.json.total).toBe("number");
    expect(res.json.summary.lastCheckpoint).toBe(undefined);
  });

  test("the dashboard no longer ships the rule version", async () => {
    const res = await call(dashboard, { path: "/api/dashboard", cookie: viewerCookie });
    expect(res.status).toBe(200);
    expect(res.json.ruleVersion).toBe(undefined);
    assertNoInternalFields(JSON.stringify(res.json));
  });
});

describe("policy status without rule identifiers", () => {
  let viewerCookie = "";

  beforeAll(async () => {
    await resetDb();
    resetRateLimits();
    viewerCookie = (await makeUser("policy-viewer", "VIEWER")).cookie;
  });

  test("WIP analysis returns policy status but not the rule behind it", async () => {
    const res = await call(wip, { path: "/api/analysis/wip", cookie: viewerCookie });
    expect(res.status).toBe(200);
    assertNoInternalFields(JSON.stringify(res.json));
    // The operationally relevant part is still there.
    expect(typeof res.json.policy.status).toBe("string");
    expect(res.json.policy.ruleId).toBe(undefined);
    expect(res.json.policy.ruleVersion).toBe(undefined);
  });

  test("country analysis names no rule and claims no geographic demand", async () => {
    const res = await call(countries, { path: "/api/analysis/countries", cookie: viewerCookie });
    expect(res.status).toBe(200);
    assertNoInternalFields(JSON.stringify(res.json));
    // The WIP policy and transfer-rule blocks are gone with the figures they qualified:
    // the page no longer derives anything per country from a business rule, so there is
    // no rule status to publish and no rule identifier that could leak with it.
    expect(res.json.wipPolicy).toBe(undefined);
    expect(res.json.transfer).toBe(undefined);
    expect(res.json.geographicDemandAvailable).toBe(false);
  });

  test("transfer candidates stay advisory without naming the rule", async () => {
    const res = await call(transferCandidates, { path: "/api/analysis/transfer-candidates", cookie: viewerCookie });
    expect(res.status).toBe(200);
    assertNoInternalFields(JSON.stringify(res.json));
    expect(res.json.ruleId).toBe(undefined);
    // The page no longer produces candidates at all: the authoritative demand result has
    // no country or branch, so a recommendation cannot be made. `autoExecuted` went with
    // the candidates — there is nothing that could have been executed.
    expect(res.json.recommendationsAvailable).toBe(false);
    expect(res.json.candidates).toEqual([]);
  });
});

describe("forecast methodology is a separate authority", () => {
  const P = "forecast.methodology.read";

  test("no ordinary read-only role holds it, and administering the system does not grant it", () => {
    for (const role of ["VIEWER", "SALES_VIEWER", "MFG_VIEWER", "PLANNING_VIEWER", "DATA_ANALYST", "ANALYSIS_MANAGER", "AUDITOR", "ADMIN"] as const) {
      expect(ROLE_PERMISSIONS[role].includes(P)).toBe(false);
    }
  });

  test("the model-governance role holds it", () => {
    expect(ROLE_PERMISSIONS.DATA_SCIENTIST.includes(P)).toBe(true);
  });

  test("an ordinary viewer receives predictions without the method behind them", async () => {
    await resetDb();
    resetRateLimits();
    const cookie = (await makeUser("fc-viewer", "VIEWER")).cookie;
    await db.modelVersion.create({
      data: {
        modelName: "demand-forecast",
        version: "v7",
        algorithm: "GradientBoostedTrees",
        trainingPeriod: "2025-01..2025-09",
        validationPeriod: "2025-10..2025-12",
        metricsJson: JSON.stringify({ mae: 1.2, rmse: 3.4, wape: 0.1, bias: -0.2 }),
        status: "PUBLISHED",
      },
    });

    const res = await call(forecast, { path: "/api/forecast", cookie });
    expect(res.status).toBe(200);
    expect(res.json.canSeeMethodology).toBe(false);
    assertNoInternalFields(JSON.stringify(res.json));

    const model = res.json.models[0];
    expect(Object.keys(model).sort()).toEqual(["id", "modelName", "publishedAt", "publishedBy", "status"]);
    // The business result is still delivered.
    expect(model.status).toBe("PUBLISHED");
  });

  test("an ordinary viewer asking for methodology directly is refused, not quietly emptied", async () => {
    const cookie = (await makeUser("fc-viewer-2", "VIEWER")).cookie;
    const res = await call(forecast, { path: "/api/forecast?include=methodology", cookie });
    expect(res.status).toBe(403);
  });

  test("a system administrator without the permission is refused the same way", async () => {
    const cookie = (await makeUser("fc-admin", "ADMIN")).cookie;
    expect((await call(forecast, { path: "/api/forecast?include=methodology", cookie })).status).toBe(403);
    const res = await call(forecast, { path: "/api/forecast", cookie });
    expect(res.json.canSeeMethodology).toBe(false);
    expect(res.json.models[0].algorithm).toBe(undefined);
  });

  test("the model-governance role receives the method", async () => {
    const cookie = (await makeUser("fc-scientist", "DATA_SCIENTIST")).cookie;
    const res = await call(forecast, { path: "/api/forecast", cookie });
    expect(res.status).toBe(200);
    expect(res.json.canSeeMethodology).toBe(true);
    expect(res.json.models[0].algorithm).toBe("GradientBoostedTrees");
    expect(res.json.models[0].metrics.rmse).toBe(3.4);
    expect((await call(forecast, { path: "/api/forecast?include=methodology", cookie })).status).toBe(200);
  });

  test("an unauthenticated caller is refused", async () => {
    expect((await call(forecast, { path: "/api/forecast" })).status).toBe(401);
  });
});

describe("record types are named for people, and only known keys reach a query", () => {
  let dqCookie = "";
  let auditCookie = "";

  beforeAll(async () => {
    await resetDb();
    resetRateLimits();
    dqCookie = (await makeUser("label-dq", "DATA_ANALYST")).cookie;
    auditCookie = (await makeUser("label-audit", "AUDITOR")).cookie;
  });

  test("the catalogue maps storage names to business names", () => {
    expect(ENTITY_LABELS.SalesRecord).toBe("Sales Records");
    expect(ENTITY_LABELS.PolishedStone).toBe("Polished Inventory");
    expect(ENTITY_LABELS.RoughStone).toBe("Rough Inventory");
    expect(ENTITY_LABELS.PlanningCase).toBe("Planning Cases");
    expect(ENTITY_LABELS.WeightBand).toBe("Weight Bands");
  });

  test("an unrecognized stored value stays unknown instead of being relabelled", () => {
    expect(entityLabel("SomeRetiredModel")).toBe("Unknown entity");
    expect(entityLabel(null)).toBe("Unknown entity");
    // It must not be folded into a neighbouring known type.
    expect(AUDITABLE_ENTITIES.includes("SomeRetiredModel" as never)).toBe(false);
  });

  test("data quality accepts a known key and refuses anything else", async () => {
    expect((await call(dataQuality, { path: "/api/data-quality?entity=SalesRecord", cookie: dqCookie })).status).toBe(200);
    const bad = await call(dataQuality, { path: "/api/data-quality?entity=DROP+TABLE", cookie: dqCookie });
    expect(bad.status).toBe(400);
    expect(bad.json.error.code).toBe("BAD_REQUEST");
  });

  test("the audit log accepts a known key and refuses anything else", async () => {
    expect((await call(auditLog, { path: "/api/admin/audit?entity=BusinessRule", cookie: auditCookie })).status).toBe(200);
    expect((await call(auditLog, { path: "/api/admin/audit?entity=NotAModel", cookie: auditCookie })).status).toBe(400);
  });
});

describe("overall data export", () => {
  let exporterCookie = "";
  const BATCH = "EXPORT-TEST";

  async function makeLot(i: number, country: string, lab: string) {
    return db.lotMasterRecord.create({
      data: {
        lotId: `${BATCH}-${i}`,
        sourceType: "POLISHED",
        currentStatus: "IN_STOCK",
        statusEffectiveDate: new Date(),
        isCurrent: true,
        shape: "ROUND",
        shapeNormalized: "ROUND",
        weight: 1.01,
        labNormalized: lab,
        branch: "SRT",
        country,
        docDate: new Date(),
        firstSeenAt: new Date(),
        lastSeenAt: new Date(),
        currentVersion: 3,
        lastSyncBatchId: "SECRET-BATCH-KEY",
        checkpoint: 9,
        isSimulated: true,
      },
    });
  }

  beforeAll(async () => {
    await resetDb();
    resetRateLimits();
    exporterCookie = (await makeUser("export-user", "ANALYSIS_MANAGER")).cookie;
    await db.lotMasterRecord.deleteMany({ where: { lotId: { startsWith: BATCH } } });
    for (let i = 0; i < 12; i++) await makeLot(i, i < 7 ? "IN" : "BE", i % 2 === 0 ? "GIA" : "IGI");
    // A value a spreadsheet would execute if it were written through unescaped.
    await db.lotMasterRecord.create({
      data: {
        lotId: `${BATCH}-INJECT`,
        sourceType: "POLISHED",
        currentStatus: "IN_STOCK",
        statusEffectiveDate: new Date(),
        isCurrent: true,
        shape: "ROUND",
        shapeNormalized: "ROUND",
        weight: 1,
        labNormalized: "GIA",
        branch: "SRT",
        country: "IN",
        customerName: "=cmd|'/c calc'!A1",
        lastSyncBatchId: "SECRET-BATCH-KEY",
        docDate: new Date(),
        firstSeenAt: new Date(),
        lastSeenAt: new Date(),
        isSimulated: true,
      },
    });
  });

  test("publishes the approved header row and no implementation columns", async () => {
    resetRateLimits();
    const res = await fetchExport("/api/fantasy/overall/export", exporterCookie);
    expect(res.status).toBe(200);

    const text = await callText("/api/fantasy/overall/export", exporterCookie);
    const headerLine = text.split("\r\n").find((l) => l.startsWith('"Lot ID"')) ?? "";
    expect(headerLine).toBe(
      [
        "Lot ID", "Source Type", "Current Status", "Previous Status", "Stock State", "Shape",
        "Weight (ct)", "Color", "Clarity", "Lab", "Certificate", "Customer Name",
        "Sale Total (USD)", "Department", "Location", "Branch", "Country", "Removal Reason",
        "Removed At (IST)", "Doc Date (IST)", "First Seen (IST)", "Last Seen (IST)", "Data Source",
      ].map((h) => `"${h}"`).join(","),
    );
    for (const gone of ["Version", "Batch ID", "Checkpoint", "Is Current Live", "SECRET-BATCH-KEY"]) {
      expect(text.includes(gone)).toBe(false);
    }
  });

  test("neutralizes a value a spreadsheet would execute", async () => {
    resetRateLimits();
    const text = await callText("/api/fantasy/overall/export", exporterCookie);
    expect(text.includes(`"'=cmd|'/c calc'!A1"`)).toBe(true);
    expect(text.includes(`"=cmd`)).toBe(false);
  });

  test("applies the country and lab scope the caller filtered by", async () => {
    resetRateLimits();
    const all = await callText("/api/fantasy/overall/export", exporterCookie);
    const scoped = await callText("/api/fantasy/overall/export?country=BE", exporterCookie);
    const countRows = (t: string) => t.split("\r\n").filter((l) => l.includes(`${BATCH}-`)).length;
    expect(countRows(scoped) < countRows(all)).toBe(true);
    expect(scoped.includes('"BE"')).toBe(true);
    // Rows outside the requested country must not appear.
    expect(scoped.split("\r\n").filter((l) => l.includes(`"IN"`) && l.includes(BATCH)).length).toBe(0);

    const labScoped = await callText("/api/fantasy/overall/export?lab=IGI", exporterCookie);
    expect(labScoped.split("\r\n").filter((l) => l.includes(`"GIA"`) && l.includes(BATCH)).length).toBe(0);
  });

  test("the list and the export select the same rows for the same filters", async () => {
    resetRateLimits();
    const list = await call(overallList, { path: "/api/fantasy/overall?country=BE&pageSize=500", cookie: exporterCookie });
    const listIds = (list.json.rows as { lotId: string }[]).filter((r) => r.lotId.startsWith(BATCH)).map((r) => r.lotId).sort();
    const text = await callText("/api/fantasy/overall/export?country=BE", exporterCookie);
    const exportIds = text.split("\r\n").map((l) => l.match(new RegExp(`"(${BATCH}-[^"]*)"`))?.[1]).filter(Boolean).sort();
    expect(exportIds).toEqual(listIds);
  });

  test("declares its row count, total and limit rather than implying completeness", async () => {
    resetRateLimits();
    const res = await fetchExport("/api/fantasy/overall/export", exporterCookie);
    expect(res.headers.get("x-overall-export-truncated")).toBe("false");
    expect(res.headers.get("x-overall-export-limit")).toBe(String(OVERALL_EXPORT_ROW_LIMIT));
    expect(Number(res.headers.get("x-overall-export-rows"))).toBe(Number(res.headers.get("x-overall-export-total")));
  });

  test("the previous 5,000-row ceiling no longer truncates", async () => {
    resetRateLimits();
    expect(OVERALL_EXPORT_ROW_LIMIT > 5_000).toBe(true);
    const res = await fetchExport("/api/fantasy/overall/export", exporterCookie);
    const total = Number(res.headers.get("x-overall-export-total"));
    const rows = Number(res.headers.get("x-overall-export-rows"));
    // Every matching row is exported while the total is under the declared ceiling.
    expect(rows).toBe(Math.min(total, OVERALL_EXPORT_ROW_LIMIT));
    expect(res.headers.get("x-overall-export-truncated")).toBe(String(total > OVERALL_EXPORT_ROW_LIMIT));
  });

  test("declares simulated data and a safe filename", async () => {
    resetRateLimits();
    const res = await fetchExport("/api/fantasy/overall/export", exporterCookie);
    const disposition = res.headers.get("content-disposition") ?? "";
    // The name carries no user input: a fixed prefix, the declared source state and a date.
    expect(/^attachment; filename="overall-data-(simulated-)?\d{4}-\d{2}-\d{2}\.csv"$/.test(disposition)).toBe(true);

    // Whatever the fixture source state is, the file and the headers must agree with it.
    const simulated = res.headers.get("x-overall-export-simulated") === "true";
    expect(disposition.includes("simulated-")).toBe(simulated);
    resetRateLimits();
    const text = await callText("/api/fantasy/overall/export", exporterCookie);
    expect(text.includes("SIMULATED / TEST FIXTURE DATA")).toBe(simulated);
  });

  test("refuses an unknown history selector rather than silently widening the result", async () => {
    resetRateLimits();
    const res = await call(overallExport, { path: "/api/fantasy/overall/export?isCurrent=maybe", cookie: exporterCookie });
    expect(res.status).toBe(400);
  });

  test("requires the export permission, not merely read access", async () => {
    resetRateLimits();
    // VIEWER holds overall.read but not overall.export.
    const viewer = (await makeUser("export-denied", "VIEWER")).cookie;
    expect((await call(overallExport, { path: "/api/fantasy/overall/export", cookie: viewer })).status).toBe(403);
    expect((await call(overallExport, { path: "/api/fantasy/overall/export" })).status).toBe(401);
  });

  test("records the export in the audit trail without row contents", async () => {
    resetRateLimits();
    await callText("/api/fantasy/overall/export?country=IN", exporterCookie);
    const entry = await db.auditLog.findFirst({
      where: { action: "OVERALL_DATA_EXPORTED" },
      orderBy: { timestamp: "desc" },
    });
    expect(entry !== null).toBe(true);
    expect(entry?.reason?.includes("country=IN")).toBe(true);
    // Scope and counts only — never a lot identifier or a customer name.
    expect(entry?.reason?.includes(BATCH)).toBe(false);
    expect(entry?.reason?.includes("cmd|")).toBe(false);
  });
});

/** The line separator the export writes. */
const CRLF = "\r\n";

describe("export beyond the old 5,000-row ceiling", () => {
  // Above the previous fixed `take: 5000` and above two read batches, so the batching
  // path is genuinely exercised rather than assumed.
  const BULK = "BULK-EXPORT-TEST";
  const ROWS = 5_100;
  let cookie = "";

  beforeAll(async () => {
    await resetDb();
    resetRateLimits();
    cookie = (await makeUser("bulk-export", "ANALYSIS_MANAGER")).cookie;
    // The runner refuses to start unless DATABASE_URL points at the isolated
    // `planning_sectest` database, so this bulk data never reaches a real one.
    await db.lotMasterRecord.deleteMany({ where: { lotId: { startsWith: BULK } } });
    const now = new Date();
    await db.lotMasterRecord.createMany({
      data: Array.from({ length: ROWS }, (_, i) => ({
        lotId: `${BULK}-${i}`,
        sourceType: "POLISHED",
        currentStatus: "IN_STOCK",
        statusEffectiveDate: now,
        isCurrent: true,
        shape: "ROUND",
        shapeNormalized: "ROUND",
        weight: 1,
        labNormalized: "GIA",
        branch: "SRT",
        country: "BULK",
        docDate: now,
        firstSeenAt: now,
        lastSeenAt: now,
        lastSyncBatchId: "BULK-BATCH",
        isSimulated: true,
      })),
    });
  });

  test("exports every matching row instead of stopping at 5,000", async () => {
    resetRateLimits();
    const res = await fetchExport("/api/fantasy/overall/export?country=BULK", cookie);
    expect(res.status).toBe(200);
    expect(Number(res.headers.get("x-overall-export-total"))).toBe(ROWS);
    expect(Number(res.headers.get("x-overall-export-rows"))).toBe(ROWS);
    expect(res.headers.get("x-overall-export-truncated")).toBe("false");

    const text = await (async () => {
      resetRateLimits();
      return callText("/api/fantasy/overall/export?country=BULK", cookie);
    })();
    const dataRows = text.split(CRLF).filter((l) => l.includes(`"${BULK}-`));
    expect(dataRows.length).toBe(ROWS);
    // The row that the old ceiling would have dropped is present.
    expect(text.includes(`"${BULK}-5099"`)).toBe(true);
  });

  test("the declared count always equals what the file contains", async () => {
    resetRateLimits();
    const res = await fetchExport("/api/fantasy/overall/export?country=BULK", cookie);
    const declared = Number(res.headers.get("x-overall-export-rows"));
    resetRateLimits();
    const text = await callText("/api/fantasy/overall/export?country=BULK", cookie);
    expect(text.split(CRLF).filter((l) => l.includes(`"${BULK}-`)).length).toBe(declared);
  });
});

describe("the demand source is chosen by the server", () => {
  let runnerCookie = "";

  beforeAll(async () => {
    await resetDb();
    resetRateLimits();
    runnerCookie = (await makeUser("run-manager", "ANALYSIS_MANAGER")).cookie;
  });

  test("a request naming a source policy is refused, so the legacy source is undiscoverable", async () => {
    const res = await call(demandRun, {
      method: "POST",
      path: "/api/demand/run",
      cookie: runnerCookie,
      body: { sourcePolicy: "LEGACY_SALES" },
      headers: { origin: "http://localhost:3000" },
    });
    expect(res.status).toBe(400);
    expect(res.json.error.code).toBe("VALIDATION_FAILED");
  });

  test("an unknown field is refused too", async () => {
    const res = await call(demandRun, {
      method: "POST",
      path: "/api/demand/run",
      cookie: runnerCookie,
      body: { somethingElse: 1 },
      headers: { origin: "http://localhost:3000" },
    });
    expect(res.status).toBe(400);
  });

  test("an unauthorized caller cannot trigger a run at all", async () => {
    const viewer = (await makeUser("run-denied", "VIEWER")).cookie;
    const res = await call(demandRun, {
      method: "POST",
      path: "/api/demand/run",
      cookie: viewer,
      body: {},
      headers: { origin: "http://localhost:3000" },
    });
    expect(res.status).toBe(403);
  });
});

/** The export returns CSV, not JSON, so these two helpers read the raw body. */
async function fetchExport(path: string, cookie: string): Promise<Response> {
  return overallExport(
    new Request(`http://localhost:3000${path}`, { headers: { cookie } }),
    { params: Promise.resolve({}) },
  );
}

async function callText(path: string, cookie: string): Promise<string> {
  return (await fetchExport(path, cookie)).text();
}
