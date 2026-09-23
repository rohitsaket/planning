/**
 * Sales Analysis fixtures for the isolated security-test database only.
 *
 * These build the *canonical source* — lot master records and their immutable lifecycle
 * history — and then run the real demand calculation to produce the authoritative sales
 * snapshot the Sales Analysis page reads.
 *
 * That is deliberate. The page's whole claim is that it reports the confirmed sales the
 * centralized eligibility policy admitted; a fixture that wrote the snapshot directly
 * would prove nothing about that policy, and a test built from reconstructed arrays
 * would prove nothing about either.
 */

import { db } from "./helpers";
import { runDemandCalculation } from "@/lib/demand/demand-service";
import { getISTDateString, parseISTDateToUTC } from "@/lib/fantasy/time";

/** Cleans every table the sales snapshot is built from. History precedes master (RESTRICT). */
export async function resetSalesWorld() {
  await db.demandMetricTraceItem.deleteMany({});
  await db.demandMetric.deleteMany({});
  await db.demandRun.deleteMany({});
  await db.demandCalculationLock.deleteMany({});
  await db.dataQualityIssue.deleteMany({});
  await db.lotHistoryRecord.deleteMany({});
  await db.lotMasterRecord.deleteMany({});
  await db.polishedStone.deleteMany({});
  await db.memoRecord.deleteMany({});
  await db.salesOrderLine.deleteMany({});
  await db.salesOrder.deleteMany({});
  await db.salesRecord.deleteMany({});
  await db.customer.deleteMany({});
  await db.weightBand.deleteMany({});
  await db.labMapping.deleteMany({});
  await db.shapeMapping.deleteMany({});
  await db.integrationSyncRun.deleteMany({});
}

/** The approved mappings and weight bands every fixture lot resolves through. */
export async function seedMappings() {
  await db.weightBand.createMany({
    data: [
      { code: "SA-0.30", label: "0.30 - 0.49 ct", minCt: 0.3, maxCt: 0.49, sortOrder: 1, active: true },
      { code: "SA-0.50", label: "0.50 - 0.99 ct", minCt: 0.5, maxCt: 0.99, sortOrder: 2, active: true },
      { code: "SA-1.00", label: "1.00 - 1.99 ct", minCt: 1.0, maxCt: 1.99, sortOrder: 3, active: true },
    ],
  });
  await db.labMapping.createMany({
    data: [
      { rawLab: "GIA", normalizedLab: "GIA", active: true },
      { rawLab: "IGI", normalizedLab: "IGI", active: true },
      { rawLab: "NONE", normalizedLab: "NON_CERTIFIED", active: true },
    ],
  });
  await db.shapeMapping.createMany({
    data: [
      { rawShape: "RD", normalizedShape: "ROUND", active: true },
      { rawShape: "ROUND", normalizedShape: "ROUND", active: true },
      { rawShape: "OV", normalizedShape: "OVAL", active: true },
      { rawShape: "PR", normalizedShape: "PRINCESS", active: true },
    ],
  });
}

/** Today's IST business date, the cutoff every fixture instant is measured back from. */
export function cutoffIst(now: Date = new Date()): string {
  return getISTDateString(now);
}

/** Start-of-day UTC instant of the IST business date `daysBack` days before the cutoff. */
export function istDaysBack(daysBack: number, hour = 12, now: Date = new Date()): Date {
  const start = parseISTDateToUTC(cutoffIst(now));
  return new Date(start.getTime() - daysBack * 86_400_000 + hour * 3_600_000);
}

export interface LotSpec {
  lotId: string;
  /** Lifecycle versions in order. The first is version 1. */
  history: Array<{ status: string; at: Date; removalReason?: string; quantity?: number }>;
  shape?: string;
  labRaw?: string;
  weight?: number;
  quantity?: number;
  country?: string;
  branch?: string;
  customerCode?: string;
  customerName?: string;
  /** Status the lot master currently reports. Defaults to the last history status. */
  currentStatus?: string;
  removalReason?: string;
}

/**
 * Creates one lot master record and its lifecycle history exactly as the synchronization
 * service would. The demand calculation reads these, not the fixture's intent.
 */
