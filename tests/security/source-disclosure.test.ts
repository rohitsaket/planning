import { beforeAll, describe, expect, test } from "./harness";
import { call, db, makeUser, resetDb } from "./helpers";
import { resetRateLimits } from "@/lib/api/rate-limit";
import { readFileSync } from "node:fs";
import { Prisma } from "@prisma/client";
import { GET as inventory } from "@/app/api/analysis/inventory/route";
import { GET as aging } from "@/app/api/analysis/aging/route";
import { GET as agingDashboard } from "@/app/api/analysis/aging-dashboard/route";
import { GET as transferCandidates } from "@/app/api/analysis/transfer-candidates/route";
import { GET as countries } from "@/app/api/analysis/countries/route";
import { GET as stockout } from "@/app/api/analysis/stockout/route";
import {
  SIMULATION_BANNER_TEXT,
  UNESTABLISHED_SOURCE,
  mergeSourceDisclosures,
  resolveSourceDisclosure,
} from "@/lib/analysis/source-disclosure";

/**
 * Simulation disclosure.
 *
 * Six Analysis views each carried their own copy of the "Fixture Simulation" banner, and
 * one editing pass removed all six while a thousand simulated lots were live in the
 * database. Every page then presented fixture output as though it were live Fantasy data.
 *
 * So the disclosure is resolved once on the server from the records the page read, and
 * rendered by one shared component. These tests hold both halves in place: the API must
 * say what the source is, and every view that can show fixture data must render the
 * shared banner rather than reinventing it.
 */

const BATCH = "DISCLOSURE-TEST";

/** Every Analysis surface that can display fixture-derived figures. */
const ANALYSIS_VIEWS = [
  "src/components/diamond/views/stockout-view.tsx",
  "src/components/diamond/views/excess-view.tsx",
  "src/components/diamond/views/reorder-signals-view.tsx",
  "src/components/diamond/views/aging-view.tsx",
  "src/components/diamond/views/aging-dashboard-view.tsx",
  "src/components/diamond/views/transfer-analyzer-view.tsx",
  "src/components/diamond/views/country-view.tsx",
  "src/components/diamond/views/executive-analysis-view.tsx",
  "src/components/diamond/views/sales-analysis-view.tsx",
  "src/components/diamond/views/customers-orders/customer-sales-view.tsx",
  "src/components/diamond/views/inventory/inventory-tabs.tsx",
];

async function makeLots(simulated: boolean, count: number) {
  await db.lotMasterRecord.createMany({
    data: Array.from({ length: count }, (_, i) => ({
      lotId: `${BATCH}-${simulated ? "SIM" : "LIVE"}-${i}`,
      currentStatus: "STOCK",
      statusEffectiveDate: new Date(),
      docDate: new Date(),
      shape: "ROUND",
      shapeNormalized: "ROUND",
      weight: new Prisma.Decimal(1),
      labNormalized: "GIA",
      labRaw: "GIA",
      quantity: new Prisma.Decimal(1),
      country: "IN",
      branch: "SRT",
      lastSyncBatchId: BATCH,
      isCurrent: true,
      roughOrPolished: "POLISHED",
      sourceType: simulated ? "FIXTURE" : "LIVE",
      isSimulated: simulated,
      inventoryClass: "PHYSICAL_AVAILABLE",
      classificationState: "CLASSIFIED",
      holdState: "NOT_HELD",
      canonicalLifecycle: "AVAILABLE",
      firstSeenAt: new Date(),
      lastSeenAt: new Date(),
    })),
  });
}

async function clearFixtures() {
  await db.lotHistoryRecord.deleteMany({ where: { syncBatchId: BATCH } });
  await db.lotMasterRecord.deleteMany({ where: { lastSyncBatchId: BATCH } });
}

