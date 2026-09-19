import { db } from "@/lib/db";
import { ok, num } from "@/lib/api-utils";
import { withApi, SCAN_MAX, scanned } from "@/lib/api/with-api";

// Inventory Aging Dashboard — enriched stock aging analysis.
// Buckets: 0-30, 31-60, 61-90, 91-180, 181-365, 365+ days.
// Slow-moving = 91+ days, Aged = 365+ days.
// Value is derived from a lab/shape-based price-per-carat estimate
// (PolishedStone has no cost/value column in the current schema).

const BUCKETS = [
  { label: "0-30", min: 0, max: 30 },
  { label: "31-60", min: 31, max: 60 },
  { label: "61-90", min: 61, max: 90 },
  { label: "91-180", min: 91, max: 180 },
  { label: "181-365", min: 181, max: 365 },
  { label: "365+", min: 366, max: Number.MAX_SAFE_INTEGER },
] as const;

const SLOW_MIN_DAYS = 91;
const AGED_MIN_DAYS = 365;

function pricePerCarat(lab: string | null | undefined, shape: string | null | undefined): number {
  let base = 5000;
  const l = (lab ?? "").toUpperCase();
  if (l === "GIA") base = 7000;
  else if (l === "GIA-PREMIUM") base = 7500;
  else if (l === "GIA-STANDARD") base = 6500;
  else if (l === "IGI") base = 5000;
  else if (l === "HRD") base = 5500;
  else if (l === "NON-CERT" || l === "") base = 3000;

  const s = (shape ?? "").toLowerCase();
  if (s === "round") base *= 1.2;
  else if (s === "emerald" || s === "asscher") base *= 1.1;
  else if (s === "pear" || s === "oval" || s === "marquise" || s === "heart") base *= 1.05;

  return base;
}

interface CountryAgg { country: string; totalPieces: number; slowMoving: number; aged: number; }
interface LabAgg { lab: string; totalPieces: number; slowMoving: number; aged: number; }
interface ShapeAgg { shape: string; totalPieces: number; slowMoving: number; aged: number; }
interface SlowAlert {
  lotId: string;
  ageDays: number;
  country: string;
  value: number;
  shape: string;
  weight: number;
}

export const GET = withApi({ permission: "analysis.read" }, async () => {
  const stones = await db.polishedStone.findMany({ take: SCAN_MAX }).then(scanned);
  const now = Date.now();
  const DAY_MS = 1000 * 60 * 60 * 24;

  // Per-bucket aggregates
  const buckets = BUCKETS.map((b) => ({
    label: b.label,
    min: b.min,
    max: b.max,
    pieces: 0,
    carats: 0,
    value: 0,
    pct: 0,
  }));

  // Per-dimension aggregates keyed by raw value
  const countryMap = new Map<string, CountryAgg>();
  const labMap = new Map<string, LabAgg>();
  const shapeMap = new Map<string, ShapeAgg>();

  // Individual slow-moving lots (91+ days) for the alerts list
  const slowAlerts: SlowAlert[] = [];

  let totalPieces = 0;
  let totalCarats = 0;
  let totalValue = 0;
  let totalAgeDays = 0;
  let slowMovingPieces = 0;
  let agedPieces = 0;

  for (const s of stones) {
    const ageDays = Math.max(0, Math.floor((now - new Date(s.lastUpdated).getTime()) / DAY_MS));
    const weight = num(s.weight);
    const value = weight * pricePerCarat(s.labNormalized, s.shapeNormalized ?? s.shape);
    const lab = (s.labNormalized ?? "Non-Cert") || "Non-Cert";
    const shape = (s.shapeNormalized ?? s.shape) || "Unknown";
    const country = s.country || "Unknown";

    totalPieces += 1;
    totalCarats += weight;
    totalValue += value;
    totalAgeDays += ageDays;

    const b = buckets.find((x) => ageDays >= x.min && ageDays <= x.max);
    if (b) {
      b.pieces += 1;
      b.carats += weight;
      b.value += value;
    }

    if (ageDays >= SLOW_MIN_DAYS) slowMovingPieces += 1;
    if (ageDays >= AGED_MIN_DAYS) agedPieces += 1;

    if (ageDays >= SLOW_MIN_DAYS) {
      slowAlerts.push({
        lotId: s.fantasyLotId,
        ageDays,
        country,
        value,
        shape,
        weight,
      });
    }

    // Country aggregation
    const c = countryMap.get(country) ?? { country, totalPieces: 0, slowMoving: 0, aged: 0 };
    c.totalPieces += 1;
    if (ageDays >= SLOW_MIN_DAYS) c.slowMoving += 1;
    if (ageDays >= AGED_MIN_DAYS) c.aged += 1;
    countryMap.set(country, c);

    // Lab aggregation
    const l = labMap.get(lab) ?? { lab, totalPieces: 0, slowMoving: 0, aged: 0 };
    l.totalPieces += 1;
    if (ageDays >= SLOW_MIN_DAYS) l.slowMoving += 1;
    if (ageDays >= AGED_MIN_DAYS) l.aged += 1;
    labMap.set(lab, l);

    // Shape aggregation
    const sh = shapeMap.get(shape) ?? { shape, totalPieces: 0, slowMoving: 0, aged: 0 };
    sh.totalPieces += 1;
    if (ageDays >= SLOW_MIN_DAYS) sh.slowMoving += 1;
    if (ageDays >= AGED_MIN_DAYS) sh.aged += 1;
    shapeMap.set(shape, sh);
  }

  // Compute bucket percentages (pieces share of total)
  for (const b of buckets) {
    b.pct = totalPieces > 0 ? num((b.pieces / totalPieces) * 100) : 0;
  }

  const slowMovingPct = totalPieces > 0 ? num((slowMovingPieces / totalPieces) * 100) : 0;
  const agedPct = totalPieces > 0 ? num((agedPieces / totalPieces) * 100) : 0;
  const avgAgeDays = totalPieces > 0 ? Math.round(totalAgeDays / totalPieces) : 0;

  // Sort slow-moving alerts by age desc and cap at 10
  slowAlerts.sort((a, b) => b.ageDays - a.ageDays);
  const topSlowAlerts = slowAlerts.slice(0, 10);

  const byCountry = Array.from(countryMap.values()).sort((a, b) => b.totalPieces - a.totalPieces);
  const byLab = Array.from(labMap.values()).sort((a, b) => b.totalPieces - a.totalPieces);
  const byShape = Array.from(shapeMap.values()).sort((a, b) => b.totalPieces - a.totalPieces);

  return ok({
    summary: {
      totalPieces,
      totalCarats: num(totalCarats),
      totalValue: num(totalValue),
      slowMovingPieces,
      slowMovingPct,
      agedPieces,
      agedPct,
      avgAgeDays,
    },
    buckets: buckets.map((b) => ({
      label: b.label,
      pieces: b.pieces,
      carats: num(b.carats),
      value: num(b.value),
      pct: b.pct,
    })),
    byCountry,
    byLab,
    byShape,
    slowMovingAlerts: topSlowAlerts.map((a) => ({
      lotId: a.lotId,
      ageDays: a.ageDays,
      country: a.country,
      value: num(a.value),
      shape: a.shape,
      weight: num(a.weight),
    })),
  });
});