export async function lot(spec: LotSpec) {
  const last = spec.history[spec.history.length - 1];
  const common = {
    shape: spec.shape ?? "ROUND",
    shapeNormalized: spec.shape ?? "ROUND",
    labRaw: spec.labRaw ?? "GIA",
    labNormalized: spec.labRaw === "NONE" ? null : (spec.labRaw ?? "GIA"),
    weight: spec.weight ?? 1.1,
    country: spec.country ?? "IN",
    branch: spec.branch ?? "SRT",
    customerCode: spec.customerCode ?? null,
    customerName: spec.customerName ?? null,
    roughOrPolished: "POLISHED",
  };

  await db.lotMasterRecord.create({
    data: {
      ...common,
      lotId: spec.lotId,
      currentStatus: spec.currentStatus ?? last.status,
      docDate: last.at,
      statusEffectiveDate: last.at,
      quantity: spec.quantity ?? 1,
      removalReason: spec.removalReason ?? last.removalReason ?? null,
      isCurrent: true,
      lastSyncBatchId: "SA-B1",
      checkpoint: 1,
      isSimulated: true,
    },
  });

  for (const [i, h] of spec.history.entries()) {
    await db.lotHistoryRecord.create({
      data: {
        ...common,
        lotId: spec.lotId,
        version: i + 1,
        status: h.status,
        docDate: h.at,
        statusEffectiveDate: h.at,
        quantity: h.quantity ?? spec.quantity ?? 1,
        removalReason: h.removalReason ?? null,
        isCurrent: i === spec.history.length - 1,
        syncBatchId: "SA-B1",
        checkpoint: 1,
        isSimulated: true,
      },
    });
  }
}

/** A lot with one confirmed sale event in the window. */
export function sold(lotId: string, daysBack: number, extra: Partial<LotSpec> = {}): LotSpec {
  return { lotId, history: [{ status: "INVOICE", at: istDaysBack(daysBack), removalReason: "EXPLICIT_SALE" }], ...extra };
}

/** Runs the real demand calculation and returns the snapshot it persisted. */
export async function runSnapshot(windowDays = 90) {
  const result = await runDemandCalculation({ actor: "sales-analysis-test", windowDays });
  if (!result.success) throw new Error(`Demand snapshot did not complete: ${result.status}`);
  return result;
}

/** A successful source synchronization, so readiness can report a real last-sync time. */
export async function recordSuccessfulSync(finishedAt = new Date()) {
  await db.integrationSyncRun.create({
    data: {
      source: "FANTASY",
      entity: "ALL",
      status: "SUCCESS",
      sourceMode: "FIXTURE",
      isSimulated: true,
      batchId: "SA-B1",
      startedAt: new Date(finishedAt.getTime() - 1000),
      finishedAt,
    },
  });
}

// ---------------------------------------------------------------------------
// Worlds
// ---------------------------------------------------------------------------

/**
 * Named source worlds. Building one runs the real demand calculation, so each is built
 * at most once and reused by every suite that asks for it.
 */
export type WorldName = "core" | "quality" | "bulk" | "empty";

let currentWorld: WorldName | null = null;
const originalSourceMode = process.env.FANTASY_SOURCE_MODE;

export const CATEGORY_A = "GIA|ROUND|1.00 - 1.99 ct";
export const CATEGORY_B = "IGI|OVAL|0.50 - 0.99 ct";

export async function ensureWorld(name: WorldName): Promise<void> {
  if (currentWorld === name) return;
  process.env.FANTASY_SOURCE_MODE = "FIXTURE";
  await resetSalesWorld();
  await seedMappings();
  await recordSuccessfulSync();
  if (name === "core") await buildCoreWorld();
  if (name === "quality") await buildQualityWorld();
  if (name === "bulk") await buildBulkWorld();
  if (name !== "empty") await runSnapshot();
  currentWorld = name;
}

/** Forces the next ensureWorld() to rebuild, after a test has changed the data. */
export function invalidateWorld(): void {
  currentWorld = null;
}

