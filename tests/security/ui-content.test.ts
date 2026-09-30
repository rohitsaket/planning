// Rendered UI content: what signed-in users actually read on the application's pages.
//
// Each page is rendered to HTML from its real component, with every data request answered
// by the real route handler under a real session against the isolated planning_sectest
// database (see ./ui-render). The assertions read the rendered text — never the source —
// so a technical detail that reaches the screen fails here however it got there, while the
// same words in a code comment or an internal identifier do not.
//
// Two halves: nothing technical is shown (API paths, rule and profile identifiers, formulas,
// raw JSON, feature-flag codes, the old footer rules), and nothing the user needs was lost
// with it (simulation and not-run disclosures, validation blockers with their next steps,
// the Best Twin weight advisory, mapping edit controls, permission-dependent actions and
// exports).

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "./harness";
import { call, db, ensureCountryRegistry, makeUser, resetDb } from "./helpers";
import { renderPage, sessionUser } from "./ui-render";
import { Prisma } from "@prisma/client";
import { resetRateLimits } from "@/lib/api/rate-limit";
import type { ComponentType } from "react";
import type { SessionUser } from "@/stores/auth-store";
import { GET as dashboardKpis } from "@/app/api/dashboard/route";
import { GET as salesSummary } from "@/app/api/analysis/sales/route";
import { POST as uploadImport } from "@/app/api/planning/sarin/imports/route";
import { POST as validateImport } from "@/app/api/planning/sarin/imports/[batchId]/validate/route";
import { POST as generateOutput } from "@/app/api/planning/sarin/imports/[batchId]/outputs/route";
import { GET as listOptions } from "@/app/api/planning/sarin/imports/[batchId]/outputs/[versionId]/options/route";
import { POST as rolesPost } from "@/app/api/admin/roles/route";
import { POST as usersPost } from "@/app/api/admin/users/route";
import { WorkbookImportView } from "@/components/diamond/views/workbook-import-view";
import { AdvisoryList, SarinFileResult } from "@/components/diamond/views/sarin/sarin-file-result";
import { SarinOutputPreview } from "@/components/diamond/views/sarin/sarin-output-preview";
import { rightsOf } from "@/components/diamond/views/sarin/sarin-processing";
import { SarinShapeMappingsView } from "@/components/diamond/views/sarin/sarin-shape-mappings-view";
import { RequirementsMatrixView } from "@/components/diamond/views/requirements-matrix-view";
import { MappingsView } from "@/components/diamond/views/consolidated/mappings-view";
import { StatusMappingsView } from "@/components/diamond/views/status-mappings-view";
import { applyCatalog } from "./sarin-catalog";
import { PermissionsTab } from "@/components/diamond/views/users-access/permissions-tab";
import { SalesAnalysisView } from "@/components/diamond/views/sales-analysis-view";
import { OrderSourceView } from "@/components/diamond/views/customers-orders/order-source-view";
import { FantasySyncView } from "@/components/diamond/views/fantasy-sync-view";
import { DashboardView } from "@/components/diamond/views/dashboard-view";
import { InventoryPositionTab } from "@/components/diamond/views/inventory/inventory-tabs";
import { AppShell } from "@/components/layout/app-shell";

type User = Awaited<ReturnType<typeof makeUser>>;
interface Session { cookie: string; user: SessionUser }

const LOT_BATCH = "UI-CONTENT-TEST";
const SARIN_DATA = ["SarinPlanPiece", "SarinPlanOption", "SarinOutputVersion", "SarinRowInterpretation", "SarinValidationAttempt", "SarinIssueOverride", "SarinValidationIssue", "SarinStoneBlock", "SarinSourceRow", "SarinImportBatch", "SarinSourceFileContent", "SarinSourceFile"];

