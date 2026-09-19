import { db } from "@/lib/db";
import { ok, num } from "@/lib/api-utils";

// Customer 360 — list customers with sales aggregates
// Honors global filter params: country, branch, lab
export async function GET(req: Request) {
  const url = new URL(req.url);
  const country = url.searchParams.get("country");
  const branch = url.searchParams.get("branch");
  const lab = url.searchParams.get("lab");

  const since = new Date();
  since.setDate(since.getDate() - 365);

  // Sales records filter: by status + date window + global filter
  const salesWhere: Record<string, unknown> = {
    lotStatusDb: "Invoice",
    docDate: { gte: since },
  };
  if (country) salesWhere.country = country;
  if (branch) salesWhere.branch = branch;
  if (lab) salesWhere.labNormalized = lab;

  // Customer-level filter — customers themselves are filtered by country/branch
  const customerWhere: Record<string, unknown> = {};
  if (country) customerWhere.country = country;
  if (branch) customerWhere.branch = branch;

  // Memo records filter (no lab — memo has labNormalized but the lab filter is
  // not relevant for the memo exposure aggregate; keep parity with sales)
  const memoWhere: Record<string, unknown> = { status: "OPEN" };
  if (country) memoWhere.country = country;
  if (branch) memoWhere.branch = branch;

  // Sales orders filter (no lab — SalesOrder has no lab field)
  const orderWhere: Record<string, unknown> = { status: { in: ["OPEN", "PARTIAL"] } };
  if (country) orderWhere.country = country;
  if (branch) orderWhere.branch = branch;

  const customers = await db.customer.findMany({
    where: customerWhere,
    include: {
      salesRecords: { where: salesWhere },
      memoRecords: { where: memoWhere },
      salesOrders: { where: orderWhere },
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
