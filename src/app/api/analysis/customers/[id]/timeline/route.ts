import { db } from "@/lib/db";
import { ok, num } from "@/lib/api-utils";
import { classifyWeightBand, normalizeLab, normalizeShape } from "@/lib/domain/diamond-rules";

// Customer 360 — monthly purchase timeline (last 12 months) + preference breakdown.
// Aggregates only Invoice sales for this customer over the trailing 365 days.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const customer = await db.customer.findUnique({ where: { id } });
  if (!customer) {
    return Response.json({ error: "Customer not found" }, { status: 404 });
  }

  // Last 12 months window
  const now = new Date();
  const since = new Date(now);
  since.setDate(since.getDate() - 365);

  const records = await db.salesRecord.findMany({
    where: {
      customerId: id,
      lotStatusDb: "Invoice",
      docDate: { gte: since },
    },
    include: { weightBand: true },
  });

  // ---- Build the 12-month skeleton (oldest → newest, calendar months) ----
  const monthlyMap = new Map<string, { pieces: number; carats: number; value: number }>();
  const months: string[] = [];
  const cursor = new Date(now.getFullYear(), now.getMonth() - 11, 1, 0, 0, 0, 0);
  for (let i = 0; i < 12; i++) {
    const d = new Date(cursor.getFullYear(), cursor.getMonth() + i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    months.push(key);
    monthlyMap.set(key, { pieces: 0, carats: 0, value: 0 });
  }

  // ---- Preference aggregations ----
  const shapes = new Map<string, number>();
  const weightBands = new Map<string, number>();
  const labs = new Map<string, number>();
  const colors = new Map<string, number>();
  const clarities = new Map<string, number>();

  for (const r of records) {
    // Monthly bucket
    const d = new Date(r.docDate);
    const mKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const cur = monthlyMap.get(mKey);
    if (cur) {
      cur.pieces += 1;
      cur.carats += num(r.weight);
      cur.value += num(r.saleTotalUsd);
    }

    // Shapes — prefer stored shape, fall back to normalized
    const shapeName = r.shape?.trim() || normalizeShape(r.shape).normalized || "Unknown";
    shapes.set(shapeName, (shapes.get(shapeName) ?? 0) + 1);

    // Weight band — prefer related band label, fall back to classifier
    let bandLabel = r.weightBand?.label;
    if (!bandLabel) {
      const def = classifyWeightBand(r.weight);
      bandLabel = def?.label ?? "Unmapped";
    }
    weightBands.set(bandLabel, (weightBands.get(bandLabel) ?? 0) + 1);

    // Labs — use normalized if present, else derive from raw
    let labName = r.labNormalized?.trim();
    if (!labName) {
      const norm = normalizeLab(r.labRaw);
      labName = norm.normalized;
    }
    labs.set(labName, (labs.get(labName) ?? 0) + 1);

    // Colors
    const colorName = r.color?.trim() || "Unknown";
    colors.set(colorName, (colors.get(colorName) ?? 0) + 1);

    // Clarities
    const clarityName = r.clarity?.trim() || "Unknown";
    clarities.set(clarityName, (clarities.get(clarityName) ?? 0) + 1);
  }

  // Sort each preference desc and take top N
  const top = (m: Map<string, number>, n: number) =>
    Array.from(m.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, n);

  const monthly = months.map((month) => {
    const v = monthlyMap.get(month)!;
    return {
      month,
      pieces: v.pieces,
      carats: num(v.carats),
      value: num(v.value),
    };
  });

  return ok({
    customerId: id,
    customerName: customer.name,
    customerCode: customer.customerCode,
    totalRecords: records.length,
    monthly,
    preferences: {
      shapes: top(shapes, 8),
      weightBands: top(weightBands, 8),
      labs: top(labs, 5),
      colors: top(colors, 8),
      clarities: top(clarities, 8),
    },
  });
}
