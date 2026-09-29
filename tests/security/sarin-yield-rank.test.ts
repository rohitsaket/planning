// Sarin yield-rank highlighting (design v1.7 §15.13, as the client's reference workbooks
// apply it): per stone, the three highest stored yields over all options — Blue/White main
// plans and additional groups, Pink MK, SL, BP and BT — one rank per logical option,
// computed once on the server (sarin/yield-rank.ts) and shown identically by the preview,
// a reopened output and the XLSX. CSV stays plain data.
//
// Requests go through the real route handlers against the isolated planning_sectest
// database; outputs are real multi-piece structures processed by the page's own code.
// All data is synthetic.

import { beforeAll, beforeEach, describe, expect, test } from "./harness";
import { call, db, ensureCountryRegistry, makeUser, resetDb } from "./helpers";
import { renderPage, routeFetch, sessionUser } from "./ui-render";
import { inspectWorkbook, type InspectedWorkbook } from "./workbook-inspect";
import { applyCatalog, type CatalogRule } from "./sarin-catalog";
import type { ComponentType } from "react";
import { Prisma } from "@prisma/client";
import { resetRateLimits } from "@/lib/api/rate-limit";
import type { SessionUser } from "@/stores/auth-store";
import { POST as rolesPost } from "@/app/api/admin/roles/route";
import { POST as usersPost } from "@/app/api/admin/users/route";
import { rankYieldOptions, type YieldRankCandidate } from "@/lib/sarin/yield-rank";
import { SARIN_YIELD_RANK_STYLE } from "@/lib/sarin/yield-rank-style";
import { SarinOutputPreview } from "@/components/diamond/views/sarin/sarin-output-preview";
import { SarinFileResult } from "@/components/diamond/views/sarin/sarin-file-result";
import { outputPath, processFile, rightsOf, type ImportDetail } from "@/components/diamond/views/sarin/sarin-processing";

type User = Awaited<ReturnType<typeof makeUser>>;
interface Session { cookie: string; user: SessionUser }
let root: User, planner: User, mapper: User;

const SARIN_DATA = ["SarinPlanPiece", "SarinPlanOption", "SarinOutputVersion", "SarinRowInterpretation", "SarinValidationAttempt", "SarinIssueOverride", "SarinValidationIssue", "SarinStoneBlock", "SarinSourceRow", "SarinImportBatch", "SarinSourceFileContent", "SarinSourceFile"];
const SHAPES = [["ROUND", "Round"], ["PEAR", "Pear"], ["OVAL", "Oval"], ["ASSCHER", "Asscher"], ["EMERALD", "Emerald"], ["RADIANT", "Radiant"], ["CUSHION", "Cushion Brilliant"], ["ANTIQUE CUSHION", "Antique Cushion"], ["HEART", "Heart"]] as const;
const RULES: CatalogRule[] = SHAPES.map(([rawShape, normalizedShape]) => ({ rawShape, normalizedShape }));
const [GREEN, YELLOW, ORANGE] = [SARIN_YIELD_RANK_STYLE[1].fill, SARIN_YIELD_RANK_STYLE[2].fill, SARIN_YIELD_RANK_STYLE[3].fill];
const RANK_FILLS = [GREEN, YELLOW, ORANGE];

