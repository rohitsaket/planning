import { call, db } from "./helpers";
import { resetRateLimits } from "@/lib/api/rate-limit";
import { GET as readCatalog, POST as saveMapping } from "@/app/api/planning/sarin/shape-mappings/route";
import { DELETE as removeMapping } from "@/app/api/planning/sarin/shape-mappings/[ruleId]/route";

export interface CatalogRule {
  rawShape: string;
  normalizedShape: string;
  conditionKind?: "NONE" | "RATIO_RANGE";
  ratioMin?: string | null;
  ratioMax?: string | null;
}

const key = (shape: string) => shape.trim().toUpperCase();
const d3 = (v: string | null | undefined) => (v === null || v === undefined || v === "" ? null : Number(v).toFixed(3));
const signature = (r: { rawShape: string; normalizedShape: string; applyTo: string; min: string | null | undefined; max: string | null | undefined }) =>
  `${key(r.rawShape)}|${r.normalizedShape}|${r.applyTo}|${d3(r.min) ?? ""}|${d3(r.max) ?? ""}`;

export async function effectiveSnapshotId(): Promise<string | null> {
  return (await db.sarinShapeMappingSet.findFirst({ where: { sourceSystem: "SARIN", status: "EFFECTIVE" }, select: { id: true } }))?.id ?? null;
}

export async function applyCatalog(managerCookie: string, rules: readonly CatalogRule[]): Promise<string> {
  resetRateLimits();
  const current = await call(readCatalog, { cookie: managerCookie, path: "/api/planning/sarin/shape-mappings" });
  if (current.status !== 200) throw new Error(`catalog read failed ${current.status}`);
  const wanted = new Set(rules.map((r) => signature({ rawShape: r.rawShape, normalizedShape: r.normalizedShape, applyTo: r.conditionKind === "RATIO_RANGE" ? "RATIO_RANGE" : "ALL_RATIOS", min: r.ratioMin, max: r.ratioMax })));
  const have = new Set<string>();
  for (const m of current.json.mappings as Array<{ id: string; sarinShape: string; fantasyShape: string; applyTo: string; minimumRatio: string | null; maximumRatio: string | null }>) {
    const sig = signature({ rawShape: m.sarinShape, normalizedShape: m.fantasyShape, applyTo: m.applyTo, min: m.minimumRatio, max: m.maximumRatio });
    if (wanted.has(sig)) {
      have.add(sig);
      continue;
    }
    resetRateLimits();
    const removed = await call(removeMapping, { method: "DELETE", cookie: managerCookie, params: { ruleId: m.id } });
    if (removed.status !== 200) throw new Error(`mapping remove failed ${removed.status}`);
  }
  for (const r of rules) {
    const applyTo = r.conditionKind === "RATIO_RANGE" ? "RATIO_RANGE" : "ALL_RATIOS";
    if (have.has(signature({ rawShape: r.rawShape, normalizedShape: r.normalizedShape, applyTo, min: r.ratioMin, max: r.ratioMax }))) continue;
    resetRateLimits();
    const saved = await call(saveMapping, {
      method: "POST",
      cookie: managerCookie,
      body: { sarinShape: r.rawShape, fantasyShape: r.normalizedShape, applyTo, minimumRatio: r.ratioMin ?? null, maximumRatio: r.ratioMax ?? null },
    });
    if (saved.status !== 200) throw new Error(`mapping save failed ${saved.status} ${JSON.stringify(saved.json)}`);
  }
  const id = await effectiveSnapshotId();
  if (!id) throw new Error("no effective catalog");
  return id;
}

export async function makeEffectiveSnapshot(rules: ReadonlyArray<{ key: string; shape: string; kind?: string; min?: string | null; max?: string | null }>, createdByUserId = "catalog-fixture") {
  const [{ d }] = await db.$queryRaw<{ d: string }[]>`SELECT current_database() AS d`;
  if (d !== "planning_sectest") throw new Error(`refusing to write fixtures to ${d}`);
  return db.$transaction(async (tx) => {
    const current = await tx.sarinShapeMappingSet.findFirst({ where: { sourceSystem: "SARIN", status: "EFFECTIVE" }, select: { id: true } });
    const top = await tx.sarinShapeMappingSet.aggregate({ where: { sourceSystem: "SARIN" }, _max: { version: true } });
    const set = await tx.sarinShapeMappingSet.create({ data: { sourceSystem: "SARIN", version: (top._max.version ?? 0) + 1, origin: "USER", createdByUserId, copiedFromSetId: current?.id ?? null } });
    for (const r of rules) {
      await tx.sarinShapeMappingRule.create({
        data: { mappingSetId: set.id, rawShapeKey: r.key, sourceRawShape: r.key, normalizedShape: r.shape, conditionKind: r.kind ?? "NONE", ratioMin: r.min ?? null, ratioMax: r.max ?? null },
      });
    }
    if (current) await tx.sarinShapeMappingSet.update({ where: { id: current.id }, data: { status: "SUPERSEDED", supersededBySetId: set.id } });
    return tx.sarinShapeMappingSet.update({ where: { id: set.id }, data: { status: "EFFECTIVE" } });
  });
}
