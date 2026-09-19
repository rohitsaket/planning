import { db } from "@/lib/db";
import { ok, num } from "@/lib/api-utils";

// Memo Analysis — separate decision context; does NOT reduce shortage
// Honors global filter params: country, branch (no lab — MemoRecord has no
// lab filter relevant for the memo exposure aggregate; the lab field is
// informational only)
export async function GET(req: Request) {
  const url = new URL(req.url);
  const country = url.searchParams.get("country");
  const branch = url.searchParams.get("branch");

  const where: Record<string, unknown> = {};
  if (country) where.country = country;
  if (branch) where.branch = branch;

  const memos = await db.memoRecord.findMany({ where, include: { customer: true } });
  const now = new Date();

  // By country
  const byCountry = new Map<string, { qty: number; value: number; avgAge: number; count: number }>();
  const byCustomer = new Map<string, { qty: number; value: number; avgAge: number; count: number }>();
  let totalValue = 0;
  let totalQty = 0;
  const ageBuckets = { "0-30": 0, "31-60": 0, "61-90": 0, "91-180": 0, "180+": 0 };

  for (const m of memos) {
    const age = m.memoAgeDays ?? Math.floor((now.getTime() - new Date(m.memoDate).getTime()) / (1000 * 60 * 60 * 24));
    totalValue += num(m.memoValueUsd);
    totalQty += 1;

    const c = byCountry.get(m.country) ?? { qty: 0, value: 0, avgAge: 0, count: 0 };
    c.qty += 1; c.value += num(m.memoValueUsd); c.avgAge += age; c.count += 1;
    byCountry.set(m.country, c);

    const cust = byCustomer.get(m.customer.name) ?? { qty: 0, value: 0, avgAge: 0, count: 0 };
    cust.qty += 1; cust.value += num(m.memoValueUsd); cust.avgAge += age; cust.count += 1;
    byCustomer.set(m.customer.name, cust);

    if (age <= 30) ageBuckets["0-30"]++;
    else if (age <= 60) ageBuckets["31-60"]++;
    else if (age <= 90) ageBuckets["61-90"]++;
    else if (age <= 180) ageBuckets["91-180"]++;
    else ageBuckets["180+"]++;
  }

  const finalize = (m: Map<string, { qty: number; value: number; avgAge: number; count: number }>) =>
    Array.from(m.entries()).map(([k, v]) => ({
      dimension: k, qty: v.qty, value: num(v.value), avgAge: Math.round(v.avgAge / Math.max(1, v.count)),
    })).sort((a, b) => b.value - a.value);

  return ok({
    totalQty,
    totalValue: num(totalValue),
    byCountry: finalize(byCountry),
    byCustomer: finalize(byCustomer),
    ageBuckets,
    rows: memos.map((m) => ({
      id: m.id,
      lotId: m.lotId,
      memoDate: m.memoDate.toISOString(),
      customerName: m.customer.name,
      country: m.country,
      branch: m.branch,
      shape: m.shape,
      weight: num(m.weight),
      lab: m.labNormalized,
      color: m.color,
      clarity: m.clarity,
      treatment: m.treatment,
      memoValueUsd: num(m.memoValueUsd),
      status: m.status,
      memoAgeDays: m.memoAgeDays,
    })),
  });
}