// ---- synthetic files ------------------------------------------------------------------------
let nonce = 0;
const kapan = () => `5${String(++nonce).padStart(3, "0")}R`;
interface Rec { name: string; shape?: string; est?: string; rough?: string }
const csv = (recs: Rec[]) => recs.map((r) => [r.name, r.rough ?? "3.000", r.shape ?? "ROUND", r.est ?? "1.000", "VS1", "G", "61.6", "1.000", "7.62", "7.58", "4.69"].join(",")).join("\n") + "\n";
const csvFile = (recs: Rec[]) => new File([new TextEncoder().encode(csv(recs)) as BlobPart], "sarin.csv", { type: "text/csv" });
const rows = (name: string, ests: string[], o: Partial<Rec> = {}) => ests.map((est) => ({ ...o, name, est }));
/** Pink: MK 1.000 (10 %), SL 1.000 + 0.200 (12 %), BP pairs, BT twins; one BP at 14 %. */
function pinkStone(name: string): Rec[] {
  const recs: Rec[] = [];
  for (const [shape] of SHAPES) recs.push({ name, shape, est: "1.000" }, { name, shape, est: "1.000" }, { name, shape: "ROUND", est: "0.200" });
  const bp = [["EMERALD", "0.700"], ["ROUND", "0.700"], ["OVAL", "0.500"], ["ROUND", "0.500"], ["EMERALD", "0.500"], ["OVAL", "0.500"]];
  for (const [shape, est] of bp) recs.push({ name, shape, est });
  for (const shape of ["ROUND", "OVAL", "EMERALD", "RADIANT", "CUSHION", "ANTIQUE CUSHION"]) recs.push({ name, shape, est: "0.400" }, { name, shape, est: shape === "OVAL" ? "0.404" : "0.400" });
  return recs.map((r) => ({ ...r, rough: "10.000" }));
}

// ---- sessions ---------------------------------------------------------------------------------
const sessions = new Map<User, Session>();
const as = async (u: User): Promise<Session> => {
  if (!sessions.has(u)) sessions.set(u, { cookie: u.cookie, user: await sessionUser(u.cookie) });
  return sessions.get(u)!;
};
const render = async <P extends object>(view: ComponentType<P>, props: P, u: User = planner) => {
  const s = await as(u);
  return renderPage(view, props, s.user, s.cookie);
};
async function userWith(name: string, permissions: string[]) {
  const u = await makeUser(name, "VIEWER");
  const code = `RANK_${name.toUpperCase().replace(/[^A-Z]/g, "_")}_${Date.now().toString(36).toUpperCase()}`;
  resetRateLimits();
  if ((await call(rolesPost, { method: "POST", cookie: root.cookie, body: { op: "createRole", code, name: `Test ${name}`, permissions } })).status !== 200) throw new Error("role");
  resetRateLimits();
  if ((await call(usersPost, { method: "POST", cookie: root.cookie, body: { op: "setRoles", id: u.user.id, roles: [code] } })).status !== 200) throw new Error("assign");
  return u;
}
interface Output { batchId: string; versionId: string }
async function processed(recs: Rec[], packetType: string): Promise<Output> {
  const rights = rightsOf((await as(planner)).user.permissions);
  const result = await processFile(routeFetch(planner.cookie), csvFile(recs), { packetType, labId: null, planningDate: "2026-09-28" }, rights);
  if (!result.batchId) throw new Error(`upload failed: ${result.failure?.error.code}`);
  const detail = (await (await routeFetch(planner.cookie)(`/api/planning/sarin/imports/${result.batchId}`)).json()) as ImportDetail;
  if (!detail.batch.currentOutputId) throw new Error(`no output: ${detail.batch.status}`);
  return { batchId: result.batchId, versionId: detail.batch.currentOutputId };
}
const api = async (path: string) => (await routeFetch(planner.cookie)(path)).json() as Promise<any>;
/** Every option of every stone, with the server's rank. */
async function apiOptions(o: Output) {
  const r = await api(`${outputPath(o.batchId, o.versionId)}/options?pageSize=500`);
  return r.rows as Array<{ id: string; stone: { sequence: number }; optionSequence: number; kind: string; pieceCount: number; yield: { percent: string; display: string }; yieldRank: 1 | 2 | 3 | null; outputRows: { first: number; last: number } }>;
}
const rankedIds = async (o: Output) => (await apiOptions(o)).filter((x) => x.yieldRank !== null).map((x) => `${x.stone.sequence}:${x.yieldRank}:${x.id}`).sort();
async function workbook(o: Output): Promise<InspectedWorkbook> {
  const res = await routeFetch(planner.cookie)(`${outputPath(o.batchId, o.versionId)}/workbook`);
  if (res.status !== 200) throw new Error(`workbook ${res.status}`);
  return inspectWorkbook(new Uint8Array(await res.arrayBuffer()));
}
/** Workbook rank fills per sheet: RRGGBB → the sorted cell refs that carry it. */
function rankCells(wb: InspectedWorkbook, sheet = 1) {
  const out: Record<string, string[]> = {};
  for (const c of wb.cellFills(sheet)) if (c.fill && RANK_FILLS.includes(c.fill)) (out[c.fill] ??= []).push(c.ref);
  return out;
}
/** Preview rows carrying a rank: [rank, output row position within the stone]. */
const previewRanks = (html: string) => [...html.matchAll(/<tr style="background-color:#([0-9A-F]{6})" data-yield-rank="(\d)"/g)].map((m) => [Number(m[2]), m[1]] as const);

