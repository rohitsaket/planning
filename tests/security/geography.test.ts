import { beforeAll, describe, expect, test } from "./harness";
import { call, db, makeUser, resetDb } from "./helpers";
import { resetRateLimits } from "@/lib/api/rate-limit";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { Prisma } from "@prisma/client";
import { GET as countries } from "@/app/api/analysis/countries/route";
import { GET as transferCandidates } from "@/app/api/analysis/transfer-candidates/route";
import {
  EMPTY_GEOGRAPHY_FILTERS,
  GEOGRAPHIC_DEMAND_UNAVAILABLE_MESSAGE,
  readSalesByGeography,
} from "@/lib/analysis/geography";

/**
 * Country & Branch.
 *
 * The defect these tests pin is a contradiction rather than a miscalculation. The
 * authoritative demand result has no country and no branch column, so a location-level
 * shortage cannot be derived from it. The Transfer Analyzer said so on screen; the
 * Country page reported a shortage, an excess and a transfer-candidate count anyway,
 * taken from seeded demonstration tables. Two pages on the same data, two answers.
 *
 * So the assertions below are mostly about absence: no geographic demand figure reaches
 * the browser, however the data is arranged to tempt one out. What remains is checked for
 * being real — the same snapshot Customers & Orders reads, and the same inventory summary
 * every other stock surface reads.
 */

const BATCH = "GEO-TEST";

/** Every object key anywhere in a response, so a leak is found by name, not by prose. */
function responseKeys(value: unknown, acc: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) responseKeys(item, acc);
  } else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      acc.add(key);
      responseKeys(child, acc);
    }
  }
  return acc;
}

/**
 * Requirements and polished mirror rows in the shape that used to produce a country
 * shortage of 7, an excess of 5 and a cross-country transfer candidate. They exist here
 * purely so their absence from the response means something.
 */
async function seedTemptingGeographicData() {
  const band = await db.weightBand.findFirst({ where: { active: true }, select: { id: true } });
  if (!band) return;
  await db.requirement.create({
    data: {
      requirementCode: `${BATCH}-REQ-IN-1`, type: "STOCK_REPLENISHMENT", groupCode: "G", companyCode: "C",
      country: "IN", branch: "Surat", labNormalized: "GIA", shape: "ROUND", weightBandId: band.id, requiredQty: 2,
    },
  });
  await db.requirement.create({
    data: {
      requirementCode: `${BATCH}-REQ-HK-1`, type: "STOCK_REPLENISHMENT", groupCode: "G", companyCode: "C",
      country: "HK", branch: "Central HK", labNormalized: "GIA", shape: "ROUND", weightBandId: band.id, requiredQty: 4,
    },
  });
}

