import { db } from "@/lib/db";
import { ok, num } from "@/lib/api-utils";
import { withApi, qStr, SCAN_MAX, scanned } from "@/lib/api/with-api";

// Polished Stock Analysis — by planning class, lab, shape, weight band, age
export const GET = withApi({ permission: "analysis.read" }, async (req: Request) => {
  const url = new URL(req.url);
  const dimension = qStr(url, "dimension") || "planningClass";

  const stones = await db.polishedStone.findMany({ take: SCAN_MAX, include: { weightBand: true } }).then(scanned);
  const now = new Date();

  const agg = new Map<string, { pieces: number; carats: number; value: number }>();
  for (const s of stones) {
    let key = "";
    switch (dimension) {
      case "planningClass": key = s.planningClass; break;
      case "lab": key = s.labNormalized ?? "Non-Cert"; break;
      case "shape": key = s.shape; break;
      case "weightBand": key = s.weightBand?.label ?? "Unmapped"; break;
      case "country": key = s.country; break;
      case "branch": key = s.branch; break;
      case "treatment": key = s.treatment ?? "NULL"; break;
      case "fantasyStatus": key = s.fantasyStatus; break;
      default: key = s.planningClass;
    }
    const cur = agg.get(key) ?? { pieces: 0, carats: 0, value: 0 };
    cur.pieces += 1;
    cur.carats += num(s.weight);
    cur.value += num(s.weight) * 5000; // estimated value placeholder
    agg.set(key, cur);
  }

  const rows = Array.from(agg.entries()).map(([k, v]) => ({
    dimension: k,
    pieces: v.pieces,
    carats: num(v.carats),
    value: num(v.value),
  })).sort((a, b) => b.pieces - a.pieces);

  // Aging buckets
  const aging = { "0-30": 0, "31-60": 0, "61-90": 0, "91-180": 0, "181-365": 0, "365+": 0 };
  for (const s of stones) {
    const ageDays = Math.floor((now.getTime() - new Date(s.lastUpdated).getTime()) / (1000 * 60 * 60 * 24));
    if (ageDays <= 30) aging["0-30"]++;
    else if (ageDays <= 60) aging["31-60"]++;
    else if (ageDays <= 90) aging["61-90"]++;
    else if (ageDays <= 180) aging["91-180"]++;
    else if (ageDays <= 365) aging["181-365"]++;
    else aging["365+"]++;
  }

  return ok({
    totalPieces: stones.length,
    totalCarats: num(stones.reduce((s, x) => s + num(x.weight), 0)),
    dimension,
    rows,
    aging,
  });
});