let blue: Output, white: Output, pink: Output;

beforeAll(async () => {
  await resetDb();
  await db.$executeRawUnsafe(`TRUNCATE ${SARIN_DATA.map((t) => `"${t}"`).join(", ")}`);
  await db.userAccessScope.deleteMany({});
  await ensureCountryRegistry(["IN"]);
  root = await makeUser("rank.root", "SUPER_ADMIN");
  planner = await makeUser("rank.planner", "PLANNER");
  mapper = await userWith("rank.mapper", ["sarin.mapping.read", "sarin.mapping.manage"]);
  await applyCatalog(mapper.cookie, RULES);
  const k = kapan();
  // Stone 1 (rough 3.000): 17 mains of 1.000 (33.33 %) except plan 5 at 1.500 (50 %) and plan 9 at
  // 1.400; then a 3-piece group 0.900+0.800+0.700 (80 %) and a 2-piece group 0.750+0.200 (a group
  // starts when the weight rises).
  const mains1 = Array.from({ length: 17 }, (_, i) => (i === 4 ? "1.500" : i === 8 ? "1.400" : "1.000"));
  // Stone 2: all mains 1.100 except plan 6 at 1.200; one 2-piece group 0.300+0.200. Three plans
  // tie at 1.100 behind plan 6, so the tie resolves by plan sequence.
  const mains2 = Array.from({ length: 17 }, (_, i) => (i === 5 ? "1.200" : "1.100"));
  blue = await processed([...rows(`${k}-001 DC`, [...mains1, "0.900", "0.800", "0.700", "0.750", "0.200"]), ...rows(`${k}-002 DC`, [...mains2, "0.300", "0.200"])], "BLUE");
  // White (rough 10.000): 32 mains of 0.250 except plan 20 at 1.000; groups 0.900+0.800 (17 %) and
  // 0.850+0.400+0.250 (15 %); the top group carries a shape with no mapping.
  const w = rows(`${kapan()}-0007 HA`, [...Array.from({ length: 32 }, (_, i) => (i === 19 ? "1.000" : "0.250")), "0.900", "0.800", "0.850", "0.400", "0.250"], { rough: "10.000" });
  w[33] = { ...w[33], shape: "KITE-RANK" };
  white = await processed(w, "WHITE");
  pink = await processed(pinkStone(`${kapan()}-111_M`), "PINK");
});
beforeEach(() => resetRateLimits());

