import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { CanonicalRecord, CanonicalRemovalEvent, normalizeShape, resolveLabNormalization } from "./canonical";
import { FantasyBatchPayload, FantasyDataProvider } from "./provider";
import { runSynchronization } from "./sync-service";
import { runDemandCalculation } from "@/lib/demand/demand-service";
import { resolveFantasySourceState } from "./config";
import { parseISTDateToUTC, getISTDateString, nowUTC } from "./time";
import { loadCategoryMappings } from "@/lib/demand/planning-category";
import { loadClassificationProfile, LEGACY_FIXTURE_PROFILE } from "./classification-profile";
import {
  CONFIRMED_WEIGHT_BANDS,
  CONFIRMED_LAB_MAPPINGS,
  CONFIRMED_SHAPE_MAPPINGS,
} from "@/lib/domain/diamond-rules";
import { assertDisposableDatabase, isIsolatedTestDatabase } from "./database-environment";
import { checkProjectionInvariant, reconcileOperationalProjection } from "./operational-projection";
import { roundHalfUpInt } from "@/lib/domain/diamond-rules";

if (typeof window !== "undefined") {
  throw new Error("analysis-review-fixture is server-only and must not be imported in browser bundles.");
}

export const FIXTURE_PROFILE_CODE = "ANALYSIS_REVIEW_V1";
export const NAMESPACE_PREFIX = "ARV1-";
export const DEFAULT_BUSINESS_DATE = "2026-09-24";

type DbClient = typeof db | Prisma.TransactionClient;

export interface SafetyCheckOptions {
  profile: string;
  businessDate: string;
  confirmLocal: boolean;
  databaseUrl?: string;
}

export function assertSafeEnvironmentForFixtureLoad(options: SafetyCheckOptions): void {
  if (!options.confirmLocal) {
    throw new Error(
      "Safety check failed: --confirm-local flag is required to load the Analysis Review fixture dataset."
    );
  }

  if (options.profile !== FIXTURE_PROFILE_CODE) {
    throw new Error(
      `Safety check failed: Unsupported fixture profile '${options.profile}'. Expected '${FIXTURE_PROFILE_CODE}'.`
    );
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(options.businessDate)) {
    throw new Error(
      `Safety check failed: Invalid business date '${options.businessDate}'. Expected format YYYY-MM-DD.`
    );
  }

  const sourceState = resolveFantasySourceState();
  if (sourceState.effectiveState !== "FIXTURE_SIMULATION") {
    throw new Error(
      `Safety check failed: Fixture loading is only permitted when source mode is FIXTURE_SIMULATION (current effective state: ${sourceState.effectiveState}).`
    );
  }

  assertDisposableDatabase(options.databaseUrl ?? process.env.DATABASE_URL, "Analysis Review fixture load");
}

export async function ensureStandardDomainMappings(client: DbClient = db): Promise<string[]> {
  const realigned: string[] = [];
  for (const wb of CONFIRMED_WEIGHT_BANDS) {
    const existing = await client.weightBand.findFirst({ where: { code: wb.code } });
    if (!existing) {
      await client.weightBand.create({
        data: {
          code: wb.code,
          label: wb.label,
          minCt: wb.minCt,
          maxCt: wb.maxCt,
          sortOrder: wb.sortOrder,
          active: true,
        },
      });
    }
  }

  for (const lab of CONFIRMED_LAB_MAPPINGS) {
    const existing = await client.labMapping.findFirst({ where: { rawLab: lab.raw } });
    if (!existing) {
      await client.labMapping.create({
        data: { rawLab: lab.raw, normalizedLab: lab.normalized, active: true },
      });
    } else if (existing.normalizedLab !== lab.normalized || !existing.active) {
      await client.labMapping.update({
        where: { id: existing.id },
        data: { normalizedLab: lab.normalized, active: true },
      });
      realigned.push(`lab ${lab.raw}: ${existing.normalizedLab} -> ${lab.normalized}`);
    }
  }

  for (const shape of CONFIRMED_SHAPE_MAPPINGS) {
    const existing = await client.shapeMapping.findFirst({ where: { rawShape: shape.raw } });
    if (!existing) {
      await client.shapeMapping.create({
        data: { rawShape: shape.raw, normalizedShape: shape.normalized, active: true },
      });
    } else if (existing.normalizedShape !== shape.normalized || !existing.active) {
      await client.shapeMapping.update({
        where: { id: existing.id },
        data: { normalizedShape: shape.normalized, active: true },
      });
      realigned.push(`shape ${shape.raw}: ${existing.normalizedShape} -> ${shape.normalized}`);
    }
  }

  if (realigned.length > 0) {
    console.log(`Realigned ${realigned.length} mapping(s) to the confirmed vocabulary:`);
    for (const r of realigned.slice(0, 10)) console.log(`  ${r}`);
  }

  return realigned;
}

export const COUNTRIES = ["INDIA", "USA", "BELGIUM", "UAE", "ISRAEL", "HONG KONG", "JAPAN"] as const;

export const BRANCHES = [
  "SURAT",
  "MUMBAI",
  "NEW YORK",
  "ANTWERP",
  "DUBAI",
  "RAMAT GAN",
  "HONG KONG",
  "TOKYO",
  "CHICAGO",
  "LOS ANGELES",
] as const;

export const DEPARTMENTS = [
  { id: "DEP-SRT-POL-01", name: "Surat Polishing Unit 1", branch: "SURAT", country: "INDIA" },
  { id: "DEP-SRT-POL-02", name: "Surat Polishing Unit 2", branch: "SURAT", country: "INDIA" },
  { id: "DEP-SRT-LASER-01", name: "Surat Laser Cutting", branch: "SURAT", country: "INDIA" },
  { id: "DEP-SRT-GRD-01", name: "Surat Grading Dept", branch: "SURAT", country: "INDIA" },
  { id: "DEP-MUM-TRD-01", name: "Mumbai Trading Floor", branch: "MUMBAI", country: "INDIA" },
  { id: "DEP-NY-SALES-01", name: "New York Sales Office", branch: "NEW YORK", country: "USA" },
  { id: "DEP-ANT-VAULT-01", name: "Antwerp Main Vault", branch: "ANTWERP", country: "BELGIUM" },
  { id: "DEP-DUB-TRD-01", name: "Dubai Trading Hub", branch: "DUBAI", country: "UAE" },
];

export const LOCATIONS = [
  { id: "LOC-VAULT-01", name: "Main Vault" },
  { id: "LOC-TRD-FL-01", name: "Trading Floor" },
  { id: "LOC-MFG-FL-01", name: "Manufacturing Floor" },
  { id: "LOC-MEMO-CAB-01", name: "Memo Cabinet" },
  { id: "LOC-SAFE-01", name: "Executive Safe" },
];

export const CUSTOMERS = [
  { code: "ARV1-CUST-01", name: "Aurora Gems & Diamonds", country: "USA", branch: "NEW YORK" },
  { code: "ARV1-CUST-02", name: "Blue Horizon Diamonds Inc", country: "USA", branch: "CHICAGO" },
  { code: "ARV1-CUST-03", name: "Crown Jewelers Worldwide", country: "UK", branch: "LONDON" },
  { code: "ARV1-CUST-04", name: "Dynamic Brilliance Ltd", country: "HONG KONG", branch: "HONG KONG" },
  { code: "ARV1-CUST-05", name: "Elysium Stones International", country: "BELGIUM", branch: "ANTWERP" },
  { code: "ARV1-CUST-06", name: "Falcon Diamond Trading", country: "UAE", branch: "DUBAI" },
  { code: "ARV1-CUST-07", name: "Grandeur Fine Gems", country: "INDIA", branch: "MUMBAI" },
  { code: "ARV1-CUST-08", name: "Helios Diamond Exchange", country: "ISRAEL", branch: "RAMAT GAN" },
  { code: "ARV1-CUST-09", name: "Imperial Gemological Traders", country: "JAPAN", branch: "TOKYO" },
  { code: "ARV1-CUST-10", name: "Jupiter Diamond Imports", country: "USA", branch: "LOS ANGELES" },
  { code: "ARV1-CUST-11", name: "Kingsway Gemstone Co", country: "UK", branch: "LONDON" },
  { code: "ARV1-CUST-12", name: "Lumina Diamond Works", country: "BELGIUM", branch: "ANTWERP" },
  { code: "ARV1-CUST-13", name: "Monarch Jewel Holdings", country: "UAE", branch: "DUBAI" },
  { code: "ARV1-CUST-14", name: "Nova Star Diamonds", country: "INDIA", branch: "SURAT" },
  { code: "ARV1-CUST-15", name: "Olympus Diamond Corp", country: "ISRAEL", branch: "RAMAT GAN" },
  { code: "ARV1-CUST-16", name: "Paragon Gem Group", country: "HONG KONG", branch: "HONG KONG" },
  { code: "ARV1-CUST-17", name: "Quantum Diamond Supply", country: "USA", branch: "NEW YORK" },
  { code: "ARV1-CUST-18", name: "Radiance Gems International", country: "JAPAN", branch: "TOKYO" },
  { code: "ARV1-CUST-19", name: "Solstice Diamond Traders", country: "BELGIUM", branch: "ANTWERP" },
  { code: "ARV1-CUST-20", name: "Titan Fine Diamonds", country: "UAE", branch: "DUBAI" },
  { code: "ARV1-CUST-21", name: "Universal Gem Partners", country: "USA", branch: "CHICAGO" },
  { code: "ARV1-CUST-22", name: "Vanguard Diamond Exporters", country: "INDIA", branch: "MUMBAI" },
  { code: "ARV1-CUST-23", name: "West End Diamond Co", country: "UK", branch: "LONDON" },
  { code: "ARV1-CUST-24", name: "Xenon Jewels Ltd", country: "HONG KONG", branch: "HONG KONG" },
  { code: "ARV1-CUST-25", name: "Yield Diamond Alliance", country: "ISRAEL", branch: "RAMAT GAN" },
  { code: "ARV1-CUST-26", name: "Zenith Fine Stones", country: "USA", branch: "NEW YORK" },
  { code: "ARV1-CUST-27", name: "Apex Diamond Merchants", country: "BELGIUM", branch: "ANTWERP" },
  { code: "ARV1-CUST-28", name: "Beacon Gemstones Ltd", country: "UAE", branch: "DUBAI" },
  { code: "ARV1-CUST-29", name: "Crestview Diamond Imports", country: "JAPAN", branch: "TOKYO" },
  { code: "ARV1-CUST-30", name: "Diamond Star Global", country: "INDIA", branch: "SURAT" },
];

export const COLORS = ["D", "E", "F", "G", "H", "I", "J"] as const;
export const CLARITIES = ["IF", "VVS1", "VVS2", "VS1", "VS2", "SI1", "SI2"] as const;