/**
 * Leaves the database as these suites found it.
 *
 * The suites that run afterwards build their own worlds from the same tables, and a few
 * hundred leftover lots or a leftover synchronization record would quietly change what
 * they observe. Registered on the last sales suite in each module rather than at module
 * level, because module teardown runs only once the whole run has finished.
 */
export async function cleanupSalesWorld(): Promise<void> {
  await resetSalesWorld();
  invalidateWorld();
  if (originalSourceMode === undefined) delete process.env.FANTASY_SOURCE_MODE;
  else process.env.FANTASY_SOURCE_MODE = originalSourceMode;
}

const A = { shape: "ROUND", labRaw: "GIA", weight: 1.1 } as const;
const B = { shape: "OV", labRaw: "IGI", weight: 0.6 } as const;

/**
 * The core world: two categories across the three 30-day windows, both window edges,
 * a repeated lifecycle event, a genuine second sale episode, an invoice later
 * cancelled, and a full set of records that must never be counted as sales.
 */
async function buildCoreWorld() {
  // Category A — 10 confirmed pieces over 8 records in the latest window.
  await lot(sold("SA-A-1", 1, A));
  await lot(sold("SA-A-2", 10, A));
  await lot(sold("SA-A-3", 29, A));
  await lot(sold("SA-A-QTY", 5, { ...A, quantity: 3 }));
  await lot(sold("SA-A-CUST", 16, { ...A, customerCode: "C-IN", customerName: "Alpha Diamonds" }));
  // Middle and previous windows.
  await lot(sold("SA-A-4", 30, A));
  await lot(sold("SA-A-5", 59, A));
  await lot(sold("SA-A-6", 60, A));
  // Exactly the first included business date of the window.
  await lot({ lotId: "SA-A-7", ...A, history: [{ status: "INVOICE", at: istDaysBack(89, 0), removalReason: "EXPLICIT_SALE" }] });

  // Window edges. 23:00 IST on the cutoff date is inside; one hour before the window
  // opens, and any instant after the cutoff day ends, are outside.
  await lot({ lotId: "SA-EDGE-IN", ...A, history: [{ status: "INVOICE", at: istDaysBack(0, 23) }] });
  await lot({ lotId: "SA-EDGE-BEFORE", ...A, history: [{ status: "INVOICE", at: istDaysBack(90, 23) }] });
  await lot({ lotId: "SA-EDGE-AFTER", ...A, history: [{ status: "INVOICE", at: istDaysBack(-1, 0) }] });

  // One business sale reported twice by the source lifecycle.
  await lot({ lotId: "SA-DEDUP", ...A, history: [
    { status: "INVOICE", at: istDaysBack(12) },
    { status: "SOLD", at: istDaysBack(11) },
  ] });

  // A genuine second sale episode after the lot returned to stock.
  await lot({ lotId: "SA-EPISODE", ...A, history: [
    { status: "INVOICE", at: istDaysBack(70) },
    { status: "STOCK", at: istDaysBack(65) },
    { status: "INVOICE", at: istDaysBack(40) },
  ] });

  // An invoice that was later cancelled.
  await lot({ lotId: "SA-CANCEL", ...A, currentStatus: "CANCELLED", removalReason: "CANCELLED", history: [
    { status: "INVOICE", at: istDaysBack(20) },
    { status: "CANCELLED", at: istDaysBack(5), removalReason: "CANCELLED" },
  ] });

  // Category B — sales only in the latest window, so the earlier window has no
  // denominator to compare against.
  await lot(sold("SA-B-1", 2, B));
  await lot(sold("SA-B-2", 20, B));
  await lot(sold("SA-B-BE", 15, { ...B, country: "BE", branch: "ANT", customerCode: "C-BE", customerName: "Beta Jewels" }));

  // None of these is a sale and none may ever appear in a sales total.
  await lot({ lotId: "SA-MEMO", ...A, history: [{ status: "MEMO", at: istDaysBack(8) }] });
  await lot({ lotId: "SA-RESERVED", ...A, history: [{ status: "RESERVED", at: istDaysBack(8) }] });
  await lot({ lotId: "SA-WIP", ...A, currentStatus: "WIP_POLISHING", history: [{ status: "WIP_POLISHING", at: istDaysBack(8) }] });
  await lot({ lotId: "SA-STOCK", ...A, history: [{ status: "STOCK", at: istDaysBack(8) }] });
  await lot({ lotId: "SA-TRANSFER", ...A, currentStatus: "TRANSFERRED", removalReason: "TRANSFERRED", history: [
    { status: "STOCK", at: istDaysBack(40) },
    { status: "TRANSFERRED", at: istDaysBack(8), removalReason: "TRANSFERRED" },
  ] });

  // An open order is a commitment, not a sale.
  const customer = await db.customer.create({ data: { customerCode: "C-ORD", name: "Ordering House", country: "IN", branch: "SRT" } });
  const order = await db.salesOrder.create({
    data: { orderNumber: "SA-ORD-1", customerId: customer.id, orderDate: istDaysBack(3), branch: "SRT", country: "IN", status: "OPEN" },
  });
  await db.salesOrderLine.create({
    data: { orderId: order.id, lineNo: 1, shape: "ROUND", weight: 1.1, qtyOrdered: 25, qtyOutstanding: 25, backorderQty: 5 },
  });
}