async function seedCurrentStock() {
  await db.lotMasterRecord.createMany({
    data: [
      // Country codes no other suite writes, so these assertions count the records this
      // suite created rather than whatever else the shared database happens to hold.
      { country: "ZA", branch: "Geo Alpha" },
      { country: "ZA", branch: "Geo Alpha" },
      { country: "ZB", branch: "Geo Beta" },
    ].map((loc, i) => ({
      lotId: `${BATCH}-LOT-${i}`,
      currentStatus: "STOCK",
      statusEffectiveDate: new Date(),
      docDate: new Date(),
      shape: "ROUND",
      shapeNormalized: "ROUND",
      weight: new Prisma.Decimal(1.1),
      labNormalized: "GIA",
      quantity: new Prisma.Decimal(1),
      country: loc.country,
      branch: loc.branch,
      lastSyncBatchId: BATCH,
      isCurrent: true,
      roughOrPolished: "POLISHED",
      sourceType: "FIXTURE",
      isSimulated: true,
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
  await db.requirement.deleteMany({ where: { requirementCode: { startsWith: BATCH } } });
  await db.lotHistoryRecord.deleteMany({ where: { syncBatchId: BATCH } });
  await db.lotMasterRecord.deleteMany({ where: { lastSyncBatchId: BATCH } });
}

describe("Country & Branch — authorization", () => {
  beforeAll(async () => { await resetDb(); await clearFixtures(); });

  test("anonymous requests are denied", async () => {
    resetRateLimits();
    const res = await call(countries, { path: "/api/analysis/countries" });
    expect(res.status).toBe(401);
  });

  test("a signed-in user without analysis.read is denied", async () => {
    const integration = await makeUser("geo.integration", "FANTASY_INTEGRATION");
    resetRateLimits();
    const res = await call(countries, { path: "/api/analysis/countries", cookie: integration.cookie });
    expect(res.status).toBe(403);
  });

  test("an authorized analyst may read it", async () => {
    const analyst = await makeUser("geo.analyst", "DATA_ANALYST");
    resetRateLimits();
    const res = await call(countries, { path: "/api/analysis/countries", cookie: analyst.cookie });
    expect(res.status).toBe(200);
  });
});

describe("Country & Branch — no geographic demand is invented", () => {
  beforeAll(async () => {
    await clearFixtures();
    await seedTemptingGeographicData();
    await seedCurrentStock();
  });

  test("the response states plainly that geographic demand is unavailable", async () => {
    const analyst = await makeUser("geo.unavailable", "DATA_ANALYST");
    resetRateLimits();
    const res = await call(countries, { path: "/api/analysis/countries", cookie: analyst.cookie });
    expect(res.status).toBe(200);
    expect(res.json.geographicDemandAvailable).toBe(false);
    expect(res.json.geographicDemandMessage).toBe(GEOGRAPHIC_DEMAND_UNAVAILABLE_MESSAGE);
  });

  test("no shortage, excess, transfer or plan figure reaches the browser", async () => {
    const analyst = await makeUser("geo.fields", "DATA_ANALYST");
    resetRateLimits();
    const res = await call(countries, { path: "/api/analysis/countries", cookie: analyst.cookie });
    // Field names, not substrings: the explanatory text legitimately contains the words
    // "shortage", "excess" and "target" while saying that none of them can be computed.
    const leaked = [...responseKeys(res.json)].filter((key) =>
      [
        "physicalShortage",
        "excess",
        "target",
        "transferCandidates",
        "transferStatus",
        "pipelineRequirement",
        "remainingUnplanned",
        "approvedPlanCoverage",
        "planCov",
        "categoriesWithShortage",
        "categoriesWithExcess",
        "eligibleWip",
        "wip",
      ].includes(key),
    );
    expect(leaked).toEqual([]);
  });

  test("seeded requirements and the polished mirror do not reach the response", async () => {
    // The seeded rows above are exactly what the previous implementation read.
    const analyst = await makeUser("geo.seeded", "DATA_ANALYST");
    resetRateLimits();
    const res = await call(countries, { path: "/api/analysis/countries", cookie: analyst.cookie });
    expect(JSON.stringify(res.json).includes(BATCH + "-REQ")).toBe(false);
  });

  test("the Country page and the Transfer Analyzer give the same reason", async () => {
    const analyst = await makeUser("geo.agree", "DATA_ANALYST");
    resetRateLimits();
    const country = await call(countries, { path: "/api/analysis/countries", cookie: analyst.cookie });
    resetRateLimits();
    const transfer = await call(transferCandidates, { path: "/api/analysis/transfer-candidates", cookie: analyst.cookie });

    // Both must say demand is not calculated per location, and neither may offer a
    // recommendation. The contradiction was that one of them did.
    expect(country.json.geographicDemandMessage).toContain("not currently calculated by country or branch");
    expect(String(transfer.json.unavailableMessage)).toContain("not currently calculated by country or branch");
    expect(transfer.json.recommendationsAvailable).toBe(false);
    expect(country.json.geographicDemandAvailable).toBe(false);
  });

  test("the legacy stock-position analytics module is gone, not merely unused", async () => {
    let present = true;
    try {
      readFileSync("src/lib/analytics/stock-position.ts", "utf8");
    } catch {
      present = false;
    }
    expect(present).toBe(false);
  });

  test("nothing imports the removed module", () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.tsx?$/.test(entry.name)) {
          const text = readFileSync(full, "utf8");
          if (/analytics\/stock-position|analyzeTransfers|computeTransferCandidates/.test(text)) {
            offenders.push(full.split(path.sep).join("/"));
          }
        }
      }
    };
    for (const root of ["src", "scripts"]) walk(root);
    expect(offenders).toEqual([]);
  });
});

describe("Country & Branch — what it does report is factual", () => {
  beforeAll(async () => {
    await clearFixtures();
    await seedCurrentStock();
  });

  test("current inventory by location comes from the shared stock summary", async () => {
    const analyst = await makeUser("geo.inventory", "DATA_ANALYST");
    resetRateLimits();
    const res = await call(countries, { path: "/api/analysis/countries?country=ZA", cookie: analyst.cookie });
    const rows = res.json.inventory.byLocation as Array<{ label: string; lotCount: number }>;
    expect(rows.map((r) => r.label)).toEqual(["ZA / Geo Alpha"]);
    expect({ lots: rows[0]?.lotCount, currentLots: res.json.inventory.currentLots })
      .toEqual({ lots: 2, currentLots: 2 });
  });

  test("the location list discloses how many locations exist", async () => {
    const analyst = await makeUser("geo.locations", "DATA_ANALYST");
    resetRateLimits();
    const res = await call(countries, { path: "/api/analysis/countries?country=ZA", cookie: analyst.cookie });
    expect(typeof res.json.inventory.locations.total).toBe("number");
    expect(res.json.inventory.locations.total).toBe(res.json.inventory.byLocation.length);
    expect(res.json.inventory.locations.truncated).toBe(false);
  });

  test("a country filter narrows the distribution", async () => {
    const analyst = await makeUser("geo.filter", "DATA_ANALYST");
    resetRateLimits();
    const res = await call(countries, { path: "/api/analysis/countries?country=ZB", cookie: analyst.cookie });
    const rows = res.json.inventory.byLocation as Array<{ label: string }>;
    expect(rows.map((r) => r.label)).toEqual(["ZB / Geo Beta"]);
    expect(res.json.inventory.currentLots).toBe(1);
  });

  test("sales are either a real snapshot or an explicit unavailable state, never a zero", async () => {
    // Whether a completed demand run exists depends on what else has run against this
    // database, so both outcomes are checked for internal consistency rather than one of
    // them being assumed.
    const result = await readSalesByGeography(EMPTY_GEOGRAPHY_FILTERS, true);
    if (result.available) {
      expect(result.snapshot !== null).toBe(true);
      expect(result.unavailableMessage).toBe(null);
      expect(typeof result.snapshot?.businessDateIst).toBe("string");
      // The totals describe the same rows the breakdown does.
      const summed = result.byCountry.reduce((s, r) => s + r.saleRecordCount, 0);
      expect(result.rows.truncated ? true : summed === result.totals.saleRecordCount).toBe(true);
    } else {
      expect(result.snapshot).toBe(null);
      expect(result.unavailableMessage !== null).toBe(true);
      expect(result.byCountry).toEqual([]);
      expect(result.byBranch).toEqual([]);
    }
  });
});

describe("Country & Branch — customer identity obeys its permission", () => {
  beforeAll(async () => {
    await clearFixtures();
    await seedCurrentStock();
  });

  test("the distinct-customer figure is withheld without customers.read", async () => {
    // Withheld means null, never zero: zero would be a claim about the data.
    const withPermission = await readSalesByGeography(EMPTY_GEOGRAPHY_FILTERS, true);
    const withoutPermission = await readSalesByGeography(EMPTY_GEOGRAPHY_FILTERS, false);
    const nulls = withoutPermission.byCountry.map((r) => r.distinctCustomers);
    expect(nulls.filter((n) => n !== null)).toEqual([]);
    // And the shape is otherwise identical, so the permission withholds one figure rather
    // than changing what the page is about.
    expect(withoutPermission.byCountry.length).toBe(withPermission.byCountry.length);
  });

  test("the handler derives the permission from the session, never from the request", () => {
    const source = readFileSync("src/app/api/analysis/countries/route.ts", "utf8");
    expect(/principal\.permissions\.includes\("customers\.read"\)/.test(source)).toBe(true);
    // No request-supplied identity or role is read anywhere in the handler.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(/qStr\(url,\s*"(role|actor|userId|permissions)"/.test(code)).toBe(false);
  });

  test("the response says whether the customer figure is visible", async () => {
    const analyst = await makeUser("geo.identity", "DATA_ANALYST");
    resetRateLimits();
    const res = await call(countries, { path: "/api/analysis/countries", cookie: analyst.cookie });
    expect(typeof res.json.customerIdentityVisible).toBe("boolean");
  });
});

describe("Country & Branch — the view shows no geographic demand either", () => {
  test("the page carries no shortage, excess or transfer column", () => {
    const source = readFileSync("src/components/diamond/views/country-view.tsx", "utf8");
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const leaked = ["physicalShortage", "transferCandidates", "remainingUnplanned", "pipelineRequirement", "planCov"]
      .filter((field) => code.includes(field));
    expect(leaked).toEqual([]);
  });

  test("the page states the unavailability rather than leaving the tables unexplained", () => {
    const source = readFileSync("src/components/diamond/views/country-view.tsx", "utf8");
    expect(source.includes("geographicDemandMessage")).toBe(true);
    expect(source.includes("not currently calculated by country or branch")).toBe(true);
  });
});
