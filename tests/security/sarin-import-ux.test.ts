import { beforeAll, beforeEach, describe, expect, test } from "./harness";
import { call, db, ensureLabRegistry, makeUser, resetDb } from "./helpers";
import { renderPage, routeFetch, sessionUser } from "./ui-render";
import { applyCatalog, type CatalogRule } from "./sarin-catalog";
import type { ComponentType } from "react";
import { resetRateLimits } from "@/lib/api/rate-limit";
import type { SessionUser } from "@/stores/auth-store";
import { useGlobalFilter } from "@/stores/global-filter";
import { POST as rolesPost } from "@/app/api/admin/roles/route";
import { POST as usersPost } from "@/app/api/admin/users/route";
import { GET as listImports, POST as uploadImport } from "@/app/api/planning/sarin/imports/route";
import { DELETE as archiveImport } from "@/app/api/planning/sarin/imports/[batchId]/route";
import { WorkbookImportView } from "@/components/diamond/views/workbook-import-view";
import { groupPreviewRows, SarinOutputPreview, type PreviewOption, type PreviewPiece } from "@/components/diamond/views/sarin/sarin-output-preview";
import { SarinFileResult } from "@/components/diamond/views/sarin/sarin-file-result";
import { outputPath, processFile, rightsOf, type ImportDetail } from "@/components/diamond/views/sarin/sarin-processing";

type User = Awaited<ReturnType<typeof makeUser>>;
interface Session { cookie: string; user: SessionUser }
let root: User, planner: User, mapper: User, reader: User, single: User, multi: User, labScoped: User;

const SARIN_DATA = ["SarinPlanPiece", "SarinPlanOption", "SarinOutputVersion", "SarinRowInterpretation", "SarinValidationAttempt", "SarinIssueOverride", "SarinValidationIssue", "SarinStoneBlock", "SarinSourceRow", "SarinImportBatch", "SarinSourceFileContent", "SarinSourceFile"];
const SHAPES = [["ROUND", "Round"], ["PEAR", "Pear"], ["OVAL", "Oval"], ["ASSCHER", "Asscher"], ["EMERALD", "Emerald"], ["RADIANT", "Radiant"], ["CUSHION", "Cushion Brilliant"], ["ANTIQUE CUSHION", "Antique Cushion"], ["HEART", "Heart"]] as const;
const RULES: CatalogRule[] = SHAPES.map(([rawShape, normalizedShape]) => ({ rawShape, normalizedShape }));
const COLUMNS = ["Plan", "Plan Type", "Piece", "Shape", "Est. Weight", "Clarity", "Color", "Depth %", "Ratio", "Width", "Length", "MM", "Yield %"];

let nonce = 0;
const kapan = () => `8${String(++nonce).padStart(3, "0")}X`;
interface Rec { name: string; shape?: string; est?: string; rough?: string }
const csv = (recs: Rec[]) => recs.map((r) => [r.name, r.rough ?? "3.000", r.shape ?? "ROUND", r.est ?? "1.500", "VS1", "G", "61.6", "1.000", "7.62", "7.58", "4.69"].join(",")).join("\n") + "\n";
const csvFile = (recs: Rec[]) => new File([new TextEncoder().encode(csv(recs)) as BlobPart], "sarin.csv", { type: "text/csv" });
const rows = (name: string, ests: string[], o: Partial<Rec> = {}) => ests.map((est) => ({ ...o, name, est }));
function pinkStone(name: string): Rec[] {
  const recs: Rec[] = [];
  for (const [shape] of SHAPES) recs.push({ name, shape, est: "1.000" }, { name, shape, est: "1.000" }, { name, shape: "ROUND", est: "0.200" });
  for (const shape of ["EMERALD", "ROUND", "OVAL", "ROUND", "EMERALD", "OVAL"]) recs.push({ name, shape, est: "0.500" });
  for (const shape of ["ROUND", "OVAL", "EMERALD", "RADIANT", "CUSHION", "ANTIQUE CUSHION"]) recs.push({ name, shape, est: "0.400" }, { name, shape, est: shape === "OVAL" ? "0.404" : "0.400" });
  return recs.map((r) => ({ ...r, rough: "10.000" }));
}