export function createDeterministicRng(seed = 42424242) {
  let s = seed >>> 0;
  return function next(): number {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export type DemandOutcomeType =
  | "OUT_OF_STOCK"
  | "SHORTAGE"
  | "COVERED"
  | "EXCESS"
  | "STOCK_NO_TARGET"
  | "REVIEW_REQUIRED";

export type TrendProfileType =
  | "STABLE"
  | "GROWTH"
  | "DECLINE"
  | "INTERMITTENT"
  | "ONE_TIME"
  | "DORMANT";

export type QuarantineReason =
  | "LAB_NOT_APPROVED"
  | "SHAPE_NOT_APPROVED"
  | "WEIGHT_BAND_UNRESOLVED"
  | "STATUS_NOT_MAPPED";

export interface CategoryScenarioSpec {
  id: string;
  labRaw: string;
  shapeRaw: string;
  weightBandLabel: string | null;
  nominalWeight: number;
  outcomeType: DemandOutcomeType;
  trendProfile: TrendProfileType;
  salesP1: number;
  salesP2: number;
  salesP3: number;
  stockCount: number;
  memoCount: number;
  reservedCount: number;
  wipCount: number;
  extraBranchStockCount?: number;
  quarantineReason?: QuarantineReason;
}

export const CATEGORY_SCENARIOS: CategoryScenarioSpec[] = [
  { id: "OOS-1",  labRaw: "GIA", shapeRaw: "ROUND",          weightBandLabel: "1.00-1.09", nominalWeight: 1.05, outcomeType: "OUT_OF_STOCK", trendProfile: "STABLE",       salesP1: 2, salesP2: 2, salesP3: 2, stockCount: 0, memoCount: 2, reservedCount: 1, wipCount: 1 },
  { id: "OOS-2",  labRaw: "GIA", shapeRaw: "ROUND",          weightBandLabel: "1.50-1.59", nominalWeight: 1.55, outcomeType: "OUT_OF_STOCK", trendProfile: "GROWTH",       salesP1: 3, salesP2: 2, salesP3: 1, stockCount: 0, memoCount: 1, reservedCount: 0, wipCount: 2 },
  { id: "OOS-3",  labRaw: "GIA", shapeRaw: "LeoOval22",      weightBandLabel: "1.10-1.49", nominalWeight: 1.30, outcomeType: "OUT_OF_STOCK", trendProfile: "DECLINE",      salesP1: 1, salesP2: 2, salesP3: 3, stockCount: 0, memoCount: 0, reservedCount: 1, wipCount: 0 },
  { id: "OOS-4",  labRaw: "GIA", shapeRaw: "S.HEART",        weightBandLabel: "1.70-1.99", nominalWeight: 1.85, outcomeType: "OUT_OF_STOCK", trendProfile: "STABLE",       salesP1: 2, salesP2: 2, salesP3: 2, stockCount: 0, memoCount: 1, reservedCount: 0, wipCount: 1 },
  { id: "OOS-5",  labRaw: "GIA", shapeRaw: "BE.CU.LONG",     weightBandLabel: "2.00-2.09", nominalWeight: 2.05, outcomeType: "OUT_OF_STOCK", trendProfile: "INTERMITTENT", salesP1: 2, salesP2: 0, salesP3: 2, stockCount: 0, memoCount: 2, reservedCount: 1, wipCount: 0 },
  { id: "OOS-6",  labRaw: "GIA", shapeRaw: "OLD ROUND",      weightBandLabel: "1.00-1.09", nominalWeight: 1.05, outcomeType: "OUT_OF_STOCK", trendProfile: "ONE_TIME",     salesP1: 0, salesP2: 3, salesP3: 0, stockCount: 0, memoCount: 0, reservedCount: 0, wipCount: 1 },
  { id: "OOS-7",  labRaw: "",    shapeRaw: "ROUND",          weightBandLabel: "1.10-1.49", nominalWeight: 1.30, outcomeType: "OUT_OF_STOCK", trendProfile: "GROWTH",       salesP1: 3, salesP2: 2, salesP3: 1, stockCount: 0, memoCount: 1, reservedCount: 0, wipCount: 0 },
  { id: "OOS-8",  labRaw: "",    shapeRaw: "BEZEL PRINCESS", weightBandLabel: "1.50-1.59", nominalWeight: 1.55, outcomeType: "OUT_OF_STOCK", trendProfile: "STABLE",       salesP1: 2, salesP2: 2, salesP3: 2, stockCount: 0, memoCount: 0, reservedCount: 1, wipCount: 1 },
  { id: "OOS-9",  labRaw: "GIA", shapeRaw: "CU.LONG",        weightBandLabel: "2.10-2.49", nominalWeight: 2.30, outcomeType: "OUT_OF_STOCK", trendProfile: "GROWTH",       salesP1: 3, salesP2: 2, salesP3: 1, stockCount: 0, memoCount: 1, reservedCount: 0, wipCount: 0 },
  { id: "OOS-10", labRaw: "",    shapeRaw: "LeoPear11",      weightBandLabel: "1.00-1.09", nominalWeight: 1.05, outcomeType: "OUT_OF_STOCK", trendProfile: "STABLE",       salesP1: 2, salesP2: 2, salesP3: 2, stockCount: 0, memoCount: 0, reservedCount: 0, wipCount: 0 },

  { id: "SHT-1",  labRaw: "GIA", shapeRaw: "ROUND",          weightBandLabel: "1.10-1.49", nominalWeight: 1.30, outcomeType: "SHORTAGE", trendProfile: "GROWTH",       salesP1: 4, salesP2: 3, salesP3: 2, stockCount: 2, memoCount: 2, reservedCount: 1, wipCount: 2 },
  { id: "SHT-2",  labRaw: "GIA", shapeRaw: "ROUND",          weightBandLabel: "1.70-1.99", nominalWeight: 1.85, outcomeType: "SHORTAGE", trendProfile: "STABLE",       salesP1: 2, salesP2: 2, salesP3: 2, stockCount: 2, memoCount: 1, reservedCount: 1, wipCount: 1 },
  { id: "SHT-3",  labRaw: "GIA", shapeRaw: "ROUND",          weightBandLabel: "2.00-2.09", nominalWeight: 2.05, outcomeType: "SHORTAGE", trendProfile: "DECLINE",      salesP1: 1, salesP2: 2, salesP3: 3, stockCount: 1, memoCount: 2, reservedCount: 0, wipCount: 1 },
  { id: "SHT-4",  labRaw: "GIA", shapeRaw: "LeoOval22",      weightBandLabel: "1.00-1.09", nominalWeight: 1.05, outcomeType: "SHORTAGE", trendProfile: "GROWTH",       salesP1: 2, salesP2: 2, salesP3: 2, stockCount: 1, memoCount: 1, reservedCount: 1, wipCount: 0 },
  { id: "SHT-5",  labRaw: "GIA", shapeRaw: "LeoOval22",      weightBandLabel: "1.50-1.59", nominalWeight: 1.55, outcomeType: "SHORTAGE", trendProfile: "STABLE",       salesP1: 2, salesP2: 2, salesP3: 2, stockCount: 1, memoCount: 1, reservedCount: 0, wipCount: 1 },
  { id: "SHT-6",  labRaw: "GIA", shapeRaw: "S.HEART",        weightBandLabel: "1.00-1.09", nominalWeight: 1.05, outcomeType: "SHORTAGE", trendProfile: "INTERMITTENT", salesP1: 2, salesP2: 0, salesP3: 2, stockCount: 1, memoCount: 0, reservedCount: 1, wipCount: 1 },
  { id: "SHT-7",  labRaw: "GIA", shapeRaw: "BE.CU.LONG",     weightBandLabel: "1.10-1.49", nominalWeight: 1.30, outcomeType: "SHORTAGE", trendProfile: "GROWTH",       salesP1: 3, salesP2: 2, salesP3: 1, stockCount: 2, memoCount: 2, reservedCount: 1, wipCount: 2 },
  { id: "SHT-8",  labRaw: "GIA", shapeRaw: "OLD ROUND",      weightBandLabel: "1.70-1.99", nominalWeight: 1.85, outcomeType: "SHORTAGE", trendProfile: "STABLE",       salesP1: 2, salesP2: 2, salesP3: 2, stockCount: 1, memoCount: 1, reservedCount: 0, wipCount: 0 },
  { id: "SHT-9",  labRaw: "GIA", shapeRaw: "BEZEL PRINCESS", weightBandLabel: "1.10-1.49", nominalWeight: 1.30, outcomeType: "SHORTAGE", trendProfile: "DECLINE",      salesP1: 2, salesP2: 2, salesP3: 2, stockCount: 2, memoCount: 1, reservedCount: 1, wipCount: 1 },
  { id: "SHT-10", labRaw: "GIA", shapeRaw: "LeoPear11",      weightBandLabel: "1.50-1.59", nominalWeight: 1.55, outcomeType: "SHORTAGE", trendProfile: "GROWTH",       salesP1: 2, salesP2: 2, salesP3: 2, stockCount: 1, memoCount: 1, reservedCount: 0, wipCount: 1 },
  { id: "SHT-11", labRaw: "",    shapeRaw: "ROUND",          weightBandLabel: "1.00-1.09", nominalWeight: 1.05, outcomeType: "SHORTAGE", trendProfile: "STABLE",       salesP1: 2, salesP2: 2, salesP3: 2, stockCount: 2, memoCount: 2, reservedCount: 1, wipCount: 0 },
  { id: "SHT-12", labRaw: "",    shapeRaw: "LeoOval22",      weightBandLabel: "1.10-1.49", nominalWeight: 1.30, outcomeType: "SHORTAGE", trendProfile: "INTERMITTENT", salesP1: 2, salesP2: 0, salesP3: 2, stockCount: 1, memoCount: 1, reservedCount: 0, wipCount: 1 },
  { id: "SHT-13", labRaw: "GIA", shapeRaw: "LIYO MQ",        weightBandLabel: "1.10-1.49", nominalWeight: 1.30, outcomeType: "SHORTAGE", trendProfile: "GROWTH",       salesP1: 2, salesP2: 2, salesP3: 2, stockCount: 1, memoCount: 0, reservedCount: 1, wipCount: 0 },
  { id: "SHT-14", labRaw: "GIA", shapeRaw: "RAD4(1)",        weightBandLabel: "1.50-1.59", nominalWeight: 1.55, outcomeType: "SHORTAGE", trendProfile: "STABLE",       salesP1: 2, salesP2: 2, salesP3: 2, stockCount: 1, memoCount: 1, reservedCount: 0, wipCount: 1 },

  { id: "COV-1",  labRaw: "GIA", shapeRaw: "ROUND",          weightBandLabel: "2.10-2.49", nominalWeight: 2.30, outcomeType: "COVERED", trendProfile: "STABLE",       salesP1: 2, salesP2: 2, salesP3: 2, stockCount: 4, memoCount: 2, reservedCount: 1, wipCount: 1 },
  { id: "COV-2",  labRaw: "GIA", shapeRaw: "ROUND",          weightBandLabel: "2.50-2.59", nominalWeight: 2.55, outcomeType: "COVERED", trendProfile: "GROWTH",       salesP1: 3, salesP2: 2, salesP3: 1, stockCount: 4, memoCount: 1, reservedCount: 1, wipCount: 1 },
  { id: "COV-3",  labRaw: "GIA", shapeRaw: "ROUND",          weightBandLabel: "3.00-3.09", nominalWeight: 3.05, outcomeType: "COVERED", trendProfile: "DECLINE",      salesP1: 1, salesP2: 2, salesP3: 3, stockCount: 4, memoCount: 1, reservedCount: 0, wipCount: 1 },
  { id: "COV-4",  labRaw: "GIA", shapeRaw: "LeoOval22",      weightBandLabel: "1.70-1.99", nominalWeight: 1.85, outcomeType: "COVERED", trendProfile: "STABLE",       salesP1: 2, salesP2: 2, salesP3: 2, stockCount: 4, memoCount: 1, reservedCount: 1, wipCount: 0 },
  { id: "COV-5",  labRaw: "GIA", shapeRaw: "S.HEART",        weightBandLabel: "1.10-1.49", nominalWeight: 1.30, outcomeType: "COVERED", trendProfile: "GROWTH",       salesP1: 3, salesP2: 2, salesP3: 1, stockCount: 4, memoCount: 2, reservedCount: 1, wipCount: 1 },
  { id: "COV-6",  labRaw: "GIA", shapeRaw: "BE.CU.LONG",     weightBandLabel: "1.00-1.09", nominalWeight: 1.05, outcomeType: "COVERED", trendProfile: "STABLE",       salesP1: 3, salesP2: 3, salesP3: 3, stockCount: 6, memoCount: 1, reservedCount: 1, wipCount: 1 },
  { id: "COV-7",  labRaw: "GIA", shapeRaw: "OLD ROUND",      weightBandLabel: "1.10-1.49", nominalWeight: 1.30, outcomeType: "COVERED", trendProfile: "INTERMITTENT", salesP1: 2, salesP2: 2, salesP3: 2, stockCount: 4, memoCount: 1, reservedCount: 0, wipCount: 1 },
  { id: "COV-8",  labRaw: "GIA", shapeRaw: "BEZEL PRINCESS", weightBandLabel: "1.00-1.09", nominalWeight: 1.05, outcomeType: "COVERED", trendProfile: "STABLE",       salesP1: 2, salesP2: 2, salesP3: 2, stockCount: 4, memoCount: 1, reservedCount: 1, wipCount: 0 },
  { id: "COV-9",  labRaw: "GIA", shapeRaw: "LeoPear11",      weightBandLabel: "1.10-1.49", nominalWeight: 1.30, outcomeType: "COVERED", trendProfile: "GROWTH",       salesP1: 3, salesP2: 2, salesP3: 1, stockCount: 4, memoCount: 1, reservedCount: 1, wipCount: 1 },
  { id: "COV-10", labRaw: "",    shapeRaw: "ROUND",          weightBandLabel: "1.70-1.99", nominalWeight: 1.85, outcomeType: "COVERED", trendProfile: "STABLE",       salesP1: 2, salesP2: 2, salesP3: 2, stockCount: 4, memoCount: 1, reservedCount: 0, wipCount: 1 },
  { id: "COV-11", labRaw: "GIA", shapeRaw: "CU.LONG",        weightBandLabel: "1.10-1.49", nominalWeight: 1.30, outcomeType: "COVERED", trendProfile: "STABLE",       salesP1: 3, salesP2: 3, salesP3: 3, stockCount: 6, memoCount: 2, reservedCount: 1, wipCount: 1 },
  { id: "COV-12", labRaw: "",    shapeRaw: "LIYO MQ",        weightBandLabel: "1.10-1.49", nominalWeight: 1.30, outcomeType: "COVERED", trendProfile: "STABLE",       salesP1: 2, salesP2: 2, salesP3: 2, stockCount: 4, memoCount: 1, reservedCount: 0, wipCount: 0 },

  { id: "EXC-1",  labRaw: "GIA", shapeRaw: "ROUND",          weightBandLabel: "2.60-2.99", nominalWeight: 2.80, outcomeType: "EXCESS", trendProfile: "DECLINE", salesP1: 1, salesP2: 1, salesP3: 1, stockCount: 7, memoCount: 2, reservedCount: 1, extraBranchStockCount: 15, wipCount: 1 },
  { id: "EXC-2",  labRaw: "GIA", shapeRaw: "ROUND",          weightBandLabel: "3.10-3.49", nominalWeight: 3.30, outcomeType: "EXCESS", trendProfile: "STABLE",  salesP1: 1, salesP2: 1, salesP3: 1, stockCount: 6, memoCount: 1, reservedCount: 0, extraBranchStockCount: 15, wipCount: 1 },
  { id: "EXC-3",  labRaw: "GIA", shapeRaw: "ROUND",          weightBandLabel: "3.50-3.99", nominalWeight: 3.75, outcomeType: "EXCESS", trendProfile: "ONE_TIME", salesP1: 1, salesP2: 1, salesP3: 1, stockCount: 5, memoCount: 1, reservedCount: 1, extraBranchStockCount: 15, wipCount: 0 },
  { id: "EXC-4",  labRaw: "GIA", shapeRaw: "LeoOval22",      weightBandLabel: "2.00-2.09", nominalWeight: 2.05, outcomeType: "EXCESS", trendProfile: "DECLINE", salesP1: 1, salesP2: 1, salesP3: 1, stockCount: 6, memoCount: 2, reservedCount: 1, extraBranchStockCount: 15, wipCount: 1 },
  { id: "EXC-5",  labRaw: "GIA", shapeRaw: "S.HEART",        weightBandLabel: "1.50-1.59", nominalWeight: 1.55, outcomeType: "EXCESS", trendProfile: "STABLE",  salesP1: 1, salesP2: 1, salesP3: 1, stockCount: 7, memoCount: 1, reservedCount: 0, extraBranchStockCount: 15, wipCount: 0 },
  { id: "EXC-6",  labRaw: "GIA", shapeRaw: "BE.CU.LONG",     weightBandLabel: "1.70-1.99", nominalWeight: 1.85, outcomeType: "EXCESS", trendProfile: "STABLE",  salesP1: 1, salesP2: 1, salesP3: 1, stockCount: 6, memoCount: 1, reservedCount: 1, extraBranchStockCount: 15, wipCount: 1 },
  { id: "EXC-7",  labRaw: "GIA", shapeRaw: "OLD ROUND",      weightBandLabel: "1.50-1.59", nominalWeight: 1.55, outcomeType: "EXCESS", trendProfile: "DECLINE", salesP1: 1, salesP2: 1, salesP3: 1, stockCount: 6, memoCount: 1, reservedCount: 0, extraBranchStockCount: 15, wipCount: 1 },
  { id: "EXC-8",  labRaw: "GIA", shapeRaw: "LeoPear11",      weightBandLabel: "1.00-1.09", nominalWeight: 1.05, outcomeType: "EXCESS", trendProfile: "STABLE",  salesP1: 1, salesP2: 1, salesP3: 1, stockCount: 7, memoCount: 2, reservedCount: 1, extraBranchStockCount: 15, wipCount: 0 },
  { id: "EXC-9",  labRaw: "",    shapeRaw: "ROUND",          weightBandLabel: "2.00-2.09", nominalWeight: 2.05, outcomeType: "EXCESS", trendProfile: "STABLE",  salesP1: 1, salesP2: 1, salesP3: 1, stockCount: 6, memoCount: 1, reservedCount: 0, extraBranchStockCount: 15, wipCount: 1 },
  { id: "EXC-10", labRaw: "GIA", shapeRaw: "CU.LONG",        weightBandLabel: "1.50-1.59", nominalWeight: 1.55, outcomeType: "EXCESS", trendProfile: "DECLINE", salesP1: 1, salesP2: 1, salesP3: 1, stockCount: 7, memoCount: 1, reservedCount: 1, extraBranchStockCount: 15, wipCount: 1 },

  { id: "SNT-1", labRaw: "GIA", shapeRaw: "ROUND",      weightBandLabel: "4.00-4.09", nominalWeight: 4.05, outcomeType: "STOCK_NO_TARGET", trendProfile: "DORMANT", salesP1: 0, salesP2: 0, salesP3: 0, stockCount: 5, memoCount: 1, reservedCount: 1, extraBranchStockCount: 8, wipCount: 1 },
  { id: "SNT-2", labRaw: "GIA", shapeRaw: "ROUND",      weightBandLabel: "5.00-5.99", nominalWeight: 5.50, outcomeType: "STOCK_NO_TARGET", trendProfile: "DORMANT", salesP1: 0, salesP2: 0, salesP3: 0, stockCount: 4, memoCount: 1, reservedCount: 0, extraBranchStockCount: 8, wipCount: 0 },
  { id: "SNT-3", labRaw: "GIA", shapeRaw: "LeoOval22",  weightBandLabel: "3.00-3.09", nominalWeight: 3.05, outcomeType: "STOCK_NO_TARGET", trendProfile: "DORMANT", salesP1: 0, salesP2: 0, salesP3: 0, stockCount: 5, memoCount: 1, reservedCount: 1, extraBranchStockCount: 8, wipCount: 1 },
  { id: "SNT-4", labRaw: "GIA", shapeRaw: "BE.CU.LONG", weightBandLabel: "3.00-3.09", nominalWeight: 3.05, outcomeType: "STOCK_NO_TARGET", trendProfile: "DORMANT", salesP1: 0, salesP2: 0, salesP3: 0, stockCount: 4, memoCount: 2, reservedCount: 0, extraBranchStockCount: 8, wipCount: 0 },
  { id: "SNT-5", labRaw: "",    shapeRaw: "ROUND",      weightBandLabel: "3.00-3.09", nominalWeight: 3.05, outcomeType: "STOCK_NO_TARGET", trendProfile: "DORMANT", salesP1: 0, salesP2: 0, salesP3: 0, stockCount: 4, memoCount: 1, reservedCount: 1, extraBranchStockCount: 8, wipCount: 1 },
  { id: "SNT-6", labRaw: "GIA", shapeRaw: "RAD4(1)",    weightBandLabel: "2.00-2.09", nominalWeight: 2.05, outcomeType: "STOCK_NO_TARGET", trendProfile: "DORMANT", salesP1: 0, salesP2: 0, salesP3: 0, stockCount: 5, memoCount: 1, reservedCount: 0, extraBranchStockCount: 8, wipCount: 1 },

  { id: "REV-1", labRaw: "EGL_UNAPPROVED", shapeRaw: "ROUND",             weightBandLabel: "1.60-1.69", nominalWeight: 1.65, outcomeType: "REVIEW_REQUIRED", trendProfile: "STABLE", salesP1: 1, salesP2: 1, salesP3: 1, stockCount: 4, memoCount: 1, reservedCount: 0, wipCount: 0, quarantineReason: "LAB_NOT_APPROVED" },
  { id: "REV-2", labRaw: "IGI",            shapeRaw: "ROUND",             weightBandLabel: "4.10-4.49", nominalWeight: 4.30, outcomeType: "REVIEW_REQUIRED", trendProfile: "STABLE", salesP1: 1, salesP2: 1, salesP3: 1, stockCount: 3, memoCount: 0, reservedCount: 1, wipCount: 0, quarantineReason: "LAB_NOT_APPROVED" },
  { id: "REV-3", labRaw: "GIA",            shapeRaw: "CUSTOM_ROSE_CUT",   weightBandLabel: "4.50-4.99", nominalWeight: 4.75, outcomeType: "REVIEW_REQUIRED", trendProfile: "GROWTH", salesP1: 2, salesP2: 1, salesP3: 0, stockCount: 4, memoCount: 1, reservedCount: 0, wipCount: 0, quarantineReason: "SHAPE_NOT_APPROVED" },
  { id: "REV-4", labRaw: "GIA",            shapeRaw: "HEXAGON_TEST_SHAPE", weightBandLabel: "6.00-6.99", nominalWeight: 6.50, outcomeType: "REVIEW_REQUIRED", trendProfile: "STABLE", salesP1: 1, salesP2: 1, salesP3: 1, stockCount: 3, memoCount: 1, reservedCount: 0, wipCount: 0, quarantineReason: "SHAPE_NOT_APPROVED" },
  { id: "REV-5", labRaw: "GIA",            shapeRaw: "ROUND",             weightBandLabel: null,        nominalWeight: 0.25, outcomeType: "REVIEW_REQUIRED", trendProfile: "STABLE", salesP1: 1, salesP2: 1, salesP3: 1, stockCount: 4, memoCount: 0, reservedCount: 0, wipCount: 0, quarantineReason: "WEIGHT_BAND_UNRESOLVED" },
  { id: "REV-6", labRaw: "EGL_UNAPPROVED", shapeRaw: "LeoOval22",         weightBandLabel: "7.00-7.99", nominalWeight: 7.50, outcomeType: "REVIEW_REQUIRED", trendProfile: "STABLE", salesP1: 1, salesP2: 1, salesP3: 1, stockCount: 3, memoCount: 1, reservedCount: 1, wipCount: 0, quarantineReason: "LAB_NOT_APPROVED" },
];

export const AUXILIARY_SCENARIOS: CategoryScenarioSpec[] = [
  { id: "AUX-1", labRaw: "GIA", shapeRaw: "STEP MQ",   weightBandLabel: "8.00-8.99",   nominalWeight: 8.50, outcomeType: "STOCK_NO_TARGET", trendProfile: "DORMANT", salesP1: 0, salesP2: 0, salesP3: 0, stockCount: 0, memoCount: 0, reservedCount: 0, wipCount: 0 },
  { id: "AUX-2", labRaw: "GIA", shapeRaw: "ANT-OVAL",  weightBandLabel: "9.00-9.99",   nominalWeight: 9.50, outcomeType: "STOCK_NO_TARGET", trendProfile: "DORMANT", salesP1: 0, salesP2: 0, salesP3: 0, stockCount: 0, memoCount: 0, reservedCount: 0, wipCount: 0 },
  { id: "AUX-3", labRaw: "GIA", shapeRaw: "Moval",     weightBandLabel: "10.00-14.99", nominalWeight: 12.0, outcomeType: "STOCK_NO_TARGET", trendProfile: "DORMANT", salesP1: 0, salesP2: 0, salesP3: 0, stockCount: 0, memoCount: 0, reservedCount: 0, wipCount: 0 },
  { id: "AUX-4", labRaw: "",    shapeRaw: "TREGAL(1)", weightBandLabel: "15.00-19.99", nominalWeight: 17.0, outcomeType: "STOCK_NO_TARGET", trendProfile: "DORMANT", salesP1: 0, salesP2: 0, salesP3: 0, stockCount: 0, memoCount: 0, reservedCount: 0, wipCount: 0 },
  { id: "AUX-5", labRaw: "GIA", shapeRaw: "Kite_V2",   weightBandLabel: "20.00-24.99", nominalWeight: 22.0, outcomeType: "STOCK_NO_TARGET", trendProfile: "DORMANT", salesP1: 0, salesP2: 0, salesP3: 0, stockCount: 0, memoCount: 0, reservedCount: 0, wipCount: 0 },
];

function confirmedLabFor(labRaw: string): string | null {
  const match = CONFIRMED_LAB_MAPPINGS.find((m) => m.raw.toLowerCase() === labRaw.trim().toLowerCase());
  return match ? match.normalized : null;
}

function confirmedShapeFor(shapeRaw: string): string | null {
  const match = CONFIRMED_SHAPE_MAPPINGS.find((m) => m.raw.toUpperCase() === shapeRaw.trim().toUpperCase());
  return match ? match.normalized : null;
}

export interface ExpectedScenarioOutcome {
  readonly id: string;
  readonly categoryKey: string | null;
  readonly sales90d: number;
  readonly target: number;
  readonly availableStock: number;
  readonly physicalShortage: number;
  readonly excessStock: number;
  readonly memoQty: number;
  readonly reservedQty: number;
  readonly wipQty: number;
  readonly outcome: DemandOutcomeType;
}

export function expectedOutcomeFor(s: CategoryScenarioSpec): ExpectedScenarioOutcome {
  const lab = confirmedLabFor(s.labRaw);
  const shape = confirmedShapeFor(s.shapeRaw);
  const quarantined = s.quarantineReason !== undefined || lab === null || shape === null || s.weightBandLabel === null;

  const sales90d = s.salesP1 + s.salesP2 + s.salesP3;
  const target = quarantined ? 0 : roundHalfUpInt((sales90d / 3) * 2);
  const availableStock = quarantined ? 0 : s.stockCount + (s.extraBranchStockCount ?? 0);
  const physicalShortage = Math.max(0, target - availableStock);
  const excessStock = Math.max(0, availableStock - target);

  let outcome: DemandOutcomeType;
  if (quarantined) outcome = "REVIEW_REQUIRED";
  else if (target === 0 && availableStock > 0) outcome = "STOCK_NO_TARGET";
  else if (availableStock === 0 && target > 0) outcome = "OUT_OF_STOCK";
  else if (physicalShortage > 0) outcome = "SHORTAGE";
  else if (excessStock > 0) outcome = "EXCESS";
  else outcome = "COVERED";

  return {
    id: s.id,
    categoryKey: quarantined ? null : `${lab}|${shape}|${s.weightBandLabel}`,
    sales90d,
    target,
    availableStock,
    physicalShortage,
    excessStock,
    memoQty: s.memoCount,
    reservedQty: s.reservedCount,
    wipQty: s.wipCount,
    outcome,
  };
}

export function expectedScenarioOutcomes(): ExpectedScenarioOutcome[] {
  return CATEGORY_SCENARIOS.map(expectedOutcomeFor);
}

export function collidingScenarioKeys(): Array<{ key: string; ids: string[] }> {
  const byKey = new Map<string, string[]>();
  for (const expected of expectedScenarioOutcomes()) {
    if (expected.categoryKey === null) continue;
    byKey.set(expected.categoryKey, [...(byKey.get(expected.categoryKey) ?? []), expected.id]);
  }
  return [...byKey.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([key, ids]) => ({ key, ids }));
}

export interface AnalysisReviewDatasetBatches {
  batch1: FantasyBatchPayload;
  batch2: FantasyBatchPayload;
  batch3: FantasyBatchPayload;
  batch4: FantasyBatchPayload;
  allBatches: FantasyBatchPayload[];
  lotCount: number;
  historyCount: number;
  salesCount: number;
}

export function generateAnalysisReviewBatches(
  businessDateIst = DEFAULT_BUSINESS_DATE,
  seed = 42424242
): AnalysisReviewDatasetBatches {
  const rng = createDeterministicRng(seed);
  const refDateUtc = parseISTDateToUTC(businessDateIst);
  const dayMs = 24 * 60 * 60 * 1000;

  const p1Start = new Date(refDateUtc.getTime() - 29 * dayMs);
  const p2Start = new Date(refDateUtc.getTime() - 59 * dayMs);
  const p3Start = new Date(refDateUtc.getTime() - 89 * dayMs);
  const outsideWindowDate = new Date(refDateUtc.getTime() - 110 * dayMs);

  const t1Cutoff = new Date(refDateUtc.getTime() - 80 * dayMs).toISOString();
  const t2Cutoff = new Date(refDateUtc.getTime() - 40 * dayMs).toISOString();
  const t3Cutoff = new Date(refDateUtc.getTime() - 10 * dayMs).toISOString();
  const t4Cutoff = new Date(refDateUtc.getTime()).toISOString();

  const batch1Records: CanonicalRecord[] = [];
  const batch2Records: CanonicalRecord[] = [];
  const batch2Removals: CanonicalRemovalEvent[] = [];
  const batch3Records: CanonicalRecord[] = [];
  const batch3Removals: CanonicalRemovalEvent[] = [];
  const batch4Records: CanonicalRecord[] = [];
  const batch4Removals: CanonicalRemovalEvent[] = [];

  let lotSeq = 1;
  let totalSalesInside = 0;
  let totalHistoryRecords = 0;

  function pick<T>(arr: readonly T[]): T {
    const idx = Math.floor(rng() * arr.length);
    return arr[idx];
  }

  function formatLotId(seq: number): string {
    return `${NAMESPACE_PREFIX}LOT-${String(seq).padStart(5, "0")}`;
  }

  function formatSrcId(seq: number): string {
    return `${NAMESPACE_PREFIX}SRC-${String(seq).padStart(5, "0")}`;
  }

  function randomDateBetween(start: Date, end: Date): string {
    const time = start.getTime() + rng() * (end.getTime() - start.getTime());
    return new Date(time).toISOString();
  }

  function sourceValuesFor(scen: CategoryScenarioSpec) {
    return {
      labRaw: scen.labRaw,
      rawShape: scen.shapeRaw,
      labNormalized: undefined as string | undefined,
      shapeNormalized: undefined as string | undefined,
    };
  }

  const auxiliaryScenarios: CategoryScenarioSpec[] = AUXILIARY_SCENARIOS;

  for (const scen of CATEGORY_SCENARIOS) {
    const dept = pick(DEPARTMENTS);
    const loc = pick(LOCATIONS);
    const color = pick(COLORS);
    const clarity = pick(CLARITIES);
    const { rawShape, shapeNormalized, labRaw, labNormalized } = sourceValuesFor(scen);

    const salesPeriods = [
      { count: scen.salesP1, start: p1Start, end: refDateUtc, batchNum: 3 },
      { count: scen.salesP2, start: p2Start, end: p1Start, batchNum: 2 },
      { count: scen.salesP3, start: p3Start, end: p2Start, batchNum: 2 },
    ];

    for (const period of salesPeriods) {
      for (let s = 0; s < period.count; s++) {
        const lotId = formatLotId(lotSeq);
        const srcId = formatSrcId(lotSeq);
        lotSeq++;
        totalSalesInside++;

        const cust = pick(CUSTOMERS);
        const saleDate = randomDateBetween(period.start, period.end);
        const baseCreatedAt = new Date(new Date(saleDate).getTime() - 20 * dayMs).toISOString();
        const weight = Number((scen.nominalWeight + (rng() * 0.02 - 0.01)).toFixed(2));
        const saleTotalUsd = Math.round(weight * (2000 + rng() * 3000));

        batch1Records.push({
          sourceType: "FIXTURE",
          sourceRecordId: srcId,
          lotId,
          entityType: "POLISHED",
          currentStatus: "STOCK",
          statusEffectiveDate: baseCreatedAt,
          docDate: baseCreatedAt,
          quantity: 1,
          shape: rawShape,
          shapeNormalized,
          weight,
          color,
          clarity,
          labRaw,
          labNormalized,
          certificate: `${scen.labRaw || "NOCERT"}-${lotSeq + 100000}`,
          saleTotalUsd: null,
          customerId: null,
          customerName: null,
          departmentId: dept.id,
          departmentName: dept.name,
          locationId: loc.id,
          locationName: loc.name,
          country: dept.country,
          branch: dept.branch,
          roughOrPolished: "POLISHED",
          sourceCreatedAt: baseCreatedAt,
          sourceUpdatedAt: baseCreatedAt,
          firstSeenAt: baseCreatedAt,
          lastSeenAt: baseCreatedAt,
          isCurrent: true,
          checkpoint: 1,
          syncBatchId: `${NAMESPACE_PREFIX}BATCH-001-BASELINE`,
          recordVersion: 1,
          isSimulated: true,
        });
        totalHistoryRecords++;

        const soldRecord: CanonicalRecord = {
          sourceType: "FIXTURE",
          sourceRecordId: srcId,
          lotId,
          entityType: "POLISHED",
          currentStatus: "SOLD",
          previousStatus: "STOCK",
          statusEffectiveDate: saleDate,
          docDate: saleDate,
          quantity: 1,
          shape: rawShape,
          shapeNormalized,
          weight,
          color,
          clarity,
          labRaw,
          labNormalized,
          certificate: `${scen.labRaw || "NOCERT"}-${lotSeq + 100000}`,
          saleTotalUsd,
          customerId: cust.code,
          customerCode: cust.code,
          customerName: cust.name,
          departmentId: dept.id,
          departmentName: dept.name,
          locationId: loc.id,
          locationName: loc.name,
          country: cust.country,
          branch: cust.branch,
          roughOrPolished: "POLISHED",
          sourceCreatedAt: baseCreatedAt,
          sourceUpdatedAt: saleDate,
          firstSeenAt: baseCreatedAt,
          lastSeenAt: saleDate,
          isCurrent: false,
          removalReason: "EXPLICIT_SALE",
          removedFromLiveAt: saleDate,
          checkpoint: period.batchNum,
          syncBatchId: `${NAMESPACE_PREFIX}BATCH-00${period.batchNum}-${period.batchNum === 2 ? "TRANSITIONS" : "RECENT-ACTIVITY"}`,
          recordVersion: 2,
          isSimulated: true,
        };

        if (period.batchNum === 2) {
          batch2Records.push(soldRecord);
        } else {
          batch3Records.push(soldRecord);
        }
        totalHistoryRecords++;
      }
    }

    for (let st = 0; st < scen.stockCount; st++) {
      const lotId = formatLotId(lotSeq);
      const srcId = formatSrcId(lotSeq);
      lotSeq++;

      const createdAt = randomDateBetween(p3Start, p1Start);
      const weight = Number((scen.nominalWeight + (rng() * 0.02 - 0.01)).toFixed(2));

      batch1Records.push({
        sourceType: "FIXTURE",
        sourceRecordId: srcId,
        lotId,
        entityType: "POLISHED",
        currentStatus: "STOCK",
        statusEffectiveDate: createdAt,
        docDate: createdAt,
        quantity: 1,
        shape: rawShape,
        shapeNormalized,
        weight,
        color: pick(COLORS),
        clarity: pick(CLARITIES),
        labRaw,
        labNormalized,
        certificate: `${scen.labRaw || "NOCERT"}-${lotSeq + 200000}`,
        departmentId: dept.id,
        departmentName: dept.name,
        locationId: loc.id,
        locationName: loc.name,
        country: dept.country,
        branch: dept.branch,
        roughOrPolished: "POLISHED",
        sourceCreatedAt: createdAt,
        sourceUpdatedAt: createdAt,
        firstSeenAt: createdAt,
        lastSeenAt: createdAt,
        isCurrent: true,
        checkpoint: 1,
        syncBatchId: `${NAMESPACE_PREFIX}BATCH-001-BASELINE`,
        recordVersion: 1,
        isSimulated: true,
      });
      totalHistoryRecords++;

      if (st % 2 === 0) {
        const movedDept = pick(DEPARTMENTS);
        const movedAt = randomDateBetween(p1Start, refDateUtc);
        batch3Records.push({
          sourceType: "FIXTURE",
          sourceRecordId: srcId,
          lotId,
          entityType: "POLISHED",
          currentStatus: "STOCK",
          statusEffectiveDate: movedAt,
          docDate: createdAt,
          quantity: 1,
          shape: rawShape,
          shapeNormalized,
          weight,
          color: pick(COLORS),
          clarity: pick(CLARITIES),
          labRaw,
          labNormalized,
          certificate: `${scen.labRaw || "NOCERT"}-${lotSeq + 200000}`,
          departmentId: movedDept.id,
          departmentName: movedDept.name,
          locationId: loc.id,
          locationName: loc.name,
          country: movedDept.country,
          branch: movedDept.branch,
          roughOrPolished: "POLISHED",
          sourceCreatedAt: createdAt,
          sourceUpdatedAt: movedAt,
          firstSeenAt: createdAt,
          lastSeenAt: movedAt,
          isCurrent: true,
          checkpoint: 3,
          syncBatchId: `${NAMESPACE_PREFIX}BATCH-003-RECENT-ACTIVITY`,
          recordVersion: 2,
          isSimulated: true,
        });
        totalHistoryRecords++;
      }
    }

    const extraStockCount = scen.extraBranchStockCount ?? 0;
    for (let st = 0; st < extraStockCount; st++) {
      const lotId = formatLotId(lotSeq);
      const srcId = formatSrcId(lotSeq);
      lotSeq++;

      const createdAt = randomDateBetween(p3Start, p1Start);
      const weight = Number((scen.nominalWeight + (rng() * 0.02 - 0.01)).toFixed(2));
      const extraDept = pick(DEPARTMENTS);

      batch1Records.push({
        sourceType: "FIXTURE",
        sourceRecordId: srcId,
        lotId,
        entityType: "POLISHED",
        currentStatus: "STOCK",
        statusEffectiveDate: createdAt,
        docDate: createdAt,
        quantity: 1,
        shape: rawShape,
        shapeNormalized,
        weight,
        color: pick(COLORS),
        clarity: pick(CLARITIES),
        labRaw,
        labNormalized,
        certificate: `${scen.labRaw || "NOCERT"}-${lotSeq + 250000}`,
        departmentId: extraDept.id,
        departmentName: extraDept.name,
        locationId: loc.id,
        locationName: loc.name,
        country: extraDept.country,
        branch: extraDept.branch,
        roughOrPolished: "POLISHED",
        sourceCreatedAt: createdAt,
        sourceUpdatedAt: createdAt,
        firstSeenAt: createdAt,
        lastSeenAt: createdAt,
        isCurrent: true,
        checkpoint: 1,
        syncBatchId: `${NAMESPACE_PREFIX}BATCH-001-BASELINE`,
        recordVersion: 1,
        isSimulated: true,
      });
      totalHistoryRecords++;
    }

    for (let m = 0; m < scen.memoCount; m++) {
      const lotId = formatLotId(lotSeq);
      const srcId = formatSrcId(lotSeq);
      lotSeq++;

      const cust = pick(CUSTOMERS);
      const createdAt = randomDateBetween(p3Start, p2Start);
      const memoDate = randomDateBetween(p2Start, refDateUtc);
      const weight = Number((scen.nominalWeight + (rng() * 0.02 - 0.01)).toFixed(2));

      batch1Records.push({
        sourceType: "FIXTURE",
        sourceRecordId: srcId,
        lotId,
        entityType: "POLISHED",
        currentStatus: "STOCK",
        statusEffectiveDate: createdAt,
        docDate: createdAt,
        quantity: 1,
        shape: rawShape,
        shapeNormalized,
        weight,
        color,
        clarity,
        labRaw,
        labNormalized,
        certificate: `${scen.labRaw || "NOCERT"}-${lotSeq + 300000}`,
        departmentId: dept.id,
        departmentName: dept.name,
        locationId: loc.id,
        locationName: loc.name,
        country: dept.country,
        branch: dept.branch,
        roughOrPolished: "POLISHED",
        sourceCreatedAt: createdAt,
        sourceUpdatedAt: createdAt,
        firstSeenAt: createdAt,
        lastSeenAt: createdAt,
        isCurrent: true,
        checkpoint: 1,
        syncBatchId: `${NAMESPACE_PREFIX}BATCH-001-BASELINE`,
        recordVersion: 1,
        isSimulated: true,
      });
      totalHistoryRecords++;

      batch2Records.push({
        sourceType: "FIXTURE",
        sourceRecordId: srcId,
        lotId,
        entityType: "POLISHED",
        currentStatus: "MEMO",
        previousStatus: "STOCK",
        statusEffectiveDate: memoDate,
        docDate: createdAt,
        quantity: 1,
        shape: rawShape,
        shapeNormalized,
        weight,
        color,
        clarity,
        labRaw,
        labNormalized,
        certificate: `${scen.labRaw || "NOCERT"}-${lotSeq + 300000}`,
        customerId: cust.code,
        customerCode: cust.code,
        customerName: cust.name,
        departmentId: dept.id,
        departmentName: dept.name,
        locationId: "LOC-MEMO-CAB-01",
        locationName: "Memo Cabinet",
        country: cust.country,
        branch: cust.branch,
        roughOrPolished: "POLISHED",
        sourceCreatedAt: createdAt,
        sourceUpdatedAt: memoDate,
        firstSeenAt: createdAt,
        lastSeenAt: memoDate,
        isCurrent: true,
        checkpoint: 2,
        syncBatchId: `${NAMESPACE_PREFIX}BATCH-002-TRANSITIONS`,
        recordVersion: 2,
        isSimulated: true,
      });
      totalHistoryRecords++;
    }

    for (let r = 0; r < scen.reservedCount; r++) {
      const lotId = formatLotId(lotSeq);
      const srcId = formatSrcId(lotSeq);
      lotSeq++;

      const cust = pick(CUSTOMERS);
      const createdAt = randomDateBetween(p3Start, p2Start);
      const resDate = randomDateBetween(p2Start, refDateUtc);
      const weight = Number((scen.nominalWeight + (rng() * 0.02 - 0.01)).toFixed(2));

      batch1Records.push({
        sourceType: "FIXTURE",
        sourceRecordId: srcId,
        lotId,
        entityType: "POLISHED",
        currentStatus: "STOCK",
        statusEffectiveDate: createdAt,
        docDate: createdAt,
        quantity: 1,
        shape: rawShape,
        shapeNormalized,
        weight,
        color,
        clarity,
        labRaw,
        labNormalized,
        certificate: `${scen.labRaw || "NOCERT"}-${lotSeq + 400000}`,
        departmentId: dept.id,
        departmentName: dept.name,
        locationId: loc.id,
        locationName: loc.name,
        country: dept.country,
        branch: dept.branch,
        roughOrPolished: "POLISHED",
        sourceCreatedAt: createdAt,
        sourceUpdatedAt: createdAt,
        firstSeenAt: createdAt,
        lastSeenAt: createdAt,
        isCurrent: true,
        checkpoint: 1,
        syncBatchId: `${NAMESPACE_PREFIX}BATCH-001-BASELINE`,
        recordVersion: 1,
        isSimulated: true,
      });
      totalHistoryRecords++;

      batch2Records.push({
        sourceType: "FIXTURE",
        sourceRecordId: srcId,
        lotId,
        entityType: "POLISHED",
        currentStatus: "RESERVED",
        previousStatus: "STOCK",
        statusEffectiveDate: resDate,
        docDate: createdAt,
        quantity: 1,
        shape: rawShape,
        shapeNormalized,
        weight,
        color,
        clarity,
        labRaw,
        labNormalized,
        certificate: `${scen.labRaw || "NOCERT"}-${lotSeq + 400000}`,
        customerId: cust.code,
        customerCode: cust.code,
        customerName: cust.name,
        departmentId: dept.id,
        departmentName: dept.name,
        locationId: loc.id,
        locationName: loc.name,
        country: cust.country,
        branch: cust.branch,
        roughOrPolished: "POLISHED",
        sourceCreatedAt: createdAt,
        sourceUpdatedAt: resDate,
        firstSeenAt: createdAt,
        lastSeenAt: resDate,
        isCurrent: true,
        checkpoint: 2,
        syncBatchId: `${NAMESPACE_PREFIX}BATCH-002-TRANSITIONS`,
        recordVersion: 2,
        isSimulated: true,
      });
      totalHistoryRecords++;
    }

    for (let w = 0; w < scen.wipCount; w++) {
      const lotId = formatLotId(lotSeq);
      const srcId = formatSrcId(lotSeq);
      lotSeq++;

      const createdAt = randomDateBetween(p3Start, p2Start);
      const wipDate = randomDateBetween(p2Start, refDateUtc);
      const weight = Number((scen.nominalWeight + (rng() * 0.02 - 0.01)).toFixed(2));
      const wipStages = ["WIP_PLANNING", "WIP_LASER", "WIP_POLISHING", "WIP_GRADING"] as const;
      const stage = pick(wipStages);

      batch1Records.push({
        sourceType: "FIXTURE",
        sourceRecordId: srcId,
        lotId,
        entityType: "WIP",
        currentStatus: "WIP_PLANNING",
        wipStage: "PLANNING",
        statusEffectiveDate: createdAt,
        docDate: createdAt,
        quantity: 1,
        shape: rawShape,
        shapeNormalized,
        weight,
        color,
        clarity,
        labRaw,
        labNormalized,
        departmentId: "DEP-SRT-POL-01",
        departmentName: "Surat Polishing Unit 1",
        locationId: "LOC-MFG-FL-01",
        locationName: "Manufacturing Floor",
        country: "INDIA",
        branch: "SURAT",
        roughOrPolished: "WIP",
        sourceCreatedAt: createdAt,
        sourceUpdatedAt: createdAt,
        firstSeenAt: createdAt,
        lastSeenAt: createdAt,
        isCurrent: true,
        checkpoint: 1,
        syncBatchId: `${NAMESPACE_PREFIX}BATCH-001-BASELINE`,
        recordVersion: 1,
        isSimulated: true,
      });
      totalHistoryRecords++;

      if (stage !== "WIP_PLANNING") {
        batch2Records.push({
          sourceType: "FIXTURE",
          sourceRecordId: srcId,
          lotId,
          entityType: "WIP",
          currentStatus: stage,
          previousStatus: "WIP_PLANNING",
          wipStage: stage.replace("WIP_", ""),
          statusEffectiveDate: wipDate,
          docDate: createdAt,
          quantity: 1,
          shape: rawShape,
          shapeNormalized,
          weight,
          color,
          clarity,
          labRaw,
          labNormalized,
          departmentId: "DEP-SRT-POL-01",
          departmentName: "Surat Polishing Unit 1",
          locationId: "LOC-MFG-FL-01",
          locationName: "Manufacturing Floor",
          country: "INDIA",
          branch: "SURAT",
          roughOrPolished: "WIP",
          sourceCreatedAt: createdAt,
          sourceUpdatedAt: wipDate,
          firstSeenAt: createdAt,
          lastSeenAt: wipDate,
          isCurrent: true,
          checkpoint: 2,
          syncBatchId: `${NAMESPACE_PREFIX}BATCH-002-TRANSITIONS`,
          recordVersion: 2,
          isSimulated: true,
        });
        totalHistoryRecords++;
      }
    }
  }

  for (let r = 0; r < 60; r++) {
    const lotId = `${NAMESPACE_PREFIX}ROUGH-${String(r + 1).padStart(4, "0")}`;
    const srcId = `${NAMESPACE_PREFIX}SRC-R-${String(r + 1).padStart(4, "0")}`;
    const createdAt = randomDateBetween(outsideWindowDate, p3Start);
    const weight = Number((2.5 + rng() * 12.0).toFixed(2));

    batch1Records.push({
      sourceType: "FIXTURE",
      sourceRecordId: srcId,
      lotId,
      entityType: "ROUGH",
      currentStatus: "ROUGH_AVAILABLE",
      statusEffectiveDate: createdAt,
      docDate: createdAt,
      quantity: 1,
      shape: "ROUGH",
      shapeNormalized: "UNKNOWN",
      weight,
      kapan: `KAPAN-${100 + (r % 10)}`,
      parentRoughId: `ROUGH-ORIGIN-${r + 1}`,
      departmentId: "DEP-SRT-POL-01",
      departmentName: "Surat Polishing Unit 1",
      locationId: "LOC-VAULT-01",
      locationName: "Main Vault",
      country: "INDIA",
      branch: "SURAT",
      roughOrPolished: "ROUGH",
      sourceCreatedAt: createdAt,
      sourceUpdatedAt: createdAt,
      firstSeenAt: createdAt,
      lastSeenAt: createdAt,
      isCurrent: true,
      checkpoint: 1,
      syncBatchId: `${NAMESPACE_PREFIX}BATCH-001-BASELINE`,
      recordVersion: 1,
      isSimulated: true,
    });
    totalHistoryRecords++;
  }

  for (let os = 0; os < 20; os++) {
    const lotId = formatLotId(lotSeq);
    const srcId = formatSrcId(lotSeq);
    lotSeq++;

    const targetScen = auxiliaryScenarios[os % auxiliaryScenarios.length];
    const { labRaw, rawShape, labNormalized, shapeNormalized } = sourceValuesFor(targetScen);
    const cust = pick(CUSTOMERS);
    const outDate = randomDateBetween(outsideWindowDate, p3Start);
    const weight = Number((targetScen.nominalWeight + (rng() * 0.02 - 0.01)).toFixed(2));
    const saleTotalUsd = Math.round(weight * 3500);

    batch1Records.push({
      sourceType: "FIXTURE",
      sourceRecordId: srcId,
      lotId,
      entityType: "POLISHED",
      currentStatus: "STOCK",
      statusEffectiveDate: outDate,
      docDate: outDate,
      quantity: 1,
      shape: rawShape,
      shapeNormalized,
      weight,
      color: "F",
      clarity: "VS1",
      labRaw,
      labNormalized,
      certificate: `${targetScen.labRaw || "NOCERT"}-OUT-${lotSeq + 500000}`,
      departmentId: "DEP-MUM-TRD-01",
      departmentName: "Mumbai Trading Floor",
      locationId: "LOC-VAULT-01",
      locationName: "Main Vault",
      country: "INDIA",
      branch: "MUMBAI",
      roughOrPolished: "POLISHED",
      sourceCreatedAt: outDate,
      sourceUpdatedAt: outDate,
      firstSeenAt: outDate,
      lastSeenAt: outDate,
      isCurrent: true,
      checkpoint: 1,
      syncBatchId: `${NAMESPACE_PREFIX}BATCH-001-BASELINE`,
      recordVersion: 1,
      isSimulated: true,
    });
    totalHistoryRecords++;

    batch2Records.push({
      sourceType: "FIXTURE",
      sourceRecordId: srcId,
      lotId,
      entityType: "POLISHED",
      currentStatus: "SOLD",
      previousStatus: "STOCK",
      statusEffectiveDate: outDate,
      docDate: outDate,
      quantity: 1,
      shape: rawShape,
      shapeNormalized,
      weight,
      color: "F",
      clarity: "VS1",
      labRaw,
      labNormalized,
      certificate: `${targetScen.labRaw || "NOCERT"}-OUT-${lotSeq + 500000}`,
      saleTotalUsd,
      customerId: cust.code,
      customerCode: cust.code,
      customerName: cust.name,
      departmentId: "DEP-MUM-TRD-01",
      departmentName: "Mumbai Trading Floor",
      locationId: "LOC-VAULT-01",
      locationName: "Main Vault",
      country: cust.country,
      branch: cust.branch,
      roughOrPolished: "POLISHED",
      sourceCreatedAt: outDate,
      sourceUpdatedAt: outDate,
      firstSeenAt: outDate,
      lastSeenAt: outDate,
      isCurrent: false,
      removalReason: "EXPLICIT_SALE",
      removedFromLiveAt: outDate,
      checkpoint: 2,
      syncBatchId: `${NAMESPACE_PREFIX}BATCH-002-TRANSITIONS`,
      recordVersion: 2,
      isSimulated: true,
    });
    totalHistoryRecords++;
  }

  for (let v = 0; v < 140; v++) {
    const lotId = formatLotId(lotSeq);
    const srcId = formatSrcId(lotSeq);
    lotSeq++;

    const targetScen = auxiliaryScenarios[v % auxiliaryScenarios.length];
    const { labRaw, rawShape, labNormalized, shapeNormalized } = sourceValuesFor(targetScen);
    const t0 = new Date(refDateUtc.getTime() - 75 * dayMs).toISOString();
    const t1 = new Date(refDateUtc.getTime() - 50 * dayMs).toISOString();
    const t2 = new Date(refDateUtc.getTime() - 25 * dayMs).toISOString();
    const t3 = new Date(refDateUtc.getTime() - 10 * dayMs).toISOString();
    const t4 = new Date(refDateUtc.getTime() - 2 * dayMs).toISOString();
    const cust = pick(CUSTOMERS);
    const weight = Number((targetScen.nominalWeight + (rng() * 0.02 - 0.01)).toFixed(2));

    batch1Records.push({
      sourceType: "FIXTURE",
      sourceRecordId: srcId,
      lotId,
      entityType: "POLISHED",
      currentStatus: "STOCK",
      statusEffectiveDate: t0,
      docDate: t0,
      quantity: 1,
      shape: rawShape,
      shapeNormalized,
      weight,
      color: "E",
      clarity: "VVS2",
      labRaw,
      labNormalized,
      certificate: `${targetScen.labRaw || "NOCERT"}-V-${lotSeq + 600000}`,
      departmentId: "DEP-SRT-POL-01",
      departmentName: "Surat Polishing Unit 1",
      locationId: "LOC-VAULT-01",
      locationName: "Main Vault",
      country: "INDIA",
      branch: "SURAT",
      roughOrPolished: "POLISHED",
      sourceCreatedAt: t0,
      sourceUpdatedAt: t0,
      firstSeenAt: t0,
      lastSeenAt: t0,
      isCurrent: true,
      checkpoint: 1,
      syncBatchId: `${NAMESPACE_PREFIX}BATCH-001-BASELINE`,
      recordVersion: 1,
      isSimulated: true,
    });
    totalHistoryRecords++;

    batch2Records.push({
      sourceType: "FIXTURE",
      sourceRecordId: srcId,
      lotId,
      entityType: "POLISHED",
      currentStatus: "MEMO",
      previousStatus: "STOCK",
      statusEffectiveDate: t1,
      docDate: t0,
      quantity: 1,
      shape: rawShape,
      shapeNormalized,
      weight,
      color: "E",
      clarity: "VVS2",
      labRaw,
      labNormalized,
      certificate: `${targetScen.labRaw || "NOCERT"}-V-${lotSeq + 600000}`,
      customerId: cust.code,
      customerName: cust.name,
      departmentId: "DEP-SRT-POL-01",
      departmentName: "Surat Polishing Unit 1",
      locationId: "LOC-MEMO-CAB-01",
      locationName: "Memo Cabinet",
      country: "INDIA",
      branch: "SURAT",
      roughOrPolished: "POLISHED",
      sourceCreatedAt: t0,
      sourceUpdatedAt: t1,
      firstSeenAt: t0,
      lastSeenAt: t1,
      isCurrent: true,
      checkpoint: 2,
      syncBatchId: `${NAMESPACE_PREFIX}BATCH-002-TRANSITIONS`,
      recordVersion: 2,
      isSimulated: true,
    });
    totalHistoryRecords++;

    batch3Records.push({
      sourceType: "FIXTURE",
      sourceRecordId: srcId,
      lotId,
      entityType: "POLISHED",
      currentStatus: "STOCK",
      previousStatus: "MEMO",
      statusEffectiveDate: t2,
      docDate: t0,
      quantity: 1,
      shape: rawShape,
      shapeNormalized,
      weight,
      color: "E",
      clarity: "VVS2",
      labRaw,
      labNormalized,
      certificate: `${targetScen.labRaw || "NOCERT"}-V-${lotSeq + 600000}`,
      departmentId: "DEP-MUM-TRD-01",
      departmentName: "Mumbai Trading Floor",
      locationId: "LOC-VAULT-01",
      locationName: "Main Vault",
      country: "INDIA",
      branch: "MUMBAI",
      roughOrPolished: "POLISHED",
      sourceCreatedAt: t0,
      sourceUpdatedAt: t2,
      firstSeenAt: t0,
      lastSeenAt: t2,
      isCurrent: true,
      checkpoint: 3,
      syncBatchId: `${NAMESPACE_PREFIX}BATCH-003-RECENT-ACTIVITY`,
      recordVersion: 3,
      isSimulated: true,
    });
    totalHistoryRecords++;

    if (v < 60) {
      batch4Records.push({
        sourceType: "FIXTURE",
        sourceRecordId: srcId,
        lotId,
        entityType: "POLISHED",
        currentStatus: "RESERVED",
        previousStatus: "STOCK",
        statusEffectiveDate: t3,
        docDate: t0,
        quantity: 1,
        shape: rawShape,
        shapeNormalized,
        weight,
        color: "E",
        clarity: "VVS2",
        labRaw,
        labNormalized,
        certificate: `${targetScen.labRaw || "NOCERT"}-V-${lotSeq + 600000}`,
        customerId: pick(CUSTOMERS).code,
        customerName: pick(CUSTOMERS).name,
        departmentId: "DEP-NY-SALES-01",
        departmentName: "New York Sales Office",
        locationId: "LOC-SAFE-01",
        locationName: "Executive Safe",
        country: "USA",
        branch: "NEW YORK",
        roughOrPolished: "POLISHED",
        sourceCreatedAt: t0,
        sourceUpdatedAt: t3,
        firstSeenAt: t0,
        lastSeenAt: t3,
        isCurrent: true,
        checkpoint: 4,
        syncBatchId: `${NAMESPACE_PREFIX}BATCH-004-DATA-QUALITY`,
        recordVersion: 4,
        isSimulated: true,
      });
      totalHistoryRecords++;
    }

    if (v < 30) {
      batch4Removals.push({
        lotId,
        removalReason: "EXPLICIT_SALE",
        removedFromLiveAt: t4,
        docDate: t4,
        saleTotalUsd: Math.round(weight * 4200),
        customerName: cust.name,
        notes: "Invoiced through Batch 4 lifecycle",
      });
      totalHistoryRecords++;
    }
  }

  for (let rm = 0; rm < 15; rm++) {
    const lotId = formatLotId(lotSeq);
    const srcId = formatSrcId(lotSeq);
    lotSeq++;

    const targetScen = auxiliaryScenarios[rm % auxiliaryScenarios.length];
    const { labRaw, rawShape, labNormalized, shapeNormalized } = sourceValuesFor(targetScen);
    const t0 = new Date(refDateUtc.getTime() - 60 * dayMs).toISOString();
    const tRm = new Date(refDateUtc.getTime() - 5 * dayMs).toISOString();
    const weight = Number((targetScen.nominalWeight + (rng() * 0.02 - 0.01)).toFixed(2));

    batch1Records.push({
      sourceType: "FIXTURE",
      sourceRecordId: srcId,
      lotId,
      entityType: "POLISHED",
      currentStatus: "STOCK",
      statusEffectiveDate: t0,
      docDate: t0,
      quantity: 1,
      shape: rawShape,
      shapeNormalized,
      weight,
      color: "F",
      clarity: "VS1",
      labRaw,
      labNormalized,
      certificate: `${targetScen.labRaw || "NOCERT"}-RM-${lotSeq + 700000}`,
      departmentId: "DEP-SRT-POL-01",
      departmentName: "Surat Polishing Unit 1",
      locationId: "LOC-VAULT-01",
      locationName: "Main Vault",
      country: "INDIA",
      branch: "SURAT",
      roughOrPolished: "POLISHED",
      sourceCreatedAt: t0,
      sourceUpdatedAt: t0,
      firstSeenAt: t0,
      lastSeenAt: t0,
      isCurrent: true,
      checkpoint: 1,
      syncBatchId: `${NAMESPACE_PREFIX}BATCH-001-BASELINE`,
      recordVersion: 1,
      isSimulated: true,
    });
    totalHistoryRecords++;

    batch4Removals.push({
      lotId,
      removalReason: rm % 2 === 0 ? "SOURCE_DISAPPEARANCE_UNKNOWN" : "TRANSFERRED",
      removedFromLiveAt: tRm,
      notes: "Controlled non-sale removal test",
    });
    totalHistoryRecords++;
  }

  const batch1: FantasyBatchPayload = {
    batchId: `${NAMESPACE_PREFIX}BATCH-001-BASELINE`,
    sourceMode: "FIXTURE",
    startingCheckpoint: 0,
    endingCheckpoint: 1,
    sourceCutoff: t1Cutoff,
    isSimulated: true,
    records: batch1Records,
    removals: [],
  };

  const batch2: FantasyBatchPayload = {
    batchId: `${NAMESPACE_PREFIX}BATCH-002-TRANSITIONS`,
    sourceMode: "FIXTURE",
    startingCheckpoint: 1,
    endingCheckpoint: 2,
    sourceCutoff: t2Cutoff,
    isSimulated: true,
    records: batch2Records,
    removals: batch2Removals,
  };

  const batch3: FantasyBatchPayload = {
    batchId: `${NAMESPACE_PREFIX}BATCH-003-RECENT-ACTIVITY`,
    sourceMode: "FIXTURE",
    startingCheckpoint: 2,
    endingCheckpoint: 3,
    sourceCutoff: t3Cutoff,
    isSimulated: true,
    records: batch3Records,
    removals: batch3Removals,
  };

  const batch4: FantasyBatchPayload = {
    batchId: `${NAMESPACE_PREFIX}BATCH-004-DATA-QUALITY`,
    sourceMode: "FIXTURE",
    startingCheckpoint: 3,
    endingCheckpoint: 4,
    sourceCutoff: t4Cutoff,
    isSimulated: true,
    records: batch4Records,
    removals: batch4Removals,
  };

  const allBatches = [batch1, batch2, batch3, batch4];

  return {
    batch1,
    batch2,
    batch3,
    batch4,
    allBatches,
    lotCount: lotSeq - 1,
    historyCount: totalHistoryRecords,
    salesCount: totalSalesInside,
  };
}

export class AnalysisReviewFixtureProvider implements FantasyDataProvider {
  private batches: FantasyBatchPayload[];
  private startingOffset: number;

  constructor(batches: FantasyBatchPayload[], startingOffset = 0) {
    this.batches = batches.map((b, idx) => ({
      ...b,
      startingCheckpoint: startingOffset + idx,
      endingCheckpoint: startingOffset + idx + 1,
    }));
    this.startingOffset = startingOffset;
  }

  getSourceMode() {
    return "FIXTURE" as const;
  }

  async getBatch(checkpoint: number): Promise<FantasyBatchPayload | null> {
    const idx = checkpoint - this.startingOffset;
    if (idx < 0 || idx >= this.batches.length) return null;
    return this.batches[idx];
  }

  getTotalAvailableBatches(): number {
    return this.batches.length;
  }
}

export interface AnalysisReviewVerificationManifest {
  canonicalLotsTotal: number;
  activeCurrentLots: number;
  historyVersionsTotal: number;
  confirmedSalesInsideWindow: number;
  distinctCustomers: number;
  distinctCategories: number;
  demandRunId: string;
  demandOutcomes: {
    outOfStockCategories: number;
    shortageCategories: number;
    coveredCategories: number;
    excessCategories: number;
    stockNoTargetCategories: number;
    reviewRequiredCategories: number;
    reviewRequiredRecords: number;
  };
  inventoryBuckets: {
    physicalAvailableCount: number;
    memoCount: number;
    reservedCount: number;
    wipCount: number;
    roughCount: number;
    excludedCount: number;
  };
  passedAllInvariants: boolean;
  invariantsReport: string[];
  scenariosReconciled: number;
  scenarioMismatches: string[];
  projectionComplete: boolean;
  missingMirrors: number;
  unclassifiedRecords: number;
}

export interface AnalysisReviewLoadResult {
  success: boolean;
  profile: string;
  businessDate: string;
  batchesSynchronized: number;
  demandRunId: string;
  alreadyLoaded: boolean;
  manifest: AnalysisReviewVerificationManifest;
}

export async function verifyAnalysisReviewManifest(
  demandRunId: string,
  businessDateIst = DEFAULT_BUSINESS_DATE,
  client: DbClient = db
): Promise<AnalysisReviewVerificationManifest> {
  const [
    canonicalLots,
    historyLots,
    demandRuns,
    customers,
  ] = await Promise.all([
    client.lotMasterRecord.findMany({
      where: { lotId: { startsWith: NAMESPACE_PREFIX } },
      select: {
        lotId: true, isCurrent: true, currentStatus: true, entityType: true,
        inventoryClass: true, categoryState: true,
      },
    }),
    client.lotHistoryRecord.findMany({
      where: { lotId: { startsWith: NAMESPACE_PREFIX } },
      select: { lotId: true, version: true, status: true },
    }),
    client.demandRun.findMany({
      where: { id: demandRunId },
      include: { metrics: true },
    }),
    client.lotMasterRecord.findMany({
      where: { lotId: { startsWith: NAMESPACE_PREFIX }, customerName: { not: null } },
      select: { customerName: true },
      distinct: ["customerName"],
    }),
  ]);

  const projection = await checkProjectionInvariant(client as typeof db);
  const fixtureCategoryRows = await client.lotMasterRecord.findMany({
    where: { lotId: { startsWith: NAMESPACE_PREFIX }, isCurrent: true, categoryKey: { not: null } },
    select: { categoryKey: true },
    distinct: ["categoryKey"],
  });
  const fixtureCategoryKeys = new Set(fixtureCategoryRows.map((r) => r.categoryKey as string));
  const latestRun = demandRuns[0];
  if (!latestRun) {
    throw new Error(`Verification failed: demand run ${demandRunId} was not found.`);
  }

  const activeCurrent = canonicalLots.filter((l) => l.isCurrent).length;
  const metrics = latestRun.metrics;

  let oos = 0;
  let sht = 0;
  let cov = 0;
  let exc = 0;
  let snt = 0;
  let rev = 0;

  for (const m of metrics) {
    const target = Number(m.roundedTarget);
    const stock = Number(m.availableStock);
    const sales = Number(m.sales90d);
    const shortage = Number(m.physicalShortage);
    const excess = Number(m.excessStock);

    if (m.status === "REVIEW_REQUIRED") {
      rev++;
    } else if (sales === 0 && stock > 0) {
      snt++;
    } else if (stock === 0 && target > 0) {
      oos++;
    } else if (shortage > 0) {
      sht++;
    } else if (excess > 0) {
      exc++;
    } else if (stock >= target && target > 0) {
      cov++;
    }
  }

  const reviewRequiredRecords = canonicalLots.filter(
    (l) => l.isCurrent && l.categoryState === "REVIEW_REQUIRED",
  ).length;

  const buckets = {
    physicalAvailableCount: canonicalLots.filter((l) => l.isCurrent && l.inventoryClass === "PHYSICAL_AVAILABLE").length,
    memoCount: canonicalLots.filter((l) => l.isCurrent && l.inventoryClass === "MEMO").length,
    reservedCount: canonicalLots.filter((l) => l.isCurrent && l.inventoryClass === "RESERVED").length,
    wipCount: canonicalLots.filter((l) => l.isCurrent && l.inventoryClass === "WIP").length,
    roughCount: canonicalLots.filter((l) => l.isCurrent && l.entityType === "ROUGH").length,
    excludedCount: canonicalLots.filter((l) => l.isCurrent && l.inventoryClass === "EXCLUDED").length,
  };

  const invariantsReport: string[] = [];
  let passed = true;

  function check(cond: boolean, msg: string) {
    invariantsReport.push(`${cond ? "✓" : "❌"} ${msg}`);
    if (!cond) passed = false;
  }

  check(
    projection.satisfied,
    `Operational projection complete (missing mirrors: ${projection.missingMirrors}, unclassified: ${projection.unclassified})`,
  );
  check(canonicalLots.length >= 800 && canonicalLots.length <= 1300, `Canonical lot count in range 800-1300 (got ${canonicalLots.length})`);
  check(historyLots.length >= 1500 && historyLots.length <= 3200, `History version count in range 1500-3200 (got ${historyLots.length})`);
  check(
    fixtureCategoryKeys.size >= 40 && fixtureCategoryKeys.size <= 70,
    `Fixture planning category count in range 40-70 (got ${fixtureCategoryKeys.size})`,
  );
  check(oos >= 8, `At least 8 Out of Stock categories (got ${oos})`);
  check(sht >= 12, `At least 12 Shortage categories (got ${sht})`);
  check(cov >= 10, `At least 10 Covered / At Target categories (got ${cov})`);
  check(exc >= 8, `At least 8 Excess categories (got ${exc})`);
  check(snt >= 5, `At least 5 Stock with No Target categories (got ${snt})`);
  check(
    reviewRequiredRecords >= 20,
    `Records quarantined for review (>=20, got ${reviewRequiredRecords})`,
  );
  check(
    rev === 0,
    `No quarantined record became a planning category (review categories: ${rev})`,
  );
  check(customers.length >= 25, `At least 25 distinct customer accounts (got ${customers.length})`);
  check(buckets.physicalAvailableCount > 300, `Physical Available stock populated (>300, got ${buckets.physicalAvailableCount})`);
  check(buckets.memoCount > 50, `Memo stock populated (>50, got ${buckets.memoCount})`);
  check(buckets.reservedCount > 40, `Reserved stock populated (>40, got ${buckets.reservedCount})`);
  check(buckets.wipCount > 30, `WIP stock populated (>30, got ${buckets.wipCount})`);
  check(buckets.roughCount > 30, `Rough records present and quarantined (>30, got ${buckets.roughCount})`);

  const metricsByCategory = new Map(metrics.map((m) => [m.planningCategory, m]));
  const scenarioMismatches: string[] = [];
  let scenariosReconciled = 0;

  for (const expected of expectedScenarioOutcomes()) {
    if (expected.categoryKey === null) {
      const leaked = [...metricsByCategory.keys()].filter((k) => k.includes(expected.id));
      if (leaked.length > 0) scenarioMismatches.push(`${expected.id}: quarantined but produced ${leaked.join(", ")}`);
      continue;
    }
    const actual = metricsByCategory.get(expected.categoryKey);
    if (!actual) {
      scenarioMismatches.push(`${expected.id}: expected category ${expected.categoryKey} was not produced`);
      continue;
    }
    scenariosReconciled++;
    const diffs: string[] = [];
    if (Number(actual.roundedTarget) !== expected.target) {
      diffs.push(`target ${Number(actual.roundedTarget)} != ${expected.target}`);
    }
    if (Number(actual.physicalShortage) !== expected.physicalShortage) {
      diffs.push(`shortage ${Number(actual.physicalShortage)} != ${expected.physicalShortage}`);
    }
    if (Number(actual.excessStock) !== expected.excessStock) {
      diffs.push(`excess ${Number(actual.excessStock)} != ${expected.excessStock}`);
    }
    if (diffs.length) scenarioMismatches.push(`${expected.id} (${expected.categoryKey}): ${diffs.join("; ")}`);
  }

  check(
    collidingScenarioKeys().length === 0,
    `No two scenarios share a category key (collisions: ${collidingScenarioKeys().length})`,
  );
  check(
    scenarioMismatches.length === 0,
    `Every planned scenario reconciles (${scenariosReconciled} reconciled, ${scenarioMismatches.length} mismatched)` +
      (scenarioMismatches.length ? `: ${scenarioMismatches.slice(0, 5).join(" | ")}` : ""),
  );

  return {
    canonicalLotsTotal: canonicalLots.length,
    activeCurrentLots: activeCurrent,
    historyVersionsTotal: historyLots.length,
    confirmedSalesInsideWindow: metrics.reduce((acc, m) => acc + Number(m.sales90d), 0),
    distinctCustomers: customers.length,
    distinctCategories: fixtureCategoryKeys.size,
    demandRunId: latestRun.id,
    demandOutcomes: {
      outOfStockCategories: oos,
      shortageCategories: sht,
      coveredCategories: cov,
      excessCategories: exc,
      stockNoTargetCategories: snt,
      reviewRequiredCategories: rev,
      reviewRequiredRecords,
    },
    inventoryBuckets: buckets,
    passedAllInvariants: passed,
    invariantsReport,
    scenariosReconciled,
    scenarioMismatches,
    projectionComplete: projection.satisfied,
    missingMirrors: projection.missingMirrors,
    unclassifiedRecords: projection.unclassified,
  };
}

export async function runAnalysisReviewFixtureLoader(options: {
  profile?: string;
  businessDate?: string;
  confirmLocal: boolean;
  actor?: string;
  actorUserId?: string;
  databaseUrl?: string;
  client?: DbClient;
}): Promise<AnalysisReviewLoadResult> {
  const profile = options.profile || FIXTURE_PROFILE_CODE;
  const businessDate = options.businessDate || DEFAULT_BUSINESS_DATE;

  assertSafeEnvironmentForFixtureLoad({
    profile,
    businessDate,
    confirmLocal: options.confirmLocal,
    databaseUrl: options.databaseUrl,
  });

  const client = options.client ?? db;

  await ensureStandardDomainMappings(client);

  const existingRuns = await client.integrationSyncRun.findMany({
    where: { batchId: `${NAMESPACE_PREFIX}BATCH-004-DATA-QUALITY`, status: "SUCCESS" },
  });

  const existingLotsCount = await client.lotMasterRecord.count({
    where: { lotId: { startsWith: NAMESPACE_PREFIX } },
  });

  const resumeProjection = await checkProjectionInvariant(client as typeof db);

  if (existingRuns.length > 0 && existingLotsCount >= 800) {
    if (!resumeProjection.satisfied) {
      console.log(
        `Detected an incomplete previous load: ${resumeProjection.missingMirrors} missing mirror(s), ` +
          `${resumeProjection.unclassified} unclassified record(s). Repairing before verification.`,
      );
      await reconcileOperationalProjection({ actor: options.actor ?? "ARV1_FIXTURE_LOADER" });
    }

    const fixtureSyncRunIds = (
      await client.integrationSyncRun.findMany({
        where: { batchId: { startsWith: NAMESPACE_PREFIX }, status: "SUCCESS" },
        select: { id: true },
      })
    ).map((r) => r.id);

    const priorRun = fixtureSyncRunIds.length
      ? await client.demandRun.findFirst({
          where: {
            sourceSyncRunId: { in: fixtureSyncRunIds },
            status: { in: ["COMPLETED", "REVIEW_REQUIRED"] },
          },
          orderBy: [{ runDate: "desc" }, { id: "desc" }],
          select: { id: true },
        })
      : null;

    if (priorRun) {
      const manifest = await verifyAnalysisReviewManifest(priorRun.id, businessDate, client);
      return {
        success: manifest.passedAllInvariants,
        profile,
        businessDate,
        batchesSynchronized: 0,
        demandRunId: manifest.demandRunId,
        alreadyLoaded: true,
        manifest,
      };
    }
    console.log("Canonical lots are present but no fixture demand run exists; recalculating.");
  }

  const checkpointRow = await client.syncCheckpoint.findUnique({
    where: { source: "FANTASY" },
  });
  const currentCheckpoint = checkpointRow?.currentCheckpoint ?? 0;

  const dataset = generateAnalysisReviewBatches(businessDate);
  const provider = new AnalysisReviewFixtureProvider(dataset.allBatches, currentCheckpoint);

  for (let i = 0; i < dataset.allBatches.length; i++) {
    const syncRes = await runSynchronization({
      actor: options.actor ?? "ARV1_FIXTURE_LOADER",
      actorUserId: options.actorUserId ?? undefined,
      provider,
    });
    if (!syncRes.success) {
      throw new Error(`Fixture synchronization failed on batch ${i + 1}: ${syncRes.status}`);
    }
  }

  const syncRuns = await client.integrationSyncRun.findMany({
    where: { batchId: { startsWith: NAMESPACE_PREFIX } },
    select: {
      batchId: true,
      recordsReceived: true,
      recordsCreated: true,
      recordsUpdated: true,
      recordsUnchanged: true,
      recordsRejected: true,
      recordsRemoved: true,
    },
  });
  const unreconciled = syncRuns
    .map((r) => ({
      batchId: r.batchId,
      received: r.recordsReceived ?? 0,
      accounted:
        (r.recordsCreated ?? 0) + (r.recordsUpdated ?? 0) + (r.recordsUnchanged ?? 0)
        + (r.recordsRejected ?? 0) + (r.recordsRemoved ?? 0),
    }))
    .filter((r) => r.received !== r.accounted);

  if (unreconciled.length > 0) {
    const detail = unreconciled
      .map((r) => `${r.batchId}: received ${r.received}, accounted ${r.accounted}`)
      .join("; ");
    throw new Error(`Synchronization counters do not reconcile — ${detail}`);
  }

  const repair = await reconcileOperationalProjection({ actor: options.actor ?? "ARV1_FIXTURE_LOADER" });
  if (!repair.complete) {
    throw new Error(
      `Operational projection could not be completed: ${repair.outstandingMissingMirrors} record(s) ` +
        `still have no operational mirror and ${repair.outstandingUnclassified} remain unclassified. ` +
        "The dataset is not ready for demand calculation.",
    );
  }

  const parsedBusinessDate = parseISTDateToUTC(businessDate);
  const demandRes = await runDemandCalculation({
    actor: options.actor ?? "ARV1_FIXTURE_LOADER",
    actorUserId: options.actorUserId ?? undefined,
    sourcePolicy: "CANONICAL_FANTASY",
    windowDays: 90,
    referenceDate: parsedBusinessDate,
  });

  if (demandRes.status !== "COMPLETED" && demandRes.status !== "REVIEW_REQUIRED") {
    throw new Error(`Authoritative demand calculation failed: ${demandRes.status}`);
  }

  const manifest = await verifyAnalysisReviewManifest(demandRes.runId, businessDate, client);

  if (!manifest.passedAllInvariants) {
    const failures = manifest.invariantsReport.filter((r) => r.startsWith("❌"));
    throw new Error(
      `Dataset verification manifest failed on critical invariants:\n${failures.join("\n")}`
    );
  }

  return {
    success: true,
    profile,
    businessDate,
    batchesSynchronized: dataset.allBatches.length,
    demandRunId: demandRes.runId,
    alreadyLoaded: false,
    manifest,
  };
}

export interface AnalysisReviewCleanResult {
  success: boolean;
  profile: string;
  cleanedLotMasters: number;
  cleanedLotHistories: number;
  cleanedPolishedMirrors: number;
  cleanedSyncRuns: number;
  cleanedDataQualityIssues: number;
  cleanedDemandRuns: number;
}

export async function cleanAnalysisReviewFixture(options: {
  profile: string;
  confirmDestructiveClean: boolean;
  client?: DbClient;
  databaseUrl?: string;
}): Promise<AnalysisReviewCleanResult> {
  if (!options.confirmDestructiveClean) {
    throw new Error(
      "Cleanup refused: --confirm-destructive-clean flag is required to delete fixture profile records."
    );
  }

  if (options.profile !== FIXTURE_PROFILE_CODE) {
    throw new Error(
      `Cleanup refused: Unsupported fixture profile '${options.profile}'. Expected '${FIXTURE_PROFILE_CODE}'.`
    );
  }

  if (!isIsolatedTestDatabase(options.databaseUrl ?? process.env.DATABASE_URL)) {
    throw new Error(
      "Cleanup refused: deleting fixture canonical records and immutable history is only permitted " +
        "on a provably isolated disposable review database (planning_sectest or planning_review). " +
        "To refresh the development dataset, reload the fixture instead.",
    );
  }

  const client = options.client ?? db;

  const mirrors = await client.polishedStone.deleteMany({
    where: { fantasyLotId: { startsWith: NAMESPACE_PREFIX } },
  });

  const histories = await client.lotHistoryRecord.deleteMany({
    where: { lotId: { startsWith: NAMESPACE_PREFIX } },
  });

  const masters = await client.lotMasterRecord.deleteMany({
    where: { lotId: { startsWith: NAMESPACE_PREFIX } },
  });

  const dqIssues = await client.dataQualityIssue.deleteMany({
    where: {
      OR: [
        { recordId: { startsWith: NAMESPACE_PREFIX } },
        { issueCode: { startsWith: `DQ-${NAMESPACE_PREFIX}` } },
        { batchId: { startsWith: NAMESPACE_PREFIX } },
      ],
    },
  });

  const syncRuns = await client.integrationSyncRun.deleteMany({
    where: { batchId: { startsWith: NAMESPACE_PREFIX } },
  });

  const fixtureRuns = await client.demandRun.findMany({
    where: { actor: { startsWith: "ANALYSIS_REVIEW_LOADER" } },
    select: { id: true },
  });
  const runIds = fixtureRuns.map((r) => r.id);
  if (runIds.length > 0) {
    await client.demandMetricTraceItem.deleteMany({ where: { runId: { in: runIds } } });
    await client.demandMetric.deleteMany({ where: { runId: { in: runIds } } });
    await client.demandRun.deleteMany({ where: { id: { in: runIds } } });
  }

  // 7. The synchronization checkpoint is never moved backwards. A cleaned namespace is
  // reloaded at the checkpoint the system has already reached, so replayed batches are
  // new work rather than a rewind of committed progress.

  return {
    success: true,
    profile: options.profile,
    cleanedLotMasters: masters.count,
    cleanedLotHistories: histories.count,
    cleanedPolishedMirrors: mirrors.count,
    cleanedSyncRuns: syncRuns.count,
    cleanedDataQualityIssues: dqIssues.count,
    cleanedDemandRuns: runIds.length,
  };
}