/**
 * The data-quality world: a sale whose shape is not an approved mapping, and a shape
 * whose approved value begins with a spreadsheet formula trigger.
 */
async function buildQualityWorld() {
  await db.shapeMapping.create({ data: { rawShape: "=CMD", normalizedShape: "=CMD", active: true } });
  await lot(sold("SAQ-OK", 5, A));
  await lot(sold("SAQ-UNMAPPED", 6, { ...A, shape: "NOT-A-SHAPE" }));
  await lot(sold("SAQ-FORMULA", 7, { ...A, shape: "=CMD" }));
  await lot({ lotId: "SAQ-TRANSFER", ...A, currentStatus: "TRANSFERRED", removalReason: "TRANSFERRED", history: [
    { status: "STOCK", at: istDaysBack(40) },
    { status: "TRANSFERRED", at: istDaysBack(9), removalReason: "TRANSFERRED" },
  ] });
}

export const BULK_LOT_COUNT = 420;

/** Enough confirmed sales, spread over enough categories, to exercise real paging. */
async function buildBulkWorld() {
  const shapes = ["RD", "OV", "PR"];
  const weights = [0.35, 0.6, 1.1];
  const labs = ["GIA", "IGI", "NONE"];
  const masters: Parameters<typeof db.lotMasterRecord.createMany>[0]["data"] = [];
  const history: Parameters<typeof db.lotHistoryRecord.createMany>[0]["data"] = [];
  for (let i = 0; i < BULK_LOT_COUNT; i++) {
    const lotId = `SA-BULK-${i}`;
    const at = istDaysBack(i % 89, 6);
    // Shape, lab and weight advance at different rates so the fixture really produces
    // many distinct categories rather than three correlated ones.
    const labRaw = labs[Math.floor(i / shapes.length) % labs.length];
    const row = {
      lotId,
      shape: shapes[i % shapes.length],
      shapeNormalized: shapes[i % shapes.length],
      labRaw,
      labNormalized: labRaw === "NONE" ? null : labRaw,
      weight: weights[Math.floor(i / (shapes.length * labs.length)) % weights.length],
      country: i % 5 === 0 ? "BE" : "IN",
      branch: i % 5 === 0 ? "ANT" : "SRT",
      roughOrPolished: "POLISHED",
      docDate: at,
      statusEffectiveDate: at,
      quantity: 1,
      isSimulated: true,
      checkpoint: 1,
    };
    masters.push({ ...row, currentStatus: "INVOICE", removalReason: "EXPLICIT_SALE", isCurrent: true, lastSyncBatchId: "SA-B1" });
    history.push({ ...row, version: 1, status: "INVOICE", removalReason: "EXPLICIT_SALE", isCurrent: true, syncBatchId: "SA-B1" });
  }
  await db.lotMasterRecord.createMany({ data: masters });
  await db.lotHistoryRecord.createMany({ data: history });
}