const sessions = new Map<User, Session>();
const as = async (u: User): Promise<Session> => {
  if (!sessions.has(u)) sessions.set(u, { cookie: u.cookie, user: await sessionUser(u.cookie) });
  return sessions.get(u)!;
};
const render = async <P extends object>(view: ComponentType<P>, props: P, u: User, headerCountry: string | null = null) => {
  const s = await as(u);
  const initial = useGlobalFilter.getInitialState();
  const saved = initial.country;
  initial.country = headerCountry;
  try {
    return await renderPage(view, props, s.user, s.cookie);
  } finally {
    initial.country = saved;
  }
};
async function userWith(name: string, permissions: string[]) {
  const u = await makeUser(name, "VIEWER");
  const code = `UX_${name.toUpperCase().replace(/[^A-Z]/g, "_")}_${Date.now().toString(36).toUpperCase()}`;
  resetRateLimits();
  if ((await call(rolesPost, { method: "POST", cookie: root.cookie, body: { op: "createRole", code, name: `Test ${name}`, permissions } })).status !== 200) throw new Error("role");
  resetRateLimits();
  if ((await call(usersPost, { method: "POST", cookie: root.cookie, body: { op: "setRoles", id: u.user.id, roles: [code] } })).status !== 200) throw new Error("assign");
  return u;
}
async function grantScope(u: User, countries: string[], labs: string[] = []) {
  await db.userAccessScope.createMany({ data: [...countries.map((value) => ({ userId: u.user.id, dimension: "COUNTRY", value })), ...labs.map((value) => ({ userId: u.user.id, dimension: "LAB", value }))] });
}

async function processed(u: User, recs: Rec[], packetType: string) {
  const rights = rightsOf((await as(u)).user.permissions);
  const result = await processFile(routeFetch(u.cookie), csvFile(recs), { packetType, labId: null, planningDate: "2026-09-28" }, rights);
  if (!result.batchId) throw new Error(`upload failed: ${result.failure?.error.code}`);
  const detail = (await (await routeFetch(u.cookie)(`/api/planning/sarin/imports/${result.batchId}`)).json()) as ImportDetail;
  return { batchId: result.batchId, versionId: detail.batch.currentOutputId!, result };
}
const api = async (u: User, path: string) => (await routeFetch(u.cookie)(path)).json() as Promise<any>;

async function upload(u: User, recs: Rec[], fields: Record<string, string>) {
  resetRateLimits();
  const fd = new FormData();
  fd.append("file", csvFile(recs));
  for (const [k, v] of Object.entries({ packetType: "BLUE", planningDate: "2026-09-28", ...fields })) fd.append(k, v);
  const encoded = new Response(fd);
  const body = new Uint8Array(await encoded.arrayBuffer());
  const res = await uploadImport(new Request("http://localhost:3000/api/planning/sarin/imports", { method: "POST", headers: { cookie: u.cookie, "content-type": encoded.headers.get("content-type")!, "content-length": String(body.length) }, body }), { params: Promise.resolve({}) } as never);
  return { status: res.status, json: (await res.json()) as any };
}
const lastRejection = async (u: User) => {
  const row = await db.auditLog.findFirst({ where: { action: "SARIN_IMPORT_UPLOAD_REJECTED", actorUserId: u.user.id }, orderBy: { timestamp: "desc" } });
  return row ? { outcome: row.outcome, ...JSON.parse(row.after!) } : null;
};

