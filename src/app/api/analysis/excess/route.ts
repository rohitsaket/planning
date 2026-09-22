import { db } from "@/lib/db";
import { ok, num } from "@/lib/api-utils";
import { withApi } from "@/lib/api/with-api";

// Excess Stock Analysis — Excess = MAX(0, Available - Target), read from the latest
// usable demand run. A failed or still-running snapshot is never presented as a result.
export const GET = withApi({ permission: "analysis.read" }, async () => {
  const latestRun = await db.demandRun.findFirst({
    where: { status: { in: ["COMPLETED", "REVIEW_REQUIRED"] } },
    orderBy: { runDate: "desc" },
    include: { metrics: true },
  });
  if (!latestRun) {
    return ok({
      rows: [],
      totalExcess: 0,
      hasEverRun: false,
      runStatus: "NOT_RUN",
      runId: null,
      runDate: null,
      warning: "No completed demand calculation exists yet, so excess stock cannot be derived.",
    });
  }

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
    hasEverRun: true,
    runStatus: latestRun.status,
    runId: latestRun.id,
    runDate: latestRun.runDate.toISOString(),
    warning: "Excess analytics do NOT change the confirmed shortage formula. Shortage = MAX(0, Target - Available); Excess = MAX(0, Available - Target).",
  });
});