describe("Source disclosure — the three states are distinct", () => {
  test("simulated data discloses simulation and carries the banner sentence", () => {
    const d = resolveSourceDisclosure({ isSimulated: true, hasData: true });
    expect({ mode: d.mode, simulated: d.simulated, banner: d.bannerText })
      .toEqual({ mode: "FIXTURE_SIMULATION", simulated: true, banner: SIMULATION_BANNER_TEXT });
  });

  test("live data discloses live and shows no banner", () => {
    const d = resolveSourceDisclosure({ isSimulated: false, hasData: true });
    expect({ mode: d.mode, simulated: d.simulated, banner: d.bannerText })
      .toEqual({ mode: "LIVE_FANTASY", simulated: false, banner: null });
  });

  test("no data is NOT_ESTABLISHED — never a claim in either direction", () => {
    // The previous code returned `sourceState: "SIMULATION"` when there was no demand run
    // at all, which asserted something about data that did not exist.
    for (const flag of [true, false, null, undefined]) {
      const d = resolveSourceDisclosure({ isSimulated: flag, hasData: false });
      expect({ flag, mode: d.mode, simulated: d.simulated })
        .toEqual({ flag, mode: "NOT_ESTABLISHED", simulated: false });
    }
    const unknown = resolveSourceDisclosure({ isSimulated: null, hasData: true });
    expect(unknown.mode).toBe("NOT_ESTABLISHED");
  });

  test("a page mixing simulated and live inputs is disclosed as simulated", () => {
    const merged = mergeSourceDisclosures([
      resolveSourceDisclosure({ isSimulated: false, hasData: true }),
      resolveSourceDisclosure({ isSimulated: true, hasData: true }),
    ]);
    expect(merged.mode).toBe("FIXTURE_SIMULATION");
    // And a page with nothing established stays unestablished.
    expect(mergeSourceDisclosures([UNESTABLISHED_SOURCE, UNESTABLISHED_SOURCE]).mode).toBe("NOT_ESTABLISHED");
  });

  test("the banner wording is fixed and cannot be softened per page", () => {
    expect(SIMULATION_BANNER_TEXT).toBe("Fixture Simulation — not live Fantasy data");
  });
});

describe("Source disclosure — every Analysis API states its source", () => {
  let cookie = "";

  beforeAll(async () => {
    await resetDb();
    await clearFixtures();
    await makeLots(true, 6);
    cookie = (await makeUser("disclosure.analyst", "DATA_ANALYST")).cookie;
  });

  test("the stock surfaces disclose simulation while simulated lots are present", async () => {
    const surfaces: Array<{ name: string; mode: string }> = [];
    for (const [name, handler, path] of [
      ["inventory position", inventory, "/api/analysis/inventory?section=position"],
      ["inventory lots", inventory, "/api/analysis/inventory?section=lots"],
      ["aging lots", aging, "/api/analysis/aging?section=lots"],
      ["aging summary", aging, "/api/analysis/aging?section=summary"],
      ["aging dashboard", agingDashboard, "/api/analysis/aging-dashboard"],
      ["transfer", transferCandidates, "/api/analysis/transfer-candidates"],
      ["countries", countries, "/api/analysis/countries"],
    ] as const) {
      resetRateLimits();
      const res = await call(handler, { path, cookie });
      expect({ name, status: res.status }).toEqual({ name, status: 200 });
      surfaces.push({ name, mode: res.json.sourceDisclosure?.mode });
    }
    expect(surfaces.filter((s) => s.mode !== "FIXTURE_SIMULATION")).toEqual([]);
  });

  test("the disclosure carries the exact banner sentence, not a per-page variant", async () => {
    resetRateLimits();
    const res = await call(aging, { path: "/api/analysis/aging?section=lots", cookie });
    expect(res.json.sourceDisclosure.bannerText).toBe(SIMULATION_BANNER_TEXT);
  });

  test("the stockout status never claims simulation for a run that does not exist", async () => {
    resetRateLimits();
    const res = await call(stockout, { path: "/api/analysis/stockout?section=status", cookie });
    expect(res.status).toBe(200);
    // Other suites share this database, so whether a run exists is not fixed. What is
    // fixed is that the disclosure follows the run: no run means nothing attributed,
    // never a claim of simulation. The previous code returned "SIMULATION" either way.
    if (res.json.hasRun) {
      expect(["FIXTURE_SIMULATION", "LIVE_FANTASY"].includes(res.json.sourceDisclosure.mode)).toBe(true);
    } else {
      expect(res.json.sourceDisclosure.mode).toBe("NOT_ESTABLISHED");
      expect(res.json.sourceDisclosure.simulated).toBe(false);
    }
  });

  test("a status built for a missing run is unestablished, proven directly", async () => {
    // The service decides this, so it is checked at the service boundary where the
    // "no run" branch is reachable regardless of what other suites left behind.
    const { readStockoutSnapshotStatus } = await import("@/lib/analysis/stockout");
    const status = await readStockoutSnapshotStatus(undefined, "run-that-does-not-exist");
    expect(status.hasRun).toBe(false);
    expect(status.sourceDisclosure.mode).toBe("NOT_ESTABLISHED");
  });

  test("an empty stock set discloses nothing rather than claiming simulation", async () => {
    resetRateLimits();
    const res = await call(aging, {
      path: "/api/analysis/aging?section=lots&country=NOWHERE",
      cookie,
    });
    expect(res.json.totals.currentLots).toBe(0);
    expect(res.json.sourceDisclosure.mode).toBe("NOT_ESTABLISHED");
  });

  test("live records disclose live", async () => {
    await clearFixtures();
    await makeLots(false, 4);
    resetRateLimits();
    const res = await call(aging, { path: `/api/analysis/aging?section=lots&search=${BATCH}`, cookie });
    expect(res.json.sourceDisclosure.mode).toBe("LIVE_FANTASY");
    expect(res.json.sourceDisclosure.simulated).toBe(false);

    // And a single simulated record among live ones is enough to disclose simulation.
    await makeLots(true, 1);
    resetRateLimits();
    const mixed = await call(aging, { path: `/api/analysis/aging?section=lots&search=${BATCH}`, cookie });
    expect(mixed.json.sourceDisclosure.mode).toBe("FIXTURE_SIMULATION");
  });
});