const decode = (s: string) => s.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, " ").trim();
const headers = (html: string) => [...html.matchAll(/<th scope="col"[^>]*>([\s\S]*?)<\/th>/g)].map((m) => decode(m[1]));
const accessibleHeaders = (html: string) => [...html.matchAll(/<th[^>]*scope="col"[^>]*>([\s\S]*?)<\/th>/g)].map((m) => decode(m[1].replace(/<([a-z]+)[^>]*aria-hidden="true"[^>]*>[\s\S]*?<\/\1>/g, "")));
const groupHeaders = (html: string) => [...html.matchAll(/<th scope="rowgroup"[^>]*>([\s\S]*?)<\/th>/g)].map((m) => decode(m[1]));
function dataRows(html: string) {
  return [...html.matchAll(/<tr(?: [^>]*)? class="[^"]*"[^>]*>([\s\S]*?)<\/tr>/g)]
    .map((m) => [...m[1].matchAll(/<td class="([^"]*)"[^>]*>([\s\S]*?)<\/td>/g)].map((c) => ({ cls: c[1], text: decode(c[2].replace(/<span[^>]* title="[^"]*"[^>]*>[\s\S]*?<\/span><\/span>/g, "").replace(/<span class="sr-only">[\s\S]*?<\/span>/g, "")), html: c[2] })))
    .filter((cells) => cells.length === COLUMNS.length);
}
const button = (html: string, label: string) => html.match(new RegExp(`<button[^>]*>(?:(?!</button>)[\\s\\S])*${label}(?:(?!</button>)[\\s\\S])*</button>`))?.[0] ?? "";
const disabled = (html: string, label: string) => /<button[^>]* disabled=""/.test(button(html, label));

let blue: { batchId: string; versionId: string; kapan: string };
let pink: { batchId: string; versionId: string };
let white: { batchId: string; versionId: string };

beforeAll(async () => {
  await resetDb();
  await db.$executeRawUnsafe(`TRUNCATE ${SARIN_DATA.map((t) => `"${t}"`).join(", ")}`);
  await db.userAccessScope.deleteMany({});
  await ensureLabRegistry(["GIA", "Non-Cert"]);
  root = await makeUser("ux.root", "SUPER_ADMIN");
  planner = await makeUser("ux.planner", "PLANNER");
  reader = await makeUser("ux.reader", "PLANNING_VIEWER");
  mapper = await userWith("ux.mapper", ["sarin.mapping.read", "sarin.mapping.manage"]);
  single = await makeUser("ux.single", "PLANNER");
  await grantScope(single, ["IN"]);
  multi = await makeUser("ux.multi", "PLANNER");
  await grantScope(multi, ["IN", "BE"]);
  labScoped = await makeUser("ux.labscoped", "PLANNER");
  await grantScope(labScoped, ["IN"], ["GIA"]);
  await applyCatalog(mapper.cookie, RULES);

  const k = kapan();
  const b = await processed(planner, [...rows(`${k}-001 DC`, [...Array(17).fill("1.500"), "0.500", "0.400", "0.600", "0.300"]), ...rows(`${k}-002 DC`, Array(17).fill("1.100"), { rough: "2.750" })], "BLUE");
  blue = { ...b, kapan: k };
  pink = await processed(planner, pinkStone(`${kapan()}-111_M`), "PINK");
  const whiteRecs = rows(`${kapan()}-0007 HA`, [...Array(32).fill("0.250"), "0.900", "0.800"], { rough: "10.000" });
  whiteRecs[4] = { ...whiteRecs[4], shape: "KITE-UX" };
  white = await processed(planner, whiteRecs, "WHITE");
});
beforeEach(() => resetRateLimits());

