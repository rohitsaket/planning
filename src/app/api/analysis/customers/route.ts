import { db } from "@/lib/db";
import { ok, num } from "@/lib/api-utils";

// Customer 360 — list customers with sales aggregates
export async function GET(req: Request) {
  const url = new URL(req.url);
  const since = new Date();
  since.setDate(since.getDate() - 365);

  const customers = await db.customer.findMany({
    include: {
      salesRecords: { where: { lotStatusDb: "Invoice", docDate: { gte: since } } },
      memoRecords: { where: { status: "OPEN" } },
      salesOrders: { where: { status: { in: ["OPEN", "PARTIAL"] } } },
    },
  });

  const rows = customers.map((c) => {
    const pieces = c.salesRecords.length;
    const carats = c.salesRecords.reduce((s, r) => s + num(r.weight), 0);
    const value = c.salesRecords.reduce((s, r) => s + num(r.saleTotalUsd), 0);
    const memoExposure = c.memoRecords.reduce((s, r) => s + num(r.memoValueUsd), 0);
    const lastPurchase = c.salesRecords.length > 0
      ? c.salesRecords.reduce((d, r) => r.docDate > d ? r.docDate : d, c.salesRecords[0].docDate).toISOString()
      : null;
    return {
      id: c.id,
      customerCode: c.customerCode,
      name: c.name,
      country: c.country,
      branch: c.branch,
      accountOwner: c.accountOwner,
      businessPriority: c.businessPriority,
      priorityReason: c.priorityReason,
      pieces,
      carats: num(carats),
      totalValue: num(value),
      avgPerCt: carats > 0 ? num(value / carats) : 0,
      openOrders: c.salesOrders.length,
      memoExposure: num(memoExposure),
      lastPurchase,
    };
  }).sort((a, b) => b.totalValue - a.totalValue);

  return ok({ rows });
}