// =========================================================================================
describe("sarin yield rank: the shared ranking rule", () => {
  const c = (stoneId: string, optionId: string, optionSequence: number, pct: string | null, pieceCount = 1, rows = pieceCount): YieldRankCandidate => ({
    stoneId, optionId, optionSequence, pieceCount, yieldPercent: pct === null ? null : new Prisma.Decimal(pct), outputRows: Array.from({ length: rows }, (_, i) => optionSequence * 10 + i),
  });
  const ranks = (cs: YieldRankCandidate[]) => Object.fromEntries(rankYieldOptions(cs).map((r) => [r.optionId, r.rank]));

  test("ranks per stone, highest first, at most three; the fourth and lower are unranked", () => {
    const cs = [c("s1", "a", 1, "30.0000000000"), c("s1", "b", 2, "40.0000000000", 3), c("s1", "c", 3, "35.0000000000"), c("s1", "d", 4, "20.0000000000"), c("s1", "e", 5, "10.0000000000"), c("s2", "f", 1, "5.0000000000"), c("s2", "g", 2, "6.0000000000")];
    expect(ranks(cs)).toEqual({ a: 3, b: 1, c: 2, d: null, e: null, f: 2, g: 1 });
    // A multi-row option is one candidate with one rank, and keeps all its output rows.
    const b = rankYieldOptions(cs).find((r) => r.optionId === "b")!;
    expect([b.rank, b.outputRows, b.yieldPercent]).toEqual([1, [20, 21, 22], "40.0000000000"]);
  });

  test("the exact stored decimal decides, not the two-place display", () => {
    // Both display 31.74 %.
    expect(ranks([c("s", "low", 1, "31.7412345678"), c("s", "high", 2, "31.7412345679")])).toEqual({ low: 2, high: 1 });
  });

  test("ties resolve by option sequence, then option id, whatever the input order", () => {
    const cs = [c("s", "z", 3, "12.0000000000"), c("s", "y", 2, "12.0000000000"), c("s", "x", 1, "12.0000000000"), c("s", "w", 4, "12.0000000000")];
    expect(ranks(cs)).toEqual({ x: 1, y: 2, z: 3, w: null });
    expect(ranks([...cs].reverse())).toEqual(ranks(cs));
    expect(ranks([c("s", "b", 1, "9.0000000000"), c("s", "a", 1, "9.0000000000")])).toEqual({ a: 1, b: 2 });
  });

  test("fewer than three eligible options rank only those; invalid or incomplete yields are excluded", () => {
    expect(ranks([c("s", "only", 1, "50.0000000000"), c("s", "none", 2, null)])).toEqual({ only: 1, none: null });
    const invalid = [c("s", "neg", 1, "-1.0000000000"), c("s", "nan", 2, "NaN"), c("s", "short", 3, "90.0000000000", 3, 2), c("s", "empty", 4, "95.0000000000", 0, 0), c("s", "ok", 5, "1.0000000000")];
    expect(ranks(invalid)).toEqual({ neg: null, nan: null, short: null, empty: null, ok: 1 });
    expect(rankYieldOptions(invalid).find((r) => r.optionId === "short")!.yieldPercent).toBe(null);
  });
});

// =========================================================================================
describe("sarin yield rank: stored outputs", () => {
  test("Blue: ranks restart per stone over mains and groups; the 17-main boundary is unchanged", async () => {
    const options = await apiOptions(blue);
    const stone = (n: number) => options.filter((o) => o.stone.sequence === n);
    expect([stone(1).filter((o) => o.kind === "MAIN").length, stone(1).filter((o) => o.kind === "ADDITIONAL").map((o) => o.pieceCount)]).toEqual([17, [3, 2]]);
    expect(stone(1).filter((o) => o.yieldRank).map((o) => [o.yieldRank, o.kind, o.optionSequence, o.yield.display])).toEqual([
      [2, "MAIN", 5, "50.00"], [3, "MAIN", 9, "46.67"], [1, "ADDITIONAL", 18, "80.00"],
    ]);
    // Stone 2: plan 6 first, then the 1.100 tie resolved by plan sequence (plans 1 and 2).
    expect(stone(2).filter((o) => o.yieldRank).map((o) => [o.yieldRank, o.optionSequence])).toEqual([[2, 1], [3, 2], [1, 6]]);
    // The rank is computed over the whole stone even when a page holds only some of its options.
    const kindOnly = (await api(`${outputPath(blue.batchId, blue.versionId)}/options?stone=1&kind=ADDITIONAL&pageSize=500`)).rows;
    expect(kindOnly.map((o: any) => o.yieldRank)).toEqual([1, null]);
  });

  test("White: the 32-main boundary is unchanged; a group with an unmapped shape is still ranked", async () => {
    const options = await apiOptions(white);
    expect([options.filter((o) => o.kind === "MAIN").length, options.filter((o) => o.kind === "ADDITIONAL").map((o) => o.pieceCount)]).toEqual([32, [2, 3]]);
    expect(options.filter((o) => o.yieldRank).map((o) => [o.yieldRank, o.kind, o.optionSequence, o.yield.display])).toEqual([
      [3, "MAIN", 20, "10.00"], [1, "ADDITIONAL", 33, "17.00"], [2, "ADDITIONAL", 34, "15.00"],
    ]);
  });

  test("Pink: MK+SL and BP/BT structure is unchanged; the BP pair ranks first, SL ties resolve by sequence", async () => {
    const options = await apiOptions(pink);
    expect(options.map((o) => o.kind)).toEqual([...Array.from({ length: 9 }, () => ["MK", "SL"]).flat(), "BP", "BP", "BP", "BT", "BT", "BT", "BT", "BT", "BT"]);
    expect(options.filter((o) => o.yieldRank).map((o) => [o.yieldRank, o.kind, o.optionSequence, o.pieceCount, o.yield.display])).toEqual([
      [2, "SL", 2, 2, "12.00"], [3, "SL", 4, 2, "12.00"], [1, "BP", 19, 2, "14.00"],
    ]);
  });
});

