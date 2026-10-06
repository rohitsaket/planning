import type { Prisma } from "@prisma/client";
import { db } from "./helpers";
import { runDemandCalculation } from "@/lib/demand/demand-service";
import { getISTDateString, parseISTDateToUTC } from "@/lib/fantasy/time";

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

export function cutoffIst(now: Date = new Date()): string {
  return getISTDateString(now);
}

export function istDaysBack(daysBack: number, hour = 12, now: Date = new Date()): Date {
  const start = parseISTDateToUTC(cutoffIst(now));
  return new Date(start.getTime() - daysBack * 86_400_000 + hour * 3_600_000);
}

export interface LotSpec {
  lotId: string;
  history: Array<{ status: string; at: Date; removalReason?: string; quantity?: number }>;
  shape?: string;
  labRaw?: string;
  weight?: number;
  quantity?: number;
  country?: string;
  branch?: string;
  customerCode?: string;
  customerName?: string;
  currentStatus?: string;
  removalReason?: string;
}

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

export function sold(lotId: string, daysBack: number, extra: Partial<LotSpec> = {}): LotSpec {
  return { lotId, history: [{ status: "INVOICE", at: istDaysBack(daysBack), removalReason: "EXPLICIT_SALE" }], ...extra };
}

export async function runSnapshot(windowDays = 90) {
  const result = await runDemandCalculation({ actor: "sales-analysis-test", windowDays });
  if (!result.success) throw new Error(`Demand snapshot did not complete: ${result.status}`);
  return result;
}

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

export function invalidateWorld(): void {
  currentWorld = null;
}

export async function cleanupSalesWorld(): Promise<void> {
  await resetSalesWorld();
  invalidateWorld();
  if (originalSourceMode === undefined) delete process.env.FANTASY_SOURCE_MODE;
  else process.env.FANTASY_SOURCE_MODE = originalSourceMode;
}

const A = { shape: "ROUND", labRaw: "GIA", weight: 1.1 } as const;
const B = { shape: "OV", labRaw: "IGI", weight: 0.6 } as const;

async function buildCoreWorld() {
  await lot(sold("SA-A-1", 1, A));
  await lot(sold("SA-A-2", 10, A));
  await lot(sold("SA-A-3", 29, A));
  await lot(sold("SA-A-QTY", 5, { ...A, quantity: 3 }));
  await lot(sold("SA-A-CUST", 16, { ...A, customerCode: "C-IN", customerName: "Alpha Diamonds" }));
  await lot(sold("SA-A-4", 30, A));
  await lot(sold("SA-A-5", 59, A));
  await lot(sold("SA-A-6", 60, A));
  await lot({ lotId: "SA-A-7", ...A, history: [{ status: "INVOICE", at: istDaysBack(89, 0), removalReason: "EXPLICIT_SALE" }] });

  await lot({ lotId: "SA-EDGE-IN", ...A, history: [{ status: "INVOICE", at: istDaysBack(0, 23) }] });
  await lot({ lotId: "SA-EDGE-BEFORE", ...A, history: [{ status: "INVOICE", at: istDaysBack(90, 23) }] });
  await lot({ lotId: "SA-EDGE-AFTER", ...A, history: [{ status: "INVOICE", at: istDaysBack(-1, 0) }] });

  await lot({ lotId: "SA-DEDUP", ...A, history: [
    { status: "INVOICE", at: istDaysBack(12) },
    { status: "SOLD", at: istDaysBack(11) },
  ] });

  await lot({ lotId: "SA-EPISODE", ...A, history: [
    { status: "INVOICE", at: istDaysBack(70) },
    { status: "STOCK", at: istDaysBack(65) },
    { status: "INVOICE", at: istDaysBack(40) },
  ] });

  await lot({ lotId: "SA-CANCEL", ...A, currentStatus: "CANCELLED", removalReason: "CANCELLED", history: [
    { status: "INVOICE", at: istDaysBack(20) },
    { status: "CANCELLED", at: istDaysBack(5), removalReason: "CANCELLED" },
  ] });

  await lot(sold("SA-B-1", 2, B));
  await lot(sold("SA-B-2", 20, B));
  await lot(sold("SA-B-BE", 15, { ...B, country: "BE", branch: "ANT", customerCode: "C-BE", customerName: "Beta Jewels" }));

  await lot({ lotId: "SA-MEMO", ...A, history: [{ status: "MEMO", at: istDaysBack(8) }] });
  await lot({ lotId: "SA-RESERVED", ...A, history: [{ status: "RESERVED", at: istDaysBack(8) }] });
  await lot({ lotId: "SA-WIP", ...A, currentStatus: "WIP_POLISHING", history: [{ status: "WIP_POLISHING", at: istDaysBack(8) }] });
  await lot({ lotId: "SA-STOCK", ...A, history: [{ status: "STOCK", at: istDaysBack(8) }] });
  await lot({ lotId: "SA-TRANSFER", ...A, currentStatus: "TRANSFERRED", removalReason: "TRANSFERRED", history: [
    { status: "STOCK", at: istDaysBack(40) },
    { status: "TRANSFERRED", at: istDaysBack(8), removalReason: "TRANSFERRED" },
  ] });

  const customer = await db.customer.create({ data: { customerCode: "C-ORD", name: "Ordering House", country: "IN", branch: "SRT" } });
  const order = await db.salesOrder.create({
    data: { orderNumber: "SA-ORD-1", customerId: customer.id, orderDate: istDaysBack(3), branch: "SRT", country: "IN", status: "OPEN" },
  });
  await db.salesOrderLine.create({
    data: { orderId: order.id, lineNo: 1, shape: "ROUND", weight: 1.1, qtyOrdered: 25, qtyOutstanding: 25, backorderQty: 5 },
  });
}

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

async function buildBulkWorld() {
  const shapes = ["RD", "OV", "PR"];
  const weights = [0.35, 0.6, 1.1];
  const labs = ["GIA", "IGI", "NONE"];
  const masters: Prisma.LotMasterRecordCreateManyInput[] = [];
  const history: Prisma.LotHistoryRecordCreateManyInput[] = [];
  for (let i = 0; i < BULK_LOT_COUNT; i++) {
    const lotId = `SA-BULK-${i}`;
    const at = istDaysBack(i % 89, 6);
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
