import { db } from "@/lib/db";
import { ok, num } from "@/lib/api-utils";
import { withApi, qStr, SCAN_MAX, scanned } from "@/lib/api/with-api";

// Sales Trend Analysis — Previous 30D / Middle 30D / Latest 30D / 90D total / 180D / 365D context
export const GET = withApi({ permission: "sales.read" }, async (req: Request) => {
  const url = new URL(req.url);
  const groupBy = qStr(url, "groupBy") || "shape";
  const now = new Date();

  const since30 = new Date(now); since30.setDate(since30.getDate() - 30);
  const since60 = new Date(now); since60.setDate(since60.getDate() - 60);
  const since90 = new Date(now); since90.setDate(since90.getDate() - 90);
  const since180 = new Date(now); since180.setDate(since180.getDate() - 180);
  const since365 = new Date(now); since365.setDate(since365.getDate() - 365);

  const records365 = await db.salesRecord.findMany({ take: SCAN_MAX,
    where: { lotStatusDb: "Invoice", docDate: { gte: since365 } },
    include: { weightBand: true },
  }).then(scanned);

  const keyOf = (r: typeof records365[number]) => {
    if (groupBy === "shape") return r.shape;
    if (groupBy === "lab") return r.labNormalized ?? "Non-Cert";
    if (groupBy === "weightBand") return r.weightBand?.label ?? "Unmapped";
    return `${r.labNormalized ?? "Non-Cert"}|${r.shape}|${r.weightBand?.label ?? "Unmapped"}`;
  };

  type Agg = { prev30: number; mid30: number; latest30: number; total90: number; total180: number; total365: number };
  const agg = new Map<string, Agg>();

  for (const r of records365) {
    const k = keyOf(r);
    const cur = agg.get(k) ?? { prev30: 0, mid30: 0, latest30: 0, total90: 0, total180: 0, total365: 0 };
    cur.total365 += 1;
    if (r.docDate >= since180) cur.total180 += 1;
    if (r.docDate >= since90) cur.total90 += 1;
    if (r.docDate >= since30) cur.latest30 += 1;
    else if (r.docDate >= since60) cur.mid30 += 1;
    else if (r.docDate >= since90) cur.prev30 += 1;
    agg.set(k, cur);
  }

  const rows = Array.from(agg.entries()).map(([k, v]) => {
    let trend = "Stable";
    const prev = v.prev30;
    const latest = v.latest30;
    if (prev === 0 && latest === 0) trend = "Dormant";
    else if (prev === 0 && latest > 0) trend = "New Demand";
    else if (prev === 0 || latest === 0) trend = "Volatile";
    else {
      const pct = ((latest - prev) / prev) * 100;
      if (pct >= 50) trend = "Strong Growth";
      else if (pct >= 10) trend = "Growth";
      else if (pct <= -50) trend = "Strong Decline";
      else if (pct <= -10) trend = "Declining";
      else trend = "Stable";
    }
    return {
      key: k,
      prev30: v.prev30,
      mid30: v.mid30,
      latest30: v.latest30,
      total90: v.total90,
      total180: v.total180,
      total365: v.total365,
      trend,
      pctChange: prev === 0 ? (latest > 0 ? 100 : 0) : num(((latest - prev) / prev) * 100),
    };
  }).sort((a, b) => b.total90 - a.total90);

  return ok({ groupBy, rows });
});
