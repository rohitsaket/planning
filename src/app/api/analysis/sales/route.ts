import { db } from "@/lib/db";
import { ok, num } from "@/lib/api-utils";

// Sales Analysis — by dimension (lab, shape, weightBand, color, clarity, treatment, customer, country, branch, month)
// Supports windows: 7, 30, 60, 90, 180, 365 days
// Honors global filter params: country, branch, lab
export async function GET(req: Request) {
  const url = new URL(req.url);
  const dimension = url.searchParams.get("dimension") || "shape";
  const windowDays = parseInt(url.searchParams.get("windowDays") || "90", 10);
  const country = url.searchParams.get("country");
  const branch = url.searchParams.get("branch");
  const lab = url.searchParams.get("lab");

  const since = new Date();
  since.setDate(since.getDate() - windowDays);

  const where: Record<string, unknown> = {
    lotStatusDb: "Invoice",
    docDate: { gte: since },
  };
  if (country) where.country = country;
  if (branch) where.branch = branch;
  if (lab) where.labNormalized = lab;

  const records = await db.salesRecord.findMany({ where });

  const agg = new Map<string, { pieces: number; carats: number; value: number }>();
  for (const r of records) {
    let key = "";
    switch (dimension) {
      case "lab": key = r.labNormalized ?? "Non-Cert"; break;
      case "shape": key = r.shape; break;
      case "weightBand": key = r.weightBandId ?? "Unmapped"; break;
      case "color": key = r.color ?? "Unknown"; break;
      case "clarity": key = r.clarity ?? "Unknown"; break;
      case "treatment": key = r.treatment ?? "NULL"; break;
      case "customer": key = r.customerId; break;
      case "country": key = r.country; break;
      case "branch": key = r.branch; break;
      case "month": {
        const d = new Date(r.docDate);
        key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
        break;
      }
      default: key = r.shape;
    }
    const cur = agg.get(key) ?? { pieces: 0, carats: 0, value: 0 };
    cur.pieces += 1;
    cur.carats += num(r.weight);
    cur.value += num(r.saleTotalUsd);
    agg.set(key, cur);
  }

  // Resolve foreign-key labels
  const customerLabels = new Map<string, string>();
  if (dimension === "customer") {
    const customers = await db.customer.findMany();
    for (const c of customers) customerLabels.set(c.id, c.name);
  }
  const bandLabels = new Map<string, string>();
  if (dimension === "weightBand") {
    const bands = await db.weightBand.findMany();
    for (const b of bands) bandLabels.set(b.id, b.label);
  }

  const totalValue = Array.from(agg.values()).reduce((s, v) => s + v.value, 0);
  const rows = Array.from(agg.entries())
    .map(([k, v]) => {
      let label = k;
      if (dimension === "customer") label = customerLabels.get(k) ?? "Unknown";
      if (dimension === "weightBand") label = bandLabels.get(k) ?? "Unmapped";
      return {
        dimension: label,
        pieces: v.pieces,
        carats: num(v.carats),
        value: num(v.value),
        avgPerCt: v.carats > 0 ? num(v.value / v.carats) : 0,
        pct: totalValue > 0 ? num((v.value / totalValue) * 100) : 0,
      };
    })
    .sort((a, b) => b.value - a.value);

  return ok({ dimension, windowDays, totalPieces: records.length, totalValue: num(totalValue), rows });
}