describe("sarin import ux: output preview", () => {
  test("the stone header shows the stone once: position, Kapan, packet, signer, rough weight, plan and piece counts", async () => {
    const page = await render(SarinOutputPreview, { batchId: blue.batchId, versionId: blue.versionId }, planner);
    const stone = (await api(planner, `${outputPath(blue.batchId, blue.versionId)}/stones?pageSize=1&page=1`)).rows[0];
    expect([stone.options, stone.pieces]).toEqual([19, 21]);
    const header = decode(page.html.match(/<header[\s\S]*?<\/header>/)![0]).replace(/\s+/g, " ");
    for (const part of ["Stone 1 of 2", `${blue.kapan}-001 DC`, `Kapan${blue.kapan}`, "Packet001", "SignerDC", "Rough weight3.000", "Plans19", "Output pieces21"]) {
      expect([part, header.replace(/ /g, "").includes(part.replace(/ /g, ""))]).toEqual([part, true]);
    }
  });

  test("the table has the focused columns only; Kapan, packet, signer and rough weight are not repeated per row", async () => {
    const page = await render(SarinOutputPreview, { batchId: blue.batchId, versionId: blue.versionId }, planner);
    expect(headers(page.html)).toEqual(COLUMNS);
    const body = page.html.match(/<thead[\s\S]*<\/table>/)![0];
    expect([body.includes(blue.kapan), dataRows(page.html).some((r) => r.some((c) => c.text === "DC" || c.text === "3.000"))]).toEqual([false, false]);
    expect(page.html).toContain("<caption");
  });

  test("every stored piece of the stone appears once, in stored order, with the stored values", async () => {
    const page = await render(SarinOutputPreview, { batchId: blue.batchId, versionId: blue.versionId }, planner);
    const pieces = (await api(planner, `${outputPath(blue.batchId, blue.versionId)}/pieces?stone=1&pageSize=500`)).rows;
    const shown = dataRows(page.html);
    expect(shown.length).toBe(pieces.length);
    expect(shown.map((r) => [r[3].text, r[4].text, r[5].text, r[6].text, r[7].text, r[8].text, r[9].text, r[10].text, r[11].text])).toEqual(
      pieces.map((p: any) => [p.shape, p.estimatedWeight, p.clarity, p.color, p.depthPct, p.ratio, p.width, p.length, p.depthMm]),
    );
  });

  test("each plan shows its number, type and stored yield once, on its first row", async () => {
    for (const out of [blue, pink]) {
      const page = await render(SarinOutputPreview, { batchId: out.batchId, versionId: out.versionId }, planner);
      const options = (await api(planner, `${outputPath(out.batchId, out.versionId)}/options?stone=1&pageSize=500`)).rows;
      const shown = dataRows(page.html);
      expect(shown.filter((r) => r[12].text !== "").map((r) => r[12].text)).toEqual(options.map((o: any) => `${o.yield.display}%`));
      expect(shown.filter((r) => r[0].text !== "").map((r) => Number(r[0].text))).toEqual(options.map((o: any) => o.optionSequence));
      expect(shown.filter((r) => r[1].text !== "").length).toBe(options.length);
    }
  });

  test("Blue: main plans form one striped block; each additional group has its own labelled, tinted block", async () => {
    const page = await render(SarinOutputPreview, { batchId: blue.batchId, versionId: blue.versionId }, planner);
    expect(groupHeaders(page.html)).toEqual(["Additional group 1 · 2 pieces", "Additional group 2 · 2 pieces"]);
    const bodies = [...page.html.matchAll(/<tbody class="([^"]*)"/g)].map((m) => m[1]);
    expect(bodies.length).toBe(3);
    expect([/bg-sky-50/.test(bodies[1]), /bg-slate-50/.test(bodies[2]), /bg-(sky|slate)-50/.test(bodies[0])]).toEqual([true, true, false]);
    const shown = dataRows(page.html);
    expect(shown.slice(17).map((r) => r[2].text)).toEqual(["1 of 2", "2 of 2", "1 of 2", "2 of 2"]);
    expect(shown.slice(17).map((r) => r[1].text)).toEqual(["2 Pcs", "", "2 Pcs", ""]);
    expect(/orange/.test(page.html)).toBe(false);
  });

  test("Pink: each Makeable reads with its Solace as one option; Best Pairs and Best Twins stay grouped; badges are named", async () => {
    const page = await render(SarinOutputPreview, { batchId: pink.batchId, versionId: pink.versionId }, planner);
    const groups = groupHeaders(page.html);
    expect(groups.length).toBe(18);
    expect(groups.slice(0, 9)).toEqual(SHAPES.map(([, canonical]) => `Makeable + Solace · ${canonical}`));
    expect(groups.slice(9, 12)).toEqual(["Best Pair · Emerald + Round", "Best Pair · Oval + Round", "Best Pair · Emerald + Oval"]);
    expect(groups.slice(12).every((g) => g.startsWith("Best Twin · "))).toBe(true);
    const types = dataRows(page.html).map((r) => r[1].text).filter(Boolean);
    expect(types).toEqual([...Array.from({ length: 9 }, () => ["MK", "SL"]).flat(), "BP", "BP", "BP", "BT", "BT", "BT", "BT", "BT", "BT"]);
    for (const name of ["Makeable", "Solace", "Best Pair", "Best Twin"]) expect([name, page.html.includes(`<span class="sr-only">${name}</span>`)]).toEqual([name, true]);
    const options = (await api(planner, `${outputPath(pink.batchId, pink.versionId)}/options?stone=1&pageSize=500`)).rows as PreviewOption[];
    const pieces = (await api(planner, `${outputPath(pink.batchId, pink.versionId)}/pieces?stone=1&pageSize=500`)).rows as PreviewPiece[];
    expect(groupPreviewRows(options, pieces).flatMap((g) => g.options.flatMap((o) => o.pieces.map((p) => p.outputRow)))).toEqual(pieces.map((p) => p.outputRow));
  });

  test("Previous and Next Stone are labelled buttons with clear disabled states", async () => {
    const first = await render(SarinOutputPreview, { batchId: blue.batchId, versionId: blue.versionId }, planner);
    expect([disabled(first.html, "Previous Stone"), disabled(first.html, "Next Stone"), /aria-label="Preview stones"/.test(first.html)]).toEqual([true, false, true]);
    const only = await render(SarinOutputPreview, { batchId: pink.batchId, versionId: pink.versionId }, planner);
    expect([decode(only.html).includes("Stone 1 of 1"), disabled(only.html, "Previous Stone"), disabled(only.html, "Next Stone")]).toEqual([true, true, true]);
    expect(first.requested.some((p) => /\/stones\?pageSize=1&page=1$/.test(p))).toBe(true);
  });

  test("a stone with an unmapped shape shows a warning in its header and marks the row; a clean stone shows none", async () => {
    const warned = await render(SarinOutputPreview, { batchId: white.batchId, versionId: white.versionId }, planner);
    const header = decode(warned.html.match(/<header[\s\S]*?<\/header>/)![0]);
    expect(header.includes("1 shape not mapped")).toBe(true);
    const marked = dataRows(warned.html).filter((r) => r[3].html.includes("(Sarin shape, not mapped)"));
    expect(marked.map((r) => r[3].text)).toEqual(["KITE-UX"]);
    const clean = await render(SarinOutputPreview, { batchId: blue.batchId, versionId: blue.versionId }, planner);
    expect([clean.html.includes("not mapped"), clean.html.includes("to review")]).toEqual([false, false]);
  });

  test("numbers are right-aligned tabular figures with three-decimal weights and two-decimal yields; one horizontal scroll region only", async () => {
    const page = await render(SarinOutputPreview, { batchId: pink.batchId, versionId: pink.versionId }, planner);
    const shown = dataRows(page.html);
    expect(shown.every((r) => /^\d+\.\d{3}$/.test(r[4].text))).toBe(true);
    expect(shown.filter((r) => r[12].text).every((r) => /^\d+\.\d{2}%$/.test(r[12].text))).toBe(true);
    const numeric = [0, 2, 4, 7, 8, 9, 10, 11, 12];
    expect(shown.every((r) => numeric.every((i) => r[i].cls.includes("text-right")) && [1, 3, 5, 6].every((i) => !r[i].cls.includes("text-right")))).toBe(true);
    expect(page.html).toMatch(/<table class="[^"]*tabular-nums/);
    expect([(page.html.match(/overflow-x-auto/g) ?? []).length, /overflow-auto|overflow-y-|max-h-/.test(page.html)]).toEqual([1, false]);
    expect(page.html).toMatch(/role="region" aria-label="Plans of stone [^"]+" tabindex="0"/);
  });
});

