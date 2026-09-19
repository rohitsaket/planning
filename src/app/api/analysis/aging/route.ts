import { db } from "@/lib/db";
import { ok, num } from "@/lib/api-utils";
import { withApi, SCAN_MAX, scanned } from "@/lib/api/with-api";

// Stock Aging Analysis — 0-30, 31-60, 61-90, 91-180, 181-365, 365+
export const GET = withApi({ permission: "analysis.read" }, async () => {
  const stones = await db.polishedStone.findMany({ take: SCAN_MAX }).then(scanned);
  const now = new Date();
  const buckets = [
    { label: "0-30", min: 0, max: 30, pieces: 0, carats: 0 },
    { label: "31-60", min: 31, max: 60, pieces: 0, carats: 0 },
    { label: "61-90", min: 61, max: 90, pieces: 0, carats: 0 },
    { label: "91-180", min: 91, max: 180, pieces: 0, carats: 0 },
    { label: "181-365", min: 181, max: 365, pieces: 0, carats: 0 },
    { label: "365+", min: 366, max: 999999, pieces: 0, carats: 0 },
  ];
  for (const s of stones) {
    const ageDays = Math.floor((now.getTime() - new Date(s.lastUpdated).getTime()) / (1000 * 60 * 60 * 24));
    const b = buckets.find((x) => ageDays >= x.min && ageDays <= x.max);
    if (b) {
      b.pieces += 1;
      b.carats += num(s.weight);
    }
  }
  const slowMoving = buckets.filter((b) => b.min >= 91).reduce((s, b) => s + b.pieces, 0);
  return ok({
    buckets: buckets.map((b) => ({ label: b.label, pieces: b.pieces, carats: num(b.carats) })),
    slowMoving,
    slowMovingPct: stones.length > 0 ? num((slowMoving / stones.length) * 100) : 0,
  });
});
