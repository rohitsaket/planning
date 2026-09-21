// SA-11 benchmark: database aggregation vs the previous in-memory approach, on the throwaway
// security-test database only. Usage: bun scripts/with-sectest-db.ts bun scripts/bench-sales-analysis.ts
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { db } from "../src/lib/db";
import { SECTEST_DB } from "../tests/security/test-db";
import { aggregateSales, getSalesAnalysis, loadLabels, loadSalesFactRows, type SalesFilters } from "../src/lib/analytics/sales-analysis";
import { businessWindow } from "../src/lib/analytics/reporting-date";
import { SCAN_MAX, scanned } from "../src/lib/api/with-api";

if (!process.env.DATABASE_URL?.includes(`/${SECTEST_DB}`)) throw new Error("refusing to benchmark outside the sectest database");

const NOW = new Date("2026-09-19T10:00:00Z");
const f: SalesFilters = { dimension: "shape", windowDays: 365, now: NOW, timezone: "UTC" };
const heapMb = () => process.memoryUsage().heapUsed / 1_048_576;
const median = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];

async function seed(n: number) {
  await db.$executeRawUnsafe(`TRUNCATE "SalesRecord", "MemoRecord", "SalesOrderLine", "SalesOrder", "Customer" CASCADE`);
  const c = await db.customer.create({ data: { customerCode: `BENCH-${n}`, name: "Bench", country: "IN", branch: "SRT" } });
  const shapes = ["Round", "Oval", "Pear", "Emerald", "Cushion", "Heart"];
  for (let i = 0; i < n; i += 5000) {
    await db.salesRecord.createMany({
      data: Array.from({ length: Math.min(5000, n - i) }, (_, j) => {
        const k = i + j;
        return { lotId: `BENCH-${n}-${k}`, docDate: new Date(NOW.getTime() - (k % 360) * 86_400_000), lotStatusDb: "Invoice", shape: shapes[k % 6], weight: 1 + (k % 97) / 100, saleTotalUsd: 5000 + (k % 1000), customerId: c.id, country: "IN", branch: "SRT", labNormalized: k % 3 ? "GIA" : null };
      }),
    });
  }
}

async function measure(fn: () => Promise<unknown>) {
  const times: number[] = [];
  let peak = 0;
  for (let i = 0; i < 3; i++) {
    const g = globalThis as Record<string, any>;
    if (typeof g.Bun?.gc === "function") g.Bun.gc(true);
    else if (typeof g.gc === "function") g.gc();
    const before = heapMb();
    const t = performance.now();
    await fn();
    times.push(performance.now() - t);
    peak = Math.max(peak, heapMb() - before);
  }
  return { ms: median(times), heapMb: peak };
}

const lines: string[] = [];
for (const n of [1_000, 10_000, 60_000]) {
  await seed(n);
  const dbRes = await getSalesAnalysis(f);
  const window = businessWindow(NOW, f.windowDays, f.timezone);
  const refRes = aggregateSales(await loadSalesFactRows(f, window), f, window, await loadLabels(f.dimension));
  const same = dbRes.totalPieces === refRes.totalPieces && Math.abs(dbRes.totalValue - refRes.totalValue) < 1e-3 && Math.abs(dbRes.totalCarats - refRes.totalCarats) < 1e-6 && dbRes.rows.length === refRes.rows.length;
  const dbM = await measure(() => getSalesAnalysis(f));
  const memM = await measure(async () => aggregateSales(await loadSalesFactRows(f, window), f, window, await loadLabels(f.dimension)));
  let oldCeiling = "ok";
  try {
    scanned(await loadSalesFactRows(f, window, SCAN_MAX));
  } catch {
    oldCeiling = "503 RESULT_LIMIT_EXCEEDED";
  }
  lines.push(`| ${n.toLocaleString("en-US")} | ${dbRes.totalPieces} | ${same ? "identical" : "**DIFFERENT**"} | ${dbM.ms.toFixed(0)} ms | ${memM.ms.toFixed(0)} ms | ${dbM.heapMb.toFixed(1)} MB | ${memM.heapMb.toFixed(1)} MB | ${oldCeiling} |`);
  console.log(lines.at(-1));
}
await db.$executeRawUnsafe(`TRUNCATE "SalesRecord", "Customer" CASCADE`);

const scriptDir = import.meta.dirname || (import.meta as any).dir || path.dirname(new URL(import.meta.url).pathname);
const out = path.resolve(scriptDir, "../security-audit/remediation/evidence");
mkdirSync(out, { recursive: true });
writeFileSync(
  path.join(out, "sales-sa11-benchmark.md"),
  `# SA-11 benchmark (${new Date().toISOString()}, local PostgreSQL 18, dimension=shape, 365D, median of 3)\n\n` +
    `Queries per request — database path: 2 aggregate queries (+1 label lookup for Customer/Weight Band), returning one row per group/bucket. ` +
    `Previous path: 1 query returning every qualifying stone row (+1 label lookup).\n\n` +
    `| Invoice rows | Pieces | Result vs in-memory | DB aggregation | In-memory (previous) | Heap Δ DB | Heap Δ in-memory | Previous production path (50k ceiling) |\n|---|---|---|---|---|---|---|---|\n${lines.join("\n")}\n\n` +
    `Heap Δ is a noisy single-process indicator (GC timing), not a precise measurement.\n`,
);
process.exit(0);