/** Text that must never reach a page, with the reason each is technical rather than business content. */
const PROHIBITED: Array<[string, RegExp]> = [
  ["API path", /\/api\//],
  ["HTTP verb instruction", /\b(?:POSTs?|PATCH|PUT)\b/],
  ["client framework", /TanStack|React Query/i],
  ["raw source-record panel", /Source Records \(JSON\)/],
  ["business-rule identifier", /\bBR-[A-Z]+(?:-[A-Z]+)*-\d{3}\b/],
  ["validation profile", /SARIN_VALIDATION_/],
  ["transform profile", /SARIN_[A-Z_]*TRANSFORM/],
  ["feature-flag code", /\bFF_[A-Z_]{3,}/],
  ["old footer rule", /90D rule CONFIRMED|Memo excluded/],
  ["formula symbol", /Σ|round[- ]half[- ]up|\bMAX\(|\bMIN\(/i],
  ["raw JSON", /\{\s*"[A-Za-z_]+"\s*:/],
  ["implementation wording", /server-authoritative|server-side|\bprisma\b|\bSQL\b|stack trace|node_modules/i],
];

function prohibited(text: string, except: string[] = []): string[] {
  return PROHIBITED.filter(([name, re]) => !except.includes(name) && re.test(text)).map(([name, re]) => `${name}: "${text.match(re)![0]}"`);
}

let root: User, planner: User, reader: User, mapper: User, mapReader: User;
const sessions = new Map<User, Session>();
const as = async (u: User): Promise<Session> => {
  if (!sessions.has(u)) sessions.set(u, { cookie: u.cookie, user: await sessionUser(u.cookie) });
  return sessions.get(u)!;
};
const render = async <P extends object>(view: ComponentType<P>, props: P, u: User) => {
  const s = await as(u);
  return renderPage(view, props, s.user, s.cookie);
};
/** One file's result area in Workbook Import, as this user sees it after opening the file. */
const fileResult = async (batchId: string, u: User) => {
  const s = await as(u);
  const props = { batchId, rights: rightsOf(s.user.permissions), failure: null, busy: false, onProcessAgain: () => {}, onProcessAnother: () => {} };
  return renderPage(SarinFileResult, props, s.user, s.cookie);
};

/** A user whose only role holds exactly these permissions, created through the admin routes. */
async function userWith(name: string, permissions: string[]) {
  const u = await makeUser(name, "VIEWER");
  const code = `UI_${name.toUpperCase().replace(/[^A-Z]/g, "_")}_${Date.now().toString(36).toUpperCase()}`;
  resetRateLimits();
  const role = await call(rolesPost, { method: "POST", cookie: root.cookie, body: { op: "createRole", code, name: `UI ${name}`, permissions } });
  if (role.status !== 200) throw new Error(`role create failed ${role.status}`);
  resetRateLimits();
  if ((await call(usersPost, { method: "POST", cookie: root.cookie, body: { op: "setRoles", id: u.user.id, roles: [code] } })).status !== 200) throw new Error("role assign failed");
  return u;
}

// ---- Sarin fixtures, through the real upload / validate / generate routes --------------------
let nonce = 0;
const kapan = () => `8${String(++nonce).padStart(3, "0")}R`;
interface Rec { name: string; shape?: string; est?: string }
const csv = (recs: Rec[]) => recs.map((r) => [r.name, "3.000", r.shape ?? "ROUND", r.est ?? "1.500", "VS1", "G", "61.6", "1.000", "7.62", "7.62", "4.69"].join(",")).join("\n") + "\n";

async function upload(recs: Rec[], packetType: string) {
  resetRateLimits();
  const fd = new FormData();
  fd.append("file", new File([new TextEncoder().encode(csv(recs)) as BlobPart], "sarin.csv", { type: "text/csv" }));
  for (const [k, v] of Object.entries({ packetType, planningDate: "2026-09-28" })) fd.append(k, v);
  const encoded = new Response(fd);
  const body = new Uint8Array(await encoded.arrayBuffer());
  const res = await uploadImport(
    new Request("http://localhost:3000/api/planning/sarin/imports", { method: "POST", headers: { cookie: planner.cookie, "content-type": encoded.headers.get("content-type")!, "content-length": String(body.length) }, body }),
    { params: Promise.resolve({}) } as never,
  );
  const json = (await res.json()) as any;
  if (res.status !== 201) throw new Error(`upload failed ${res.status}`);
  return json.batch.id as string;
}
const post = (handler: any, cookie: string, body: unknown, params: Record<string, string> = {}) => {
  resetRateLimits();
  return call(handler, { method: "POST", cookie, body, params });
};

const SHAPES = [
  ["ROUND", "Round"], ["PEAR", "Pear"], ["OVAL", "Oval"], ["ASSCHER", "Asscher"], ["EMERALD", "Emerald"],
  ["RADIANT", "Radiant"], ["CUSHION", "Cushion Brilliant"], ["ANTIQUE CUSHION", "Antique Cushion"], ["HEART", "Heart"],
] as const;
let blockedBatch = "";
let warningBatch = "";
let pinkBatch = "";
let pinkVersion = "";

beforeAll(async () => {
  await resetDb();
  await db.$executeRawUnsafe(`TRUNCATE ${SARIN_DATA.map((t) => `"${t}"`).join(", ")}`);
  await db.userAccessScope.deleteMany({});
  await ensureCountryRegistry(["IN"]);
  root = await makeUser("ui.root", "SUPER_ADMIN");
  planner = await makeUser("ui.planner", "PLANNER");
  reader = await makeUser("ui.reader", "PLANNING_VIEWER");
  mapper = await userWith("mapper", ["sarin.mapping.read", "sarin.mapping.manage"]);
  mapReader = await userWith("mapreader", ["sarin.mapping.read"]);

  // Shape mappings in effect for the Pink shape family, saved through the Mappings routes.
  await applyCatalog(mapper.cookie, SHAPES.map(([rawShape, normalizedShape]) => ({ rawShape, normalizedShape })));

  // A Blue import with a record that has no shape: validation leaves it in review with a blocker.
  const blue = `${kapan()}-001 DC`;
  blockedBatch = await upload(Array.from({ length: 17 }, (_, i) => ({ name: blue, shape: i === 3 ? "" : "ROUND" })), "BLUE");
  await post(validateImport, planner.cookie, {}, { batchId: blockedBatch });

  // A Blue import with one shape nobody mapped: its output keeps the raw shape, with a warning.
  const unmapped = `${kapan()}-001 DC`;
  warningBatch = await upload(Array.from({ length: 17 }, (_, i) => ({ name: unmapped, shape: i === 3 ? "MYSTERY STEP" : "ROUND" })), "BLUE");
  await post(validateImport, planner.cookie, {}, { batchId: warningBatch });
  await post(generateOutput, planner.cookie, {}, { batchId: warningBatch });

  // A Pink stone whose Best Twin pieces differ by 0.004 ct: validated, advisory only, output generated.
  const pink = `${kapan().slice(0, 4)}-111_M`;
  const recs: Rec[] = [];
  SHAPES.forEach(([shape]) => recs.push({ name: pink, shape, est: "1.000" }, { name: pink, shape, est: "1.000" }, { name: pink, shape: "ROUND", est: "0.200" }));
  for (const shape of ["EMERALD", "ROUND", "OVAL", "ROUND", "EMERALD", "OVAL"]) recs.push({ name: pink, shape, est: "0.500" });
  for (const shape of ["ROUND", "OVAL", "EMERALD", "RADIANT", "CUSHION", "ANTIQUE CUSHION"]) recs.push({ name: pink, shape, est: "0.400" }, { name: pink, shape, est: shape === "OVAL" ? "0.404" : "0.400" });
  pinkBatch = await upload(recs, "PINK");
  const validated = await post(validateImport, planner.cookie, {}, { batchId: pinkBatch });
  if (validated.json.batch.status !== "VALIDATED") throw new Error(`pink validation ${validated.json.batch.status}`);
  pinkVersion = (await post(generateOutput, planner.cookie, {}, { batchId: pinkBatch })).json.output.version.id;

  // Administration fixtures carrying the identifiers the pages must translate, and the retired
  // settings rows a database that has not yet applied their withdrawal still holds.
  await db.featureFlag.createMany({
    data: [
      { code: "FF_COLOR_DIMENSION", name: "Enable Color as Requirement Dimension" },
      { code: "FF_FORECAST_AUTO_ORDER", name: "Forecast Auto-Creates Production Orders" },
      { code: "FF_TRANSFER_AUTO", name: "Automatic Cross-Country Transfers" },
    ],
  });
  await db.businessRule.create({
    data: { ruleId: "BR-DEMAND-001", domain: "DEMAND", name: "90-day rolling invoice window", version: "1.0", effectiveDate: new Date(), status: "CONFIRMED", configuration: JSON.stringify({ windowDays: 90, todayIncluded: true, excludes: ["0.90-0.99"], nested: { lotStatus: "Invoice" } }) },
  });

  // Fixture-simulated inventory, so the simulation disclosure has something to disclose.
  await db.lotMasterRecord.createMany({
    data: Array.from({ length: 3 }, (_, i) => ({
      lotId: `${LOT_BATCH}-${i}`, currentStatus: "STOCK", statusEffectiveDate: new Date(), docDate: new Date(), shape: "ROUND", shapeNormalized: "ROUND",
      weight: new Prisma.Decimal(1), labNormalized: "GIA", labRaw: "GIA", quantity: new Prisma.Decimal(1), country: "IN", branch: "SRT", lastSyncBatchId: LOT_BATCH,
      isCurrent: true, roughOrPolished: "POLISHED", sourceType: "FIXTURE", isSimulated: true, inventoryClass: "PHYSICAL_AVAILABLE", classificationState: "CLASSIFIED",
      holdState: "NOT_HELD", canonicalLifecycle: "AVAILABLE", firstSeenAt: new Date(), lastSeenAt: new Date(),
    })),
  });
});
beforeEach(() => resetRateLimits());
afterAll(async () => {
  await db.lotHistoryRecord.deleteMany({ where: { syncBatchId: LOT_BATCH } });
  await db.lotMasterRecord.deleteMany({ where: { lastSyncBatchId: LOT_BATCH } });
});

// =========================================================================================
describe("ui content: no technical detail reaches a rendered page", () => {
  test("Workbook Import, a file's result, its items to review and its preview; the mapping administration", async () => {
    const pages = [
      await render(WorkbookImportView, {}, planner),
      await render(WorkbookImportView, {}, reader),
      await render(SarinShapeMappingsView, {}, mapper),
      await fileResult(blockedBatch, planner),
      await fileResult(warningBatch, planner),
      await fileResult(pinkBatch, planner),
      await render(AdvisoryList, { batchId: pinkBatch }, planner),
      await render(SarinOutputPreview, { batchId: pinkBatch, versionId: pinkVersion }, planner),
    ];
    expect(pages.map((p) => prohibited(p.text))).toEqual(pages.map(() => []));
    // Profiles, run numbers, mapping lineage, attempts and storage wording never appear.
    const shown = pages.map((p) => p.text).join(" ");
    expect([/rules version|profile|validation run|attempt|Run \d|mapping set|lineage|transform|immutable|record \d/i.test(shown), /Source:/.test(pages[0].text)]).toEqual([false, false]);
  });

  test("requirements and dashboard pages; no retired planning wording", async () => {
    const pages = [
      await render(RequirementsMatrixView, {}, root),
      await render(DashboardView, {}, root),
    ];
    expect(pages.map((p) => prohibited(p.text))).toEqual(pages.map(() => []));
    // The retired approval and plan-coverage workflow leaves no wording behind.
    for (const text of pages.map((p) => p.text)) expect(/Approval Queue|Planning Workbench|Approved Plan|Plan Coverage|Rough Reserved|Pending Approvals?/i.test(text)).toBe(false);
  });

  test("administration, sales, orders, Fantasy and inventory pages", async () => {
    const pages = [
      await render(MappingsView, {}, root),
      await render(StatusMappingsView, {}, root),
      await render(PermissionsTab, {}, root),
      await render(SalesAnalysisView, {}, root),
      await render(OrderSourceView, {}, root),
      await render(FantasySyncView, {}, root),
      await render(InventoryPositionTab, {}, root),
    ];
    expect(pages.map((p) => prohibited(p.text))).toEqual(pages.map(() => []));
    const [mappings, statuses, permissions, sales, orders, sync] = pages.map((p) => p.text);
    // Business Rules is no longer a page: Mappings carries its mapping tabs, without rule
    // identifiers or formulas, and no generic settings.
    for (const tab of ["Weight Bands", "Lab Mapping", "Shape Mapping", "Status Mapping", "Sarin Shape Mapping"]) expect([tab, mappings.includes(tab)]).toEqual([tab, true]);
    expect(/Feature Flags|Planning Dimensions/.test(mappings)).toBe(false);
    // The Permissions tab shows roles only: the plan approval policy is retired with plan
    // approval, and retired settings never appear, even while their rows are still stored.
    expect([permissions.includes("Approval Policy"), permissions.includes("approve a plan"), permissions.includes("separate approver")]).toEqual([false, false, false]);
    expect(permissions).toContain("Roles");
    expect(/Feature Flag|production orders|Cross-Country|Color categorization|FF_/i.test(permissions)).toBe(false);
    expect(/Business Rules|BR-[A-Z]+-\d|windowDays|\{"/.test(mappings + statuses)).toBe(false);
    expect([/Mathematical|Reconciled 100%|Checkpoint/.test(sync), /methodology|freshness threshold|authoritative/i.test(sales), /field|seeded/i.test(orders)]).toEqual([false, false, false]);
  });

  test("the global footer carries no rule text", async () => {
    const s = await as(root);
    const { createElement } = await import("react");
    const shell = await renderPage(AppShell, { children: createElement("p", null, "page body") }, s.user, s.cookie);
    expect([shell.text.includes("page body"), /90D rule CONFIRMED|Memo excluded/.test(shell.text), shell.text.includes("Fantasy")]).toEqual([true, false, true]);
  });
});

// =========================================================================================
describe("ui content: what users need is still shown", () => {
  test("Workbook Import says what to do on a blocked file, and states its upload limit", async () => {
    const uploaderPage = (await render(WorkbookImportView, {}, planner)).text;
    expect([uploaderPage.includes("Prepare Sarin Output"), /CSV without a header · Maximum 8\.0 MB/.test(uploaderPage), uploaderPage.includes("Process File"), uploaderPage.includes("Recent Files")]).toEqual([true, true, true, true]);
    const blocked = (await fileResult(blockedBatch, planner)).text;
    expect([blocked.includes("Output needs attention"), blocked.includes("What to do:"), blocked.includes("Shape is missing")]).toEqual([true, true, true]);
    // No backend issue code is shown alongside the finding.
    expect(/SHAPE_[A-Z_]+|MAPPING_[A-Z_]+/.test(blocked)).toBe(false);
  });

  test("an unmapped shape reads as one warning line with its record count, not a card per record", async () => {
    const page = (await fileResult(warningBatch, planner)).text;
    for (const label of ["Output Ready with Warnings", "1 shape is not mapped", "MYSTERY STEP", "— 1 record", "View affected records", "Export XLSX"]) expect([label, page.includes(label)]).toEqual([label, true]);
    expect([page.includes("Shape mapping is missing"), page.includes("Plan has no confirmed shape"), /SHAPE_[A-Z_]+|RAW_PASSTHROUGH/.test(page)]).toEqual([false, false, false]);
  });

  test("the Best Twin advisory shows both weights, the difference and the review note", async () => {
    const result = (await fileResult(pinkBatch, planner)).text;
    expect(result).toContain("Output ready with 1 item to review");
    const pink = (await render(AdvisoryList, { batchId: pinkBatch }, planner)).text;
    expect([pink.includes("0.400"), pink.includes("0.404"), pink.includes("0.004"), pink.includes("Weight difference requires review.")]).toEqual([true, true, true, true]);
    expect(/tolerance/i.test(pink)).toBe(false);
  });

  test("Output Ready keeps its counts and generation time; the preview shows the stored yields", async () => {
    const page = (await fileResult(pinkBatch, planner)).text;
    expect([page.includes("Output Ready"), /Stones 1\b/.test(page), /Output rows 45\b/.test(page), /Generated \d/.test(page)]).toEqual([true, true, true, true]);
    // The preview shows the server's stored yield, not a recalculation.
    const preview = (await render(SarinOutputPreview, { batchId: pinkBatch, versionId: pinkVersion }, planner)).text;
    resetRateLimits();
    const options = await call(listOptions, { cookie: planner.cookie, path: "/api/x?stone=1&pageSize=500", params: { batchId: pinkBatch, versionId: pinkVersion } });
    const yields: string[] = options.json.rows.map((o: any) => `${o.yield.display}%`);
    expect(yields.length).toBeGreaterThan(0);
    expect(yields.filter((y) => !preview.includes(y))).toEqual([]);
  });

  test("exports follow the export permission", async () => {
    const withExport = (await fileResult(pinkBatch, planner)).text;
    const readOnly = (await fileResult(pinkBatch, reader)).text;
    expect([withExport.includes("Export XLSX"), withExport.includes("More export options"), readOnly.includes("Export XLSX"), readOnly.includes("More export options")]).toEqual([true, true, false, false]);
  });

  test("actions without permission are not offered; reading stays available", async () => {
    const uploader = (await render(WorkbookImportView, {}, planner)).text;
    const viewer = (await render(WorkbookImportView, {}, reader)).text;
    expect([uploader.includes("Process File"), viewer.includes("Process File"), viewer.includes("Sarin CSV file"), viewer.includes("Recent Files")]).toEqual([true, false, false, true]);
    const readOnlyResult = (await fileResult(blockedBatch, reader)).text;
    expect([/Choose Another Mapping|Process Again|Try Again|Open Mappings|\bMap\b/.test(readOnlyResult), /permission/i.test(readOnlyResult)]).toEqual([false, false]);
    // The approval policy is retired: even the Super Admin is offered no approval switch.
    const permissions = await render(PermissionsTab, {}, root);
    expect([/Turn off|separate approver|Approval policy/i.test(permissions.text), permissions.requested.some((r) => r.startsWith("/api/admin/approval-policy"))]).toEqual([false, false]);
  });

  test("Sarin Shape Mapping offers adding, editing and removing to managers only, and no approval or version workflow", async () => {
    const manager = await render(SarinShapeMappingsView, {}, mapper);
    const reader = await render(SarinShapeMappingsView, {}, mapReader);
    // Both see the current mappings and the shape still unmapped in imported files.
    for (const page of [manager.text, reader.text]) {
      for (const label of ["Sarin Shape Mapping", "Current mappings", "Needs Mapping", "These shapes do not have a mapping yet.", "MYSTERY STEP", "Fantasy shape", "Applies to", "Updated"]) {
        expect([label, page.includes(label)]).toEqual([label, true]);
      }
    }
    expect([manager.text.includes("Add Mapping"), manager.html.includes('aria-label="Edit mapping for ROUND, All ratios"'), manager.html.includes('aria-label="Remove mapping for ROUND, All ratios"'), manager.html.includes('aria-label="Map MYSTERY STEP"')]).toEqual([true, true, true, true]);
    expect([reader.text.includes("Add Mapping"), reader.html.includes("Edit mapping for"), reader.html.includes("Remove mapping for"), reader.html.includes('aria-label="Map ')]).toEqual([false, false, false, false]);
    expect(/Dry run|Coverage|Review|Conflicts|Loaded by migration|Clone|Validate|Approv|Draft|Version|Retire|Lifecycle/i.test(manager.text + reader.text)).toBe(false);
  });

  test("simulation, not-run and not-configured states are disclosed", async () => {
    const inventory = (await render(InventoryPositionTab, {}, root)).text;
    expect(inventory).toMatch(/Fixture Simulation|Simulated/);
    // Other suites share this database, so the expected state is read from the same API.
    resetRateLimits();
    const readiness = (await call(salesSummary, { cookie: root.cookie, path: "/api/analysis/sales?page=1&pageSize=25" })).json.readiness;
    const STATUS: Record<string, [string, string | null]> = {
      CURRENT: ["Ready", null], SIMULATED: ["Simulated", null], STALE: ["Stale", "Run the demand calculation to refresh sales."],
      INCOMPLETE: ["Incomplete", "Some sale records were excluded and need correcting in the source data."], BLOCKED_BY_DATA_QUALITY: ["Needs Review", "Blocking data problems must be corrected in the source data before sales can be shown."],
      NOT_RUN: ["Not Run", "Run the demand calculation to load sales."], UNAVAILABLE: ["Unavailable", null],
    };
    const [label, next] = STATUS[readiness.state];
    const sales = (await render(SalesAnalysisView, {}, root)).text;
    expect([sales.includes(`Sales data ${label}`), next === null || sales.includes(next), !readiness.snapshot.isSimulated || /Simulated/.test(sales)]).toEqual([true, true, true]);
    const orders = (await render(OrderSourceView, {}, root)).text;
    expect(orders).toContain("Order data is not configured.");
    resetRateLimits();
    const health = (await call(dashboardKpis, { cookie: root.cookie, path: "/api/dashboard" })).json.fantasySyncHealth as string;
    const runs = await db.integrationSyncRun.count();
    // Without a single synchronization the answer is NOT_RUN, never a healthy default.
    expect(runs > 0 || health === "NOT_RUN").toBe(true);
    const dashboard = (await render(DashboardView, {}, root)).text;
    const HEALTH: Record<string, string> = { HEALTHY: "Healthy", PARTIAL: "Partial", FAILED: "Failed", NOT_RUN: "Not Run" };
    expect(dashboard).toContain(`Fantasy Sync ${HEALTH[health]}`);
    const sync = (await render(FantasySyncView, {}, root)).text;
    expect(sync).toMatch(/Not Configured|Fixture Simulation|Live Fantasy/);
  });
});
