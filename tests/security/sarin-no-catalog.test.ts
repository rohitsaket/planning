import { beforeAll, describe, expect, test } from "./harness";
import { call, db, ensureCountryRegistry, makeUser, resetDb } from "./helpers";
import { renderPage, routeFetch, sessionUser } from "./ui-render";
import type { ComponentType } from "react";
import { resetRateLimits } from "@/lib/api/rate-limit";
import { GET as readCatalog, POST as saveMapping } from "@/app/api/planning/sarin/shape-mappings/route";
import { POST as generateOutput } from "@/app/api/planning/sarin/imports/[batchId]/outputs/route";
import { POST as rolesPost } from "@/app/api/admin/roles/route";
import { POST as usersPost } from "@/app/api/admin/users/route";
import { WorkbookImportView } from "@/components/diamond/views/workbook-import-view";
import { SarinShapeMappingsView } from "@/components/diamond/views/sarin/sarin-shape-mappings-view";
import { processFile, processingFailureMessage, rightsOf } from "@/components/diamond/views/sarin/sarin-processing";

export const NO_CATALOG_DB = "planning_sectest_nocatalog";
type User = Awaited<ReturnType<typeof makeUser>>;
let root: User, planner: User, withMappings: User, reader: User, manager: User;

async function userWith(name: string, permissions: string[]) {
  const u = await makeUser(name, "VIEWER");
  const code = `NC_${name.toUpperCase().replace(/[^A-Z]/g, "_")}_${Date.now().toString(36).toUpperCase()}`;
  resetRateLimits();
  if ((await call(rolesPost, { method: "POST", cookie: root.cookie, body: { op: "createRole", code, name: `NC ${name}`, permissions } })).status !== 200) throw new Error("role create failed");
  resetRateLimits();
  if ((await call(usersPost, { method: "POST", cookie: root.cookie, body: { op: "setRoles", id: u.user.id, roles: [code] } })).status !== 200) throw new Error("role assign failed");
  return u;
}
const render = async <P extends object>(view: ComponentType<P>, props: P, u: User) => renderPage(view, props, await sessionUser(u.cookie), u.cookie);
const csvFile = () => {
  const name = `4${Date.now().toString().slice(-3)}N-001 DC`;
  const text = Array.from({ length: 17 }, () => [name, "3.000", "ROUND", "1.500", "VS1", "G", "61.6", "1.000", "7.62", "7.58", "4.69"].join(",")).join("\n") + "\n";
  return new File([new TextEncoder().encode(text) as BlobPart], "no-catalog.csv", { type: "text/csv" });
};

beforeAll(async () => {
  const [{ d }] = await db.$queryRaw<{ d: string }[]>`SELECT current_database() AS d`;
  if (d !== NO_CATALOG_DB) throw new Error(`refusing to run outside ${NO_CATALOG_DB}`);
  await resetDb();
  await ensureCountryRegistry(["IN"]);
  root = await makeUser("nc.root", "SUPER_ADMIN");
  planner = await makeUser("nc.planner", "PLANNER");
  withMappings = await userWith("processor", ["sarin.import.read", "sarin.import.upload", "sarin.import.validate", "sarin.output.generate", "sarin.mapping.read", "sarin.mapping.manage"]);
  reader = await userWith("processor-reader", ["sarin.import.read", "sarin.import.upload", "sarin.import.validate", "sarin.mapping.read"]);
  manager = await userWith("manager", ["sarin.mapping.read", "sarin.mapping.manage"]);
});

