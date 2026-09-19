import { db } from "@/lib/db";
import { ok, num } from "@/lib/api-utils";
import { withApi, SCAN_MAX, scanned } from "@/lib/api/with-api";

// Transfer Candidate Analyzer — OPEN rule BR-TRANSFER-001
//
// Computes POTENTIAL cross-country transfer candidates:
//   For each category (lab|shape|weightBand) where some country has excess
//   (polished available > target) AND another country has shortage
//   (remainingUnplanned > 0), emit a candidate pair with:
//     - transferQty     = min(fromExcess, toShortage)
//     - potentialCoverage = transferQty / toShortage * 100
//
// These are advisory-only — cross-country transfer eligibility is an OPEN
// business rule. Do NOT auto-execute transfers without business approval.

interface CategoryKey {
  lab: string;
  shape: string;
  weightBand: string;
}

interface CountryAgg {
  country: string;
  available: number; // polished stock count
  target: number;    // sum of requiredQty
  shortage: number;  // sum of remainingUnplanned
}

interface Candidate {
  category: string;
  lab: string;
  shape: string;
  weightBand: string;
  fromCountry: string;
  fromCountryExcess: number;
  fromCountryAvailable: number;
  fromCountryTarget: number;
  toCountry: string;
  toCountryShortage: number;
  toCountryAvailable: number;
  toCountryTarget: number;
  transferQty: number;
  potentialCoverage: number;
  status: string;
}

function catKey(c: CategoryKey): string {
  return `${c.lab}|${c.shape}|${c.weightBand}`;
}

