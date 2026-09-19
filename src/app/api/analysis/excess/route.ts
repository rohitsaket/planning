import { db } from "@/lib/db";
import { ok, num } from "@/lib/api-utils";
import { withApi } from "@/lib/api/with-api";

// Excess Stock Analysis — MAX(0, Available - Target)
export const GET = withApi({ permission: "analysis.read" }, async () => {
  const latestRun = await db.demandRun.findFirst({
    orderBy: { runDate: "desc" },
    include: { metrics: true },
  });
  if (!latestRun) return ok({ rows: [] });

  const rows = latestRun.metrics
    .filter((m) => num(m.excessStock) > 0)
    .map((m) => ({
      category: m.planningCategory,
      excessQty: num(m.excessStock),
      available: num(m.availableStock),
      target: num(m.roundedTarget),
      shortage: num(m.physicalShortage),
    }))
    .sort((a, b) => b.excessQty - a.excessQty);

  const totalExcess = rows.reduce((s, r) => s + r.excessQty, 0);

  return ok({
    rows,
    totalExcess,
    warning: "Excess analytics do NOT change the confirmed shortage formula. Shortage = MAX(0, Target - Available); Excess = MAX(0, Available - Target).",
  });
});