// =========================================================================================
describe("sarin yield rank: preview", () => {
  test("every row of a ranked option carries its rank colour; the rank is labelled once; other rows are plain", async () => {
    const page = await render(SarinOutputPreview, { batchId: blue.batchId, versionId: blue.versionId });
    // Stone 1 in output order: plan 5 (2nd), plan 9 (3rd), the three rows of the 3-piece group (1st).
    expect(previewRanks(page.html)).toEqual([[2, YELLOW], [3, ORANGE], [1, GREEN], [1, GREEN], [1, GREEN]]);
    for (const label of ["1st — Highest Yield", "2nd — Second Highest", "3rd — Third Highest"]) {
      expect([label, (page.html.match(new RegExp(`<span class="sr-only">${label}, </span>`, "g")) ?? []).length]).toEqual([label, 1]);
    }
    // The stone header is never coloured as a plan.
    expect(/<header[^>]*style=/.test(page.html)).toBe(false);
  });

  test("Pink: the ranked BP pair and SL options are coloured on both of their rows", async () => {
    const page = await render(SarinOutputPreview, { batchId: pink.batchId, versionId: pink.versionId });
    expect(previewRanks(page.html)).toEqual([[2, YELLOW], [2, YELLOW], [3, ORANGE], [3, ORANGE], [1, GREEN], [1, GREEN]]);
  });

  test("a ranked group with an unmapped shape keeps its warning; reopening the output shows the same ranks", async () => {
    const page = await render(SarinOutputPreview, { batchId: white.batchId, versionId: white.versionId });
    expect(previewRanks(page.html)).toEqual([[3, ORANGE], [1, GREEN], [1, GREEN], [2, YELLOW], [2, YELLOW], [2, YELLOW]]);
    expect([page.text.includes("1 shape not mapped"), page.html.includes("(Sarin shape, not mapped)")]).toEqual([true, true]);
    // Opened again from Recent Files: the result view renders the same preview and ranks.
    const reopened = await render(SarinFileResult, { batchId: white.batchId, rights: rightsOf((await as(planner)).user.permissions), failure: null, busy: false, onProcessAgain: () => {}, onProcessAnother: () => {} });
    expect([previewRanks(reopened.html), reopened.text.includes("Output Ready with Warnings")]).toEqual([previewRanks(page.html), true]);
  });
});