export const GET = withApi({ permission: "analysis.read" }, async () => {
  // 1. Shortage side — requirements with remainingUnplanned > 0
  const shortageReqs = await db.requirement.findMany({ take: SCAN_MAX,
    where: { remainingUnplanned: { gt: 0 } },
    select: {
      country: true,
      labNormalized: true,
      shape: true,
      weightBandId: true,
      requiredQty: true,
      physicalStockQty: true,
      remainingUnplanned: true,
    },
  }).then(scanned);

  // 2. Excess side — polished stones (physical or planning-available stock)
  const polished = await db.polishedStone.findMany({ take: SCAN_MAX,
    where: { planningClass: { in: ["PHYSICAL", "PLANNING_AVAILABLE"] } },
    select: {
      country: true,
      labNormalized: true,
      shapeNormalized: true,
      shape: true,
      weightBandId: true,
    },
  }).then(scanned);

  // Resolve weight band labels (id → label)
  const bandIds = new Set<string>();
  for (const r of shortageReqs) if (r.weightBandId) bandIds.add(r.weightBandId);
  for (const p of polished) if (p.weightBandId) bandIds.add(p.weightBandId);
  const bands = bandIds.size
    ? await db.weightBand.findMany({ take: SCAN_MAX, where: { id: { in: Array.from(bandIds) } } }).then(scanned)
    : [];
  const bandLabelById = new Map(bands.map((b) => [b.id, b.label]));

  const bandLabel = (id: string | null | undefined): string =>
    (id && bandLabelById.get(id)) || "Unbanded";

  // Aggregate per (category, country)
  type AggMap = Map<string, Map<string, CountryAgg>>;
  const shortageMap: AggMap = new Map();
  for (const r of shortageReqs) {
    const key: CategoryKey = {
      lab: r.labNormalized || "Non-Cert",
      shape: r.shape || "Unknown",
      weightBand: bandLabel(r.weightBandId),
    };
    const cat = catKey(key);
    if (!shortageMap.has(cat)) shortageMap.set(cat, new Map());
    const cm = shortageMap.get(cat)!;
    const cur =
      cm.get(r.country) ?? { country: r.country, available: 0, target: 0, shortage: 0 };
    cur.target += num(r.requiredQty);
    cur.available += num(r.physicalStockQty);
    cur.shortage += num(r.remainingUnplanned);
    cm.set(r.country, cur);
  }

  const availableMap: AggMap = new Map();
  for (const p of polished) {
    const key: CategoryKey = {
      lab: p.labNormalized || "Non-Cert",
      shape: p.shapeNormalized || p.shape || "Unknown",
      weightBand: bandLabel(p.weightBandId),
    };
    const cat = catKey(key);
    if (!availableMap.has(cat)) availableMap.set(cat, new Map());
    const cm = availableMap.get(cat)!;
    const cur =
      cm.get(p.country) ?? { country: p.country, available: 0, target: 0, shortage: 0 };
    cur.available += 1;
    cm.set(p.country, cur);
  }

  // Merge shortage + available into one combined per-(category,country) view
  // to derive excess = max(0, available - target)
  const mergedByCat: Map<string, Map<string, CountryAgg>> = new Map();
  const ensure = (cat: string, country: string, src: CountryAgg) => {
    if (!mergedByCat.has(cat)) mergedByCat.set(cat, new Map());
    const m = mergedByCat.get(cat)!;
    const cur =
      m.get(country) ?? { country, available: 0, target: 0, shortage: 0 };
    cur.available = Math.max(cur.available, src.available);
    cur.target = Math.max(cur.target, src.target);
    cur.shortage = Math.max(cur.shortage, src.shortage);
    m.set(country, cur);
  };
  for (const [cat, m] of shortageMap) {
    for (const [, agg] of m) ensure(cat, agg.country, agg);
  }
  // For polished-only countries (no shortage), we still need target=0 + available=N
  for (const [cat, m] of availableMap) {
    for (const [, agg] of m) {
      ensure(cat, agg.country, agg);
    }
  }

  // 3. For each category, find excess countries and shortage countries,
  //    then pair them (greedy by coverage) to produce candidates.
  const candidates: Candidate[] = [];
  for (const [cat, countryMap] of mergedByCat) {
    // Parse lab|shape|band from the composite key (band labels may contain '|'
    // themselves — rebuild from the first two parts + remainder).
    const parts = cat.split("|");
    const lab = parts[0];
    const shape = parts[1];
    const weightBand = parts.slice(2).join("|") || "Unbanded";

    const excessCountries: CountryAgg[] = [];
    const shortageCountries: CountryAgg[] = [];
    for (const agg of countryMap.values()) {
      const excess = Math.max(0, agg.available - agg.target);
      if (excess > 0) excessCountries.push({ ...agg });
      if (agg.shortage > 0) shortageCountries.push({ ...agg });
    }
    if (!excessCountries.length || !shortageCountries.length) continue;

    // Greedy match: for each shortage country, find the excess country with
    // the largest available excess (skipping the same country).
    for (const toC of shortageCountries) {
      const eligibleExcess = excessCountries
        .filter((e) => e.country !== toC.country)
        .sort((a, b) => {
          const ea = Math.max(0, a.available - a.target);
          const eb = Math.max(0, b.available - b.target);
          return eb - ea;
        });
      if (!eligibleExcess.length) continue;

      // Best single match per (from, to) pair — emit at most one candidate
      // per (category, fromCountry, toCountry) tuple.
      const fromC = eligibleExcess[0];
      const fromExcess = Math.max(0, fromC.available - fromC.target);
      const transferQty = Math.min(fromExcess, toC.shortage);
      if (transferQty <= 0) continue;
      const potentialCoverage =
        toC.shortage > 0 ? (transferQty / toC.shortage) * 100 : 0;
      const status: string =
        potentialCoverage >= 80
          ? "HIGH_COVERAGE"
          : potentialCoverage >= 40
          ? "MEDIUM_COVERAGE"
          : "LOW_COVERAGE";

      candidates.push({
        category: cat,
        lab,
        shape,
        weightBand,
        fromCountry: fromC.country,
        fromCountryExcess: fromExcess,
        fromCountryAvailable: fromC.available,
        fromCountryTarget: fromC.target,
        toCountry: toC.country,
        toCountryShortage: toC.shortage,
        toCountryAvailable: toC.available,
        toCountryTarget: toC.target,
        transferQty,
        potentialCoverage: Math.round(potentialCoverage * 10) / 10,
        status,
      });
    }
  }

  // 4. Sort by potentialCoverage desc, then transferQty desc
  candidates.sort(
    (a, b) =>
      b.potentialCoverage - a.potentialCoverage || b.transferQty - a.transferQty
  );

  // 5. Summary aggregates
  const totalTransferQty = candidates.reduce((s, c) => s + c.transferQty, 0);
  const avgCoverage = candidates.length
    ? Math.round(
        (candidates.reduce((s, c) => s + c.potentialCoverage, 0) /
          candidates.length) *
          10
      ) / 10
    : 0;
  const countriesWithExcess = new Set(candidates.map((c) => c.fromCountry)).size;
  const countriesWithShortage = new Set(candidates.map((c) => c.toCountry)).size;

  // 6. Country balance section — net (excess − shortage) per country
  const balanceByCountry = new Map<
    string,
    { country: string; totalExcess: number; totalShortage: number }
  >();
  for (const c of candidates) {
    // From-country contributes excess
    const f =
      balanceByCountry.get(c.fromCountry) ??
      { country: c.fromCountry, totalExcess: 0, totalShortage: 0 };
    f.totalExcess += c.fromCountryExcess;
    balanceByCountry.set(c.fromCountry, f);
    // To-country contributes shortage
    const t =
      balanceByCountry.get(c.toCountry) ??
      { country: c.toCountry, totalExcess: 0, totalShortage: 0 };
    t.totalShortage += c.toCountryShortage;
    balanceByCountry.set(c.toCountry, t);
  }
  const countryBalance = Array.from(balanceByCountry.values())
    .map((b) => ({
      country: b.country,
      totalExcess: b.totalExcess,
      totalShortage: b.totalShortage,
      netBalance: b.totalExcess - b.totalShortage,
    }))
    .sort((a, b) => b.netBalance - a.netBalance);

  return ok({
    candidates,
    summary: {
      totalCandidates: candidates.length,
      totalTransferQty,
      totalPotentialCoverage: avgCoverage,
      countriesWithExcess,
      countriesWithShortage,
    },
    countryBalance,
    advisoryNotice:
      "POTENTIAL transfer candidates only — OPEN rule BR-TRANSFER-001. Cross-country transfer eligibility is not confirmed. Do NOT auto-execute transfers without business approval.",
  });
});