describe("sarin without a mapping catalog", () => {
  test("the database really has no catalog in effect: the migration refused a baseline with no rules", async () => {
    expect(await db.sarinShapeMappingSet.count({ where: { status: "EFFECTIVE" } })).toBe(0);
    const baseline = await db.sarinShapeMappingSet.findFirstOrThrow({ where: { origin: "MIGRATION_BASELINE" } });
    expect([baseline.status, await db.sarinShapeMappingRule.count({ where: { mappingSetId: baseline.id } })]).toEqual(["DRAFT", 0]);
  });

  test("Workbook Import says shape mappings are not configured and offers Open Mappings only to those who may change mappings", async () => {
    resetRateLimits();
    const list = await call((await import("@/app/api/planning/sarin/imports/route")).GET, { cookie: planner.cookie, path: "/api/planning/sarin/imports?pageSize=1" });
    expect([list.status, list.json.mappingsConfigured]).toEqual([200, false]);
    const withLink = await render(WorkbookImportView, {}, withMappings);
    const withoutLink = await render(WorkbookImportView, {}, planner);
    const readerOnly = await render(WorkbookImportView, {}, reader);
    expect([withLink.text.includes("Shape mappings are not configured."), withLink.text.includes("Open Mappings")]).toEqual([true, true]);
    expect([withoutLink.text.includes("Shape mappings are not configured."), withoutLink.text.includes("Open Mappings")]).toEqual([true, false]);
    expect([readerOnly.text.includes("Shape mappings are not configured."), readerOnly.text.includes("Open Mappings")]).toEqual([true, false]);
    const processButton = /<button([^>]*)>Process File<\/button>/.exec(withLink.html);
    expect([processButton !== null, / disabled=""/.test(processButton?.[1] ?? "")]).toEqual([true, true]);
    expect(/Approved shape mapping|Choose a mapping/i.test(withLink.text)).toBe(false);
  });

  test("processing is refused: no mapping is chosen silently, and no check or output is created", async () => {
    const rights = rightsOf((await sessionUser(withMappings.cookie)).permissions);
    const r = await processFile(routeFetch(withMappings.cookie), csvFile(), { packetType: "BLUE", labId: null, planningDate: "2026-09-28" }, rights);
    expect([r.failure?.stage, r.failure?.error.code, processingFailureMessage(r.failure!.error)]).toEqual(["checking", "MAPPINGS_NOT_CONFIGURED", "Shape mappings are not configured."]);
    const batch = await db.sarinImportBatch.findUniqueOrThrow({ where: { id: r.batchId! } });
    expect([batch.status, batch.shapeMappingSetId]).toEqual(["UPLOADED", null]);
    expect([await db.sarinValidationAttempt.count(), await db.sarinRowInterpretation.count(), await db.sarinOutputVersion.count()]).toEqual([0, 0, 0]);
    resetRateLimits();
    const generate = await call(generateOutput, { method: "POST", cookie: withMappings.cookie, body: {}, params: { batchId: r.batchId! } });
    expect([generate.status, generate.json.error.code]).toEqual([409, "IMPORT_NOT_VALIDATED"]);
    expect(await db.sarinOutputVersion.count()).toBe(0);
  });

  test("the mapping page says so too, and the first saved mapping configures the catalog", async () => {
    const page = await render(SarinShapeMappingsView, {}, manager);
    expect([page.text.includes("Shape mappings are not configured."), page.text.includes("Add Mapping")]).toEqual([true, true]);
    resetRateLimits();
    expect((await call(readCatalog, { cookie: manager.cookie, path: "/api/x" })).json.configured).toBe(false);
    resetRateLimits();
    const saved = await call(saveMapping, { method: "POST", cookie: manager.cookie, body: { sarinShape: "ROUND", fantasyShape: "Round", applyTo: "ALL_RATIOS" } });
    expect(saved.status).toBe(200);
    const first = await db.sarinShapeMappingSet.findFirstOrThrow({ where: { status: "EFFECTIVE" } });
    expect([first.copiedFromSetId, first.origin, first.approvedByUserId]).toEqual([null, "USER", null]);
    expect((await db.sarinShapeMappingSet.findFirstOrThrow({ where: { origin: "MIGRATION_BASELINE" } })).status).toBe("DRAFT");
  });
});