describe("Source disclosure — every view renders the shared banner", () => {
  test("no Analysis view is missing the banner", () => {
    const missing = ANALYSIS_VIEWS.filter((f) => !readFileSync(f, "utf8").includes("<SimulationBanner"));
    expect(missing).toEqual([]);
  });

  test("every view takes its disclosure from the API response, not a local guess", () => {
    const offenders: string[] = [];
    for (const f of ANALYSIS_VIEWS) {
      const text = readFileSync(f, "utf8");
      // The banner must be fed from a `sourceDisclosure` the server produced.
      if (!/<SimulationBanner\s+disclosure=\{[^}]*sourceDisclosure/.test(text)) offenders.push(f);
      // And never from an environment or build-time assumption.
      if (/process\.env\.NODE_ENV/.test(text)) offenders.push(`${f} (NODE_ENV)`);
    }
    expect(offenders).toEqual([]);
  });

  test("no view re-implements the banner sentence by hand", () => {
    // A hand-written copy is what allowed six of them to drift and then vanish together.
    const offenders = ANALYSIS_VIEWS.filter((f) => {
      const text = readFileSync(f, "utf8");
      return text.includes("not live Fantasy data") && !text.includes("<SimulationBanner");
    });
    expect(offenders).toEqual([]);
  });

  test("the shared component refuses to render for live or unestablished sources", () => {
    const source = readFileSync("src/components/diamond/shared/simulation-banner.tsx", "utf8");
    expect(source.includes("if (!disclosure?.simulated || !disclosure.bannerText) return null;")).toBe(true);
  });

  test("the shared component actually renders the banner", () => {
    // A component stubbed to `return null` would satisfy every other check here while
    // disclosing nothing on any page, which is the failure mode this whole suite exists
    // to prevent. So the render path itself is asserted.
    const source = readFileSync("src/components/diamond/shared/simulation-banner.tsx", "utf8");
    const body = source.slice(source.indexOf("export function SimulationBanner"));
    const fn = body.slice(0, body.indexOf("export function SourceBadge"));
    expect(fn.includes("<InfoBanner")).toBe(true);
    expect(fn.includes("{disclosure.bannerText}")).toBe(true);
    // Exactly one early return, the guard above — not an unconditional one.
    expect(fn.split("return null;").length - 1).toBe(1);
  });

  test("exports keep their own simulated-data notice", () => {
    // The screen banner and the file notice are separate disclosures: a CSV is read away
    // from the page that produced it.
    const stockoutExport = readFileSync("src/app/api/analysis/stockout/export/route.ts", "utf8");
    expect(/SIMULATED\s*\/\s*TEST FIXTURE DATA/.test(stockoutExport)).toBe(true);
  });
});