describe("sarin import ux: packet type, and no country", () => {
  test("the form asks for a Packet Type (Blue, White or Pink packet) and never for a country, whatever the scope or header filter", async () => {
    const form = (html: string) => html.match(/<form[\s\S]*<\/form>/)![0];
    const textInputs = (html: string) => html.match(/<input(?![^>]*type="(file|date)")[^>]*>/g) ?? [];
    for (const [u, header] of [[planner, null], [single, null], [multi, "BE"], [planner, "HK"], [labScoped, null]] as const) {
      const f = form((await render(WorkbookImportView, {}, u, header)).html);
      expect([u.user.username, header, /country/i.test(f), /stone[ -]?type/i.test(decode(f)), f.includes('aria-label="Packet Type"'), decode(f).includes("Packet Type"), textInputs(f)]).toEqual([u.user.username, header, false, false, true, true, []]);
    }
    const lab = (await render(WorkbookImportView, {}, labScoped)).html;
    expect([lab.includes("Lab (optional)"), /<label[^>]*>Lab<\/label>/.test(lab)]).toEqual([false, true]);
  });

  test("the upload takes packetType only as BLUE, WHITE or PINK; a country or the retired stoneType field is refused", async () => {
    const recs = () => rows(`${kapan()}-001 DC`, Array(17).fill("1.500"));
    const before = await db.sarinImportBatch.count();
    const cases: Array<[Record<string, string>, string]> = [
      [{ packetType: "GREEN" }, "INVALID_PACKET_TYPE"],
      [{ packetType: "blue" }, "INVALID_PACKET_TYPE"],
      [{ country: "IN" }, "UNKNOWN_FIELD"],
      [{ stoneType: "BLUE" }, "UNKNOWN_FIELD"],
    ];
    for (const [fields, code] of cases) {
      const r = await upload(planner, recs(), fields);
      expect([JSON.stringify(fields), r.status, r.json.error.code]).toEqual([JSON.stringify(fields), 400, code]);
    }
    expect(await db.sarinImportBatch.count()).toBe(before);
    const ok = await upload(planner, recs(), { packetType: "WHITE" });
    expect([ok.status, ok.json.batch.packetType, "country" in ok.json.batch, "stoneType" in ok.json.batch]).toEqual([201, "WHITE", false, false]);
    const audit = JSON.parse((await db.auditLog.findFirstOrThrow({ where: { action: "SARIN_IMPORT_UPLOADED", entityId: ok.json.batch.id } })).after!);
    expect([audit.packetType, "country" in audit, "stoneType" in audit]).toEqual(["WHITE", false, false]);
    const pinkOnly = await api(planner, "/api/planning/sarin/imports?packetType=PINK&pageSize=100");
    expect([pinkOnly.rows.length > 0, pinkOnly.rows.every((r: any) => r.packetType === "PINK")]).toEqual([true, true]);
    expect((await routeFetch(planner.cookie)("/api/planning/sarin/imports?packetType=GREEN")).status).toBe(400);
  });

  test("duplicate identity is file, packet type, lab and planning date; archived imports stay history", async () => {
    const recs = rows(`${kapan()}-001 DC`, Array(17).fill("1.500"));
    const first = await upload(planner, recs, {});
    expect(first.status).toBe(201);
    for (const u of [single, multi]) {
      const again = await upload(u, recs, {});
      expect([u.user.username, again.status, again.json.duplicate, again.json.batch.id]).toEqual([u.user.username, 200, true, first.json.batch.id]);
    }
    const white = await upload(planner, recs, { packetType: "WHITE" });
    const later = await upload(planner, recs, { planningDate: "2026-09-29" });
    expect([white.status, later.status, new Set([first.json.batch.id, white.json.batch.id, later.json.batch.id]).size]).toEqual([201, 201, 3]);
    resetRateLimits();
    expect((await call(archiveImport, { method: "DELETE", cookie: planner.cookie, params: { batchId: first.json.batch.id } })).status).toBe(200);
    const fresh = await upload(planner, recs, {});
    expect([fresh.status, fresh.json.batch.id !== first.json.batch.id]).toEqual([201, true]);
  });

  test("country scope does not narrow Sarin imports; lab scope still does", async () => {
    const own = await upload(planner, rows(`${kapan()}-001 DC`, Array(17).fill("1.500")), {});
    for (const u of [single, multi]) {
      expect([u.user.username, (await routeFetch(u.cookie)(`/api/planning/sarin/imports/${own.json.batch.id}`)).status]).toEqual([u.user.username, 200]);
    }
    expect((await routeFetch(labScoped.cookie)(`/api/planning/sarin/imports/${own.json.batch.id}`)).status).toBe(404);
    expect((await upload(labScoped, rows(`${kapan()}-001 DC`, Array(17).fill("1.500")), {})).status).toBe(403);
    expect(await lastRejection(labScoped)).toMatchObject({ outcome: "DENIED", packetType: "BLUE" });
    expect((await upload(labScoped, rows(`${kapan()}-001 DC`, Array(17).fill("1.500")), { labId: "GIA" })).json.batch).toMatchObject({ packetType: "BLUE", labId: "GIA" });
    const settings = async (u: User) => (await call(listImports, { cookie: u.cookie, path: "/api/planning/sarin/imports?pageSize=1" })).json.upload;
    expect([(await settings(labScoped)).labs, "countries" in (await settings(planner))]).toEqual([["GIA"], false]);
    expect((await call(listImports, { cookie: reader.cookie, path: "/api/planning/sarin/imports?pageSize=1" })).json.upload).toBe(null);
  });

  test("Recent Files and the result summary say Packet Type; the packet number stays a separate field", async () => {
    const page = await render(WorkbookImportView, {}, planner);
    const headerCells = accessibleHeaders(page.html);
    expect([headerCells.includes("Packet Type"), headerCells.includes("Lab"), headerCells.some((h) => /stone type|country/i.test(h))]).toEqual([true, true, false]);
    expect(/<th scope="col"[^>]*aria-sort="(none|ascending|descending)"[^>]*>[\s\S]*?Packet Type/.test(page.html)).toBe(true);
    const result = await render(SarinFileResult, { batchId: blue.batchId, rights: rightsOf((await as(planner)).user.permissions), failure: null, busy: false, onProcessAgain: () => {}, onProcessAnother: () => {} }, planner);
    const text = result.text.replace(/\s+/g, " ");
    expect([/Packet Type\s*Blue/.test(text), /Stones\s*2\b/.test(text), /Packet\s*001/.test(text), /stone type/i.test(text)]).toEqual([true, true, true, false]);
  });

  test("no source file describes the Blue/White/Pink packet classification as a stone type", async () => {
    const { readdirSync, readFileSync, statSync } = await import("node:fs");
    const path = await import("node:path");
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = path.join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(name)) files.push(p);
      }
    };
    walk(path.join(process.cwd(), "src"));
    const allowed = (line: string) => line.includes("stoneType: packetType,") || line.includes('original hash key "stoneType"');
    const found = files.flatMap((f) => readFileSync(f, "utf8").split("\n").map((line, i) => ({ f, i, line }))).filter(({ line }) => /stone[ _-]?types?\b|stoneType|StoneType|STONE_TYPE/i.test(line) && !allowed(line));
    expect(found.map(({ f, i }) => `${path.relative(process.cwd(), f)}:${i + 1}`)).toEqual([]);
    const all = files.map((f) => readFileSync(f, "utf8")).join("\n");
    expect([all.includes('label="Stones"'), all.includes("Rough weight"), all.includes("stoneCount")]).toEqual([true, true, true]);
  });
});