// =========================================================================================
describe("sarin yield rank: XLSX", () => {
  test("Blue/White fill only the ranked option's Yield % cells (every row of a merge); groups keep H–Q shading", async () => {
    const wb = await workbook(blue);
    const [s1] = wb.sheetNames;
    // Sheet rows: header 1; stone 1 rows 2..23 (plan 5 = row 6, plan 9 = row 10, group rows 19..21); stone 2 rows 24..42.
    expect(rankCells(wb)).toEqual({ [GREEN]: ["R19", "R20", "R21", "R29"], [YELLOW]: ["R6", "R24"], [ORANGE]: ["R10", "R25"] });
    expect(wb.merges(s1).filter((m) => m.startsWith("R"))).toEqual(["R19:R21", "R22:R23", "R41:R42"]);
    const fills = new Map(wb.cellFills(1).map((c) => [c.ref, c.fill]));
    expect(["H19", "Q21", "A19", "G19", "S19", "A2", "Q6", "S6"].map((r) => fills.get(r))).toEqual(["DCEEFF", "DCEEFF", null, null, null, "D9DDE0", null, null]);
    // White: plan 20 orange, then the two groups; nothing outside R is rank-coloured.
    const w = rankCells(await workbook(white));
    expect(w).toEqual({ [GREEN]: ["R34", "R35"], [YELLOW]: ["R36", "R37", "R38"], [ORANGE]: ["R21"] });
  });

  test("Pink fills H–R of every row of the ranked option, within A:S", async () => {
    const wb = await workbook(pink);
    const cols = "HIJKLMNOPQR".split("");
    const rowsOf = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i).flatMap((r) => cols.map((c) => `${c}${r}`));
    const sort = (a: string[]) => [...a].sort((x, y) => x.localeCompare(y, "en", { numeric: true }));
    // SL options 2 (rows 3-4) and 4 (rows 6-7); BP option 19 (rows 29-30).
    expect(Object.fromEntries(Object.entries(rankCells(wb)).map(([k, v]) => [k, sort(v)]))).toEqual({ [GREEN]: sort(rowsOf(29, 30)), [YELLOW]: sort(rowsOf(3, 4)), [ORANGE]: sort(rowsOf(6, 7)) });
  });

  test("header, number formats, boundary and formula policy are unchanged", async () => {
    for (const o of [blue, white, pink]) {
      const wb = await workbook(o);
      const all = wb.cellFills(1);
      expect(all.filter((c) => c.row === 1).every((c) => c.fill === "E7B84B")).toBe(true);
      expect(all.filter((c) => c.row === 1).length).toBe(19);
      expect(all.filter((c) => c.col.length > 1 || c.col > "S").length).toBe(0);
      const sheet = wb.sheetXml(1);
      expect([/<conditionalFormatting|<dataValidations/.test(sheet), /<f[ >]/.test(wb.parts.map((p) => wb.part(p)).join(""))]).toEqual([false, false]);
      const r = wb.rows(wb.sheetNames[0]);
      expect([r[1][9]!.z, r[1][17]!.z]).toEqual(["0.000", "0.00%"]);
      expect(wb.part("xl/styles.xml").match(/<xf [^>]*?(?:\/>|>)/)?.[0]).toBe('<xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>');
    }
  });

  test("preview, API and XLSX pick the same option identities; repeated exports, later mappings and other files change nothing", async () => {
    const before = await rankedIds(blue);
    const cellsBefore = JSON.stringify(rankCells(await workbook(blue)));
    // The workbook's ranked rows map back to the API's ranked options through their stored output rows.
    const options = await apiOptions(blue);
    const sheetRowOf = (outputRow: number) => outputRow + 1;
    const fromApi = options.filter((o) => o.yieldRank).flatMap((o) => Array.from({ length: o.pieceCount }, (_, i) => `R${sheetRowOf(o.outputRows.first + i)}:${RANK_FILLS[o.yieldRank! - 1]}`)).sort();
    const fromXlsx = Object.entries(rankCells(await workbook(blue))).flatMap(([fill, refs]) => refs.map((r) => `${r}:${fill}`)).sort();
    expect(fromXlsx).toEqual(fromApi);
    // A later mapping change and another processed file leave this version's ranks alone.
    await applyCatalog(mapper.cookie, RULES.filter((r) => r.rawShape !== "HEART"));
    await processed(rows(`${kapan()}-001 DC`, [...Array(17).fill("2.000"), "0.100", "0.050"]), "BLUE");
    await applyCatalog(mapper.cookie, RULES);
    expect(await rankedIds(blue)).toEqual(before);
    expect(JSON.stringify(rankCells(await workbook(blue)))).toBe(cellsBefore);
    expect(JSON.stringify(rankCells(await workbook(blue)))).toBe(cellsBefore);
  });

  test("CSV stays plain data: no rank or colour markup", async () => {
    const res = await routeFetch(planner.cookie)(`${outputPath(blue.batchId, blue.versionId)}/export`);
    const text = await res.text();
    expect([res.status, /rank|C6EFCE|FFF2B2|F4D0A4|highest/i.test(text)]).toEqual([200, false]);
  });
});
