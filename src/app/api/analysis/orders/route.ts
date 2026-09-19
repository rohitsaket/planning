import { db } from "@/lib/db";
import { ok, num } from "@/lib/api-utils";

// Order Analysis — list sales orders with line aggregates
// Honors global filter params: country, branch (no lab — SalesOrder has no lab field)
export async function GET(req: Request) {
  const url = new URL(req.url);
  const country = url.searchParams.get("country");
  const branch = url.searchParams.get("branch");

  const where: Record<string, unknown> = {};
  if (country) where.country = country;
  if (branch) where.branch = branch;

  const orders = await db.salesOrder.findMany({
    where,
    include: {
      customer: true,
      lines: true,
    },
    orderBy: { orderDate: "desc" },
  });

  const rows = orders.map((o) => {
    const lines = o.lines.length;
    const qtyOrdered = o.lines.reduce((s, l) => s + l.qtyOrdered, 0);
    const qtyOutstanding = o.lines.reduce((s, l) => s + l.qtyOutstanding, 0);
    const backorder = o.lines.reduce((s, l) => s + l.backorderQty, 0);
    return {
      id: o.id,
      orderNumber: o.orderNumber,
      customerName: o.customer.name,
      orderDate: o.orderDate.toISOString(),
      requiredDate: o.requiredDate?.toISOString() ?? null,
      promisedDate: o.promisedDate?.toISOString() ?? null,
      status: o.status,
      priority: o.priority,
      priorityReason: o.priorityReason,
      lines,
      qtyOrdered,
      qtyOutstanding,
      backorderQty: backorder,
      country: o.country,
      branch: o.branch,
    };
  });

  return ok({ rows });
}
