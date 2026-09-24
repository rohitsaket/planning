import { beforeAll, describe, expect, test } from "./harness";
import { db, resetDb } from "./helpers";
import { Prisma } from "@prisma/client";
import {
  BUCKET_LABELS,
  CURRENT_STOCK_WHERE,
  INVENTORY_BUCKETS,
  NON_INVENTORY_LIFECYCLES,
  bucketLabel,
  currentStockSql,
  deriveInventoryBucket,
  inventoryBucketSql,
  isCurrentStock,
  isInventoryBucket,
  needsReview,
  needsReviewSql,
  confirmedQuantitySql,
  type InventoryBucket,
} from "@/lib/analysis/inventory-buckets";
import { CANONICAL_LIFECYCLES, HOLD_STATES, INVENTORY_CLASSES } from "@/lib/fantasy/classification";
import { CANONICAL_QUANTITY_PROVENANCES, resolveCanonicalQuantity } from "@/lib/fantasy/quantity-weight";

/**
 * Centralized inventory buckets.
 *
 * Two derivations exist — one in SQL, one in memory — because aggregation happens in the
 * database while row-level rendering happens in TypeScript. A second derivation is a
 * second place to be wrong, so the first suite drives both over the complete cross
 * product of classification inputs against the real database and asserts they never
 * disagree. The remaining suites pin the branch order and the current-stock rule.
 */

const BATCH = "BUCKET-CENTRAL-TEST";

/** Every classification input the canonical model can hold, including the null cases. */
const CLASSIFICATION_STATES: Array<string | null> = [null, "CLASSIFIED", "BLOCKED", "NOT_CONFIGURED"];
const CLASSES: Array<string | null> = [null, ...INVENTORY_CLASSES];
const HOLDS: Array<string | null> = [null, ...HOLD_STATES];
const FORMS: Array<string | null> = [null, "ROUGH", "POLISHED", "WIP", "OTHER"];

interface Combination {
  lotId: string;
  classificationState: string | null;
  inventoryClass: string | null;
  holdState: string | null;
  roughOrPolished: string | null;
}

function combinations(): Combination[] {
  const out: Combination[] = [];
  let i = 0;
  for (const classificationState of CLASSIFICATION_STATES) {
    for (const inventoryClass of CLASSES) {
      for (const holdState of HOLDS) {
        for (const roughOrPolished of FORMS) {
          out.push({ lotId: `${BATCH}-${i++}`, classificationState, inventoryClass, holdState, roughOrPolished });
        }
      }
    }
  }
  return out;
}

async function clearFixtures() {
  await db.lotHistoryRecord.deleteMany({ where: { syncBatchId: BATCH } });
  await db.lotMasterRecord.deleteMany({ where: { lastSyncBatchId: BATCH } });
}

describe("Inventory buckets — SQL and in-memory derivations agree", () => {
  const combos = combinations();

  beforeAll(async () => {
    await resetDb();
    await clearFixtures();
    // `roughOrPolished` is non-nullable on the model, so the null form is represented by
    // the string the adapter writes when the source does not say. The SQL and the TS
    // branch on the same value either way.
    await db.lotMasterRecord.createMany({
      data: combos.map((c) => ({
        lotId: c.lotId,
        currentStatus: "STOCK",
        statusEffectiveDate: new Date(),
        docDate: new Date(),
        shape: "ROUND",
        shapeNormalized: "ROUND",
        weight: new Prisma.Decimal(1),
        labNormalized: "GIA",
        quantity: new Prisma.Decimal(1),
        country: "IN",
        branch: "SRT",
        lastSyncBatchId: BATCH,
        isCurrent: true,
        roughOrPolished: c.roughOrPolished ?? "OTHER",
        sourceType: "FIXTURE",
        isSimulated: true,
        inventoryClass: c.inventoryClass,
        classificationState: c.classificationState,
        holdState: c.holdState,
        canonicalLifecycle: "AVAILABLE",
        firstSeenAt: new Date(),
        lastSeenAt: new Date(),
      })),
    });
  });

  test("the full cross product of classification inputs buckets identically in SQL and in memory", async () => {
    const rows = await db.$queryRaw<Array<{ lot_id: string; bucket: string }>>`
      SELECT "m"."lotId" AS lot_id, ${inventoryBucketSql("m")} AS bucket
      FROM "LotMasterRecord" "m"
      WHERE "m"."lastSyncBatchId" = ${BATCH}`;

    expect(rows.length).toBe(combos.length);

    const bySql = new Map(rows.map((r) => [r.lot_id, r.bucket]));
    const disagreements: string[] = [];
    for (const c of combos) {
      const sql = bySql.get(c.lotId);
      const memory = deriveInventoryBucket({
        classificationState: c.classificationState,
        inventoryClass: c.inventoryClass,
        holdState: c.holdState,
        roughOrPolished: c.roughOrPolished ?? "OTHER",
      });
      if (sql !== memory) {
        disagreements.push(
          `${c.classificationState}/${c.inventoryClass}/${c.holdState}/${c.roughOrPolished}: sql=${sql} memory=${memory}`,
        );
      }
    }
    expect(disagreements).toEqual([]);
  });

  test("every combination lands in exactly one known bucket", async () => {
    const rows = await db.$queryRaw<Array<{ bucket: string; n: bigint }>>`
      SELECT ${inventoryBucketSql("m")} AS bucket, COUNT(*) AS n
      FROM "LotMasterRecord" "m"
      WHERE "m"."lastSyncBatchId" = ${BATCH}
      GROUP BY 1`;
    const total = rows.reduce((s, r) => s + Number(r.n), 0);
    expect(total).toBe(combos.length);
    const unknown = rows.map((r) => r.bucket).filter((b) => !isInventoryBucket(b));
    expect(unknown).toEqual([]);
  });

  test("an unclassified record can never reach an available bucket", async () => {
    // The restrictive branches are tested first, so nothing classified as physically
    // available becomes available while its classification is missing or incomplete.
    const escaped = combos
      .filter((c) => c.classificationState !== "CLASSIFIED" || c.inventoryClass === null)
      .map((c) =>
        deriveInventoryBucket({
          classificationState: c.classificationState,
          inventoryClass: c.inventoryClass,
          holdState: c.holdState,
          roughOrPolished: c.roughOrPolished ?? "OTHER",
        }),
      )
      .filter((b) => b !== "REVIEW_REQUIRED");
    expect(escaped).toEqual([]);
  });

  test("a held or unknown-hold record is never available, whatever its class says", async () => {
    const escaped = combos
      .filter((c) => c.classificationState === "CLASSIFIED" && c.inventoryClass !== null)
      .filter((c) => c.holdState === null || c.holdState === "HELD" || c.holdState === "UNKNOWN")
      .map((c) =>
        deriveInventoryBucket({
          classificationState: c.classificationState,
          inventoryClass: c.inventoryClass,
          holdState: c.holdState,
          roughOrPolished: c.roughOrPolished ?? "OTHER",
        }),
      )
      .filter((b) => b !== "HELD_OR_EXCLUDED");
    expect(escaped).toEqual([]);
  });

  test("rough stock is never filed as available polished", () => {
    const bucket = deriveInventoryBucket({
      classificationState: "CLASSIFIED",
      inventoryClass: "PHYSICAL_AVAILABLE",
      holdState: "NOT_HELD",
      roughOrPolished: "ROUGH",
    });
    expect(bucket).toBe("ROUGH_AVAILABLE");
  });
});

describe("Inventory buckets — the raw vocabulary is never treated as a bucket", () => {
  test("no raw inventoryClass value is a valid bucket key", () => {
    // This is the defect the centralization removes: `inventoryClass` holds
    // PHYSICAL_AVAILABLE, RESERVED, MEMO, WIP, EXCLUDED, none of which is a bucket. Any
    // module that casts one to `InventoryBucket` produces a filter that matches nothing.
    const accepted = INVENTORY_CLASSES.filter((c) => isInventoryBucket(c));
    expect(accepted).toEqual([]);
  });

  test("an unrecognized value gets the review label rather than a fabricated one", () => {
    expect(bucketLabel("PHYSICAL_AVAILABLE")).toBe(BUCKET_LABELS.REVIEW_REQUIRED);
    expect(bucketLabel(null)).toBe(BUCKET_LABELS.REVIEW_REQUIRED);
    expect(bucketLabel("PHYSICAL_AVAILABLE_POLISHED")).toBe(BUCKET_LABELS.PHYSICAL_AVAILABLE_POLISHED);
  });

  test("every bucket has a label and every label has a bucket", () => {
    const labelled = Object.keys(BUCKET_LABELS).sort();
    expect(labelled).toEqual([...INVENTORY_BUCKETS].sort());
  });
});

describe("Inventory buckets — current-stock eligibility", () => {
  const LIFECYCLE_BATCH = `${BATCH}-LIFE`;

  beforeAll(async () => {
    await db.lotHistoryRecord.deleteMany({ where: { syncBatchId: LIFECYCLE_BATCH } });
    await db.lotMasterRecord.deleteMany({ where: { lastSyncBatchId: LIFECYCLE_BATCH } });
    // One record per lifecycle, plus the null case, all flagged current by the feed.
    const lifecycles: Array<string | null> = [null, ...CANONICAL_LIFECYCLES];
    await db.lotMasterRecord.createMany({
      data: lifecycles.map((lifecycle, i) => ({
        lotId: `${LIFECYCLE_BATCH}-${i}`,
        currentStatus: "STOCK",
        statusEffectiveDate: new Date(),
        docDate: new Date(),
        shape: "ROUND",
        shapeNormalized: "ROUND",
        weight: new Prisma.Decimal(1),
        labNormalized: "GIA",
        quantity: new Prisma.Decimal(1),
        country: "IN",
        branch: "SRT",
        lastSyncBatchId: LIFECYCLE_BATCH,
        isCurrent: true,
        roughOrPolished: "POLISHED",
        sourceType: "FIXTURE",
        isSimulated: true,
        inventoryClass: "PHYSICAL_AVAILABLE",
        classificationState: "CLASSIFIED",
        holdState: "NOT_HELD",
        canonicalLifecycle: lifecycle,
        firstSeenAt: new Date(),
        lastSeenAt: new Date(),
      })),
    });
  });

  test("isCurrent alone does not make a sold, transferred or closed record stock", async () => {
    const rows = await db.$queryRaw<Array<{ lifecycle: string | null }>>`
      SELECT "m"."canonicalLifecycle" AS lifecycle
      FROM "LotMasterRecord" "m"
      WHERE "m"."lastSyncBatchId" = ${LIFECYCLE_BATCH} AND ${currentStockSql("m")}`;
    const kept = rows.map((r) => r.lifecycle);
    for (const excluded of NON_INVENTORY_LIFECYCLES) {
      expect(kept.includes(excluded)).toBe(false);
    }
  });

  test("a null lifecycle stays visible rather than being silently dropped", async () => {
    // `NOT IN` returns NULL for a NULL left-hand side, so an implementation that relied on
    // SQL `<>` semantics would drop exactly the records that most need review.
    const rows = await db.$queryRaw<Array<{ lifecycle: string | null }>>`
      SELECT "m"."canonicalLifecycle" AS lifecycle
      FROM "LotMasterRecord" "m"
      WHERE "m"."lastSyncBatchId" = ${LIFECYCLE_BATCH} AND ${currentStockSql("m")}`;
    expect(rows.some((r) => r.lifecycle === null)).toBe(true);
  });

  test("the SQL predicate and the Prisma where clause select the same records", async () => {
    const viaSql = await db.$queryRaw<Array<{ lot_id: string }>>`
      SELECT "m"."lotId" AS lot_id
      FROM "LotMasterRecord" "m"
      WHERE "m"."lastSyncBatchId" = ${LIFECYCLE_BATCH} AND ${currentStockSql("m")}`;
    const viaPrisma = await db.lotMasterRecord.findMany({
      where: { lastSyncBatchId: LIFECYCLE_BATCH, ...CURRENT_STOCK_WHERE },
      select: { lotId: true },
    });
    expect(viaPrisma.map((r) => r.lotId).sort()).toEqual(viaSql.map((r) => r.lot_id).sort());
  });

  test("the in-memory predicate agrees with the database predicate", async () => {
    const all = await db.lotMasterRecord.findMany({
      where: { lastSyncBatchId: LIFECYCLE_BATCH },
      select: { lotId: true, isCurrent: true, canonicalLifecycle: true },
    });
    const viaMemory = all.filter(isCurrentStock).map((r) => r.lotId).sort();
    const viaSql = await db.$queryRaw<Array<{ lot_id: string }>>`
      SELECT "m"."lotId" AS lot_id
      FROM "LotMasterRecord" "m"
      WHERE "m"."lastSyncBatchId" = ${LIFECYCLE_BATCH} AND ${currentStockSql("m")}`;
    expect(viaMemory).toEqual(viaSql.map((r) => r.lot_id).sort());
  });

  test("a record the feed no longer publishes is not stock regardless of lifecycle", async () => {
    await db.lotMasterRecord.updateMany({
      where: { lotId: `${LIFECYCLE_BATCH}-0` },
      data: { isCurrent: false },
    });
    const rows = await db.lotMasterRecord.findMany({
      where: { lotId: `${LIFECYCLE_BATCH}-0`, ...CURRENT_STOCK_WHERE },
      select: { lotId: true },
    });
    expect(rows).toEqual([]);
    await db.lotMasterRecord.updateMany({
      where: { lotId: `${LIFECYCLE_BATCH}-0` },
      data: { isCurrent: true },
    });
  });

  test("UNKNOWN is not treated as a departure", () => {
    // Unknown is a reason to review a record, not evidence that the goods have left.
    expect((NON_INVENTORY_LIFECYCLES as readonly string[]).includes("UNKNOWN")).toBe(false);
    expect(isCurrentStock({ isCurrent: true, canonicalLifecycle: "UNKNOWN" })).toBe(true);
  });
});

describe("Inventory buckets — the confirmed-quantity rule is the same in SQL and in memory", () => {
  const QTY_BATCH = `${BATCH}-QTY`;

  /**
   * Every shape a stored quantity can take: recorded provenance of each kind, no recorded
   * provenance at all, an unrecognized provenance string, and the values that must not be
   * counted — zero, fractional and negative — against both a fixture and a live source.
   */
  const QUANTITY_CASES: Array<{ provenance: string | null; quantity: number; sourceType: string; simulated: boolean }> = [];
  {
    const provenances: Array<string | null> = [null, "NOT_A_REAL_CODE", ...CANONICAL_QUANTITY_PROVENANCES];
    const values = [0, 1, 2, 5, 1500, 2.5];
    for (const provenance of provenances) {
      for (const quantity of values) {
        QUANTITY_CASES.push({ provenance, quantity, sourceType: "FIXTURE", simulated: true });
        QUANTITY_CASES.push({ provenance, quantity, sourceType: "LIVE", simulated: false });
      }
    }
  }

  beforeAll(async () => {
    await db.lotHistoryRecord.deleteMany({ where: { syncBatchId: QTY_BATCH } });
    await db.lotMasterRecord.deleteMany({ where: { lastSyncBatchId: QTY_BATCH } });
    await db.lotMasterRecord.createMany({
      data: QUANTITY_CASES.map((c, i) => ({
        lotId: `${QTY_BATCH}-${i}`,
        currentStatus: "STOCK",
        statusEffectiveDate: new Date(),
        docDate: new Date(),
        shape: "ROUND",
        shapeNormalized: "ROUND",
        weight: new Prisma.Decimal(1),
        labNormalized: "GIA",
        quantity: new Prisma.Decimal(c.quantity),
        quantityProvenance: c.provenance,
        country: "IN",
        branch: "SRT",
        lastSyncBatchId: QTY_BATCH,
        isCurrent: true,
        roughOrPolished: "POLISHED",
        sourceType: c.sourceType,
        isSimulated: c.simulated,
        inventoryClass: "PHYSICAL_AVAILABLE",
        classificationState: "CLASSIFIED",
        holdState: "NOT_HELD",
        canonicalLifecycle: "AVAILABLE",
        firstSeenAt: new Date(),
        lastSeenAt: new Date(),
      })),
    });
  });

  test("the SQL expression and resolveCanonicalQuantity decide every case identically", async () => {
    const viaSql = await db.$queryRaw<Array<{ lot_id: string; pieces: number | null }>>`
      SELECT "m"."lotId" AS lot_id, ${confirmedQuantitySql("m")}::float8 AS pieces
      FROM "LotMasterRecord" "m"
      WHERE "m"."lastSyncBatchId" = ${QTY_BATCH}`;
    const stored = await db.lotMasterRecord.findMany({
      where: { lastSyncBatchId: QTY_BATCH },
      select: { lotId: true, quantity: true, quantityProvenance: true, sourceType: true, isSimulated: true },
    });

    expect(viaSql.length).toBe(QUANTITY_CASES.length);

    const bySql = new Map(viaSql.map((r) => [r.lot_id, r.pieces]));
    const disagreements: string[] = [];
    for (const row of stored) {
      const memory = resolveCanonicalQuantity(row).pieces;
      const sql = bySql.get(row.lotId) ?? null;
      if (sql !== memory) {
        disagreements.push(
          `${row.quantityProvenance}/${String(row.quantity)}/${row.sourceType}: sql=${sql} memory=${memory}`,
        );
      }
    }
    expect(disagreements).toEqual([]);
  });

  test("a live source contributes no pieces until its quantity semantics are confirmed", async () => {
    const counted = await db.$queryRaw<Array<{ n: bigint }>>`
      SELECT COUNT(*) AS n
      FROM "LotMasterRecord" "m"
      WHERE "m"."lastSyncBatchId" = ${QTY_BATCH}
        AND "m"."sourceType" = 'LIVE'
        AND "m"."quantityProvenance" IS NULL
        AND ${confirmedQuantitySql("m")} IS NOT NULL`;
    expect(Number(counted[0]?.n ?? 0)).toBe(0);
  });

  test("zero, fractional and oversized-but-whole quantities are handled as the rule says", async () => {
    // Zero has no confirmed meaning, a fraction is not a piece count, and a large whole
    // number is simply a large piece count — the rule has no magic ceiling.
    const rows = await db.$queryRaw<Array<{ q: string; pieces: number | null }>>`
      SELECT "m"."quantity"::text AS q, ${confirmedQuantitySql("m")}::float8 AS pieces
      FROM "LotMasterRecord" "m"
      WHERE "m"."lastSyncBatchId" = ${QTY_BATCH}
        AND "m"."sourceType" = 'FIXTURE' AND "m"."quantityProvenance" IS NULL`;
    const byValue = new Map(rows.map((r) => [Number(r.q), r.pieces]));
    expect(byValue.get(0)).toBe(null);
    expect(byValue.get(2.5)).toBe(null);
    expect(byValue.get(1500)).toBe(1500);
  });

  test("the review rule flags a record whose quantity cannot be counted", async () => {
    const flagged = await db.$queryRaw<Array<{ n: bigint }>>`
      SELECT COUNT(*) AS n
      FROM "LotMasterRecord" "m"
      WHERE "m"."lastSyncBatchId" = ${QTY_BATCH}
        AND ${confirmedQuantitySql("m")} IS NULL
        AND NOT ${needsReviewSql("m")}`;
    // Every record here is classified, so an uncountable quantity is the only reason to
    // flag one — and no such record may escape the flag.
    expect(Number(flagged[0]?.n ?? 0)).toBe(0);
  });

  test("the in-memory review rule agrees with the SQL review rule", async () => {
    const viaSql = await db.$queryRaw<Array<{ lot_id: string; review: boolean }>>`
      SELECT "m"."lotId" AS lot_id, ${needsReviewSql("m")} AS review
      FROM "LotMasterRecord" "m"
      WHERE "m"."lastSyncBatchId" = ${QTY_BATCH}`;
    const stored = await db.lotMasterRecord.findMany({
      where: { lastSyncBatchId: QTY_BATCH },
      select: {
        lotId: true, quantity: true, quantityProvenance: true, sourceType: true,
        isSimulated: true, classificationState: true,
      },
    });
    const bySql = new Map(viaSql.map((r) => [r.lot_id, r.review]));
    const disagreements = stored
      .filter((row) => {
        const memory = needsReview({
          confirmedPieces: resolveCanonicalQuantity(row).pieces,
          classificationState: row.classificationState,
        });
        return bySql.get(row.lotId) !== memory;
      })
      .map((r) => r.lotId);
    expect(disagreements).toEqual([]);
  });
});

describe("Inventory buckets — the definition is not duplicated", () => {
  test("no other module declares its own bucket CASE expression", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");

    const roots = ["src/lib", "src/app", "src/components"];
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.tsx?$/.test(entry.name)) {
          const rel = full.split(path.sep).join("/");
          if (rel.endsWith("src/lib/analysis/inventory-buckets.ts")) continue;
          const text = fs.readFileSync(full, "utf8");
          // The bucket names appearing next to a SQL CASE is the copy this checks for.
          if (/CASE[\s\S]{0,400}'REVIEW_REQUIRED'/.test(text)) offenders.push(rel);
        }
      }
    };
    for (const r of roots) walk(r);
    expect(offenders).toEqual([]);
  });

  test("no module casts a raw classification column to the derived bucket type", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");

    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.tsx?$/.test(entry.name)) {
          const text = fs.readFileSync(full, "utf8");
          if (/\bas\s+InventoryBucket\b/.test(text)) offenders.push(full.split(path.sep).join("/"));
        }
      }
    };
    for (const r of ["src/lib", "src/app", "src/components"]) walk(r);
    expect(offenders).toEqual([]);
  });
});

describe("Inventory buckets — the module stays server-side", () => {
  test("the bucket module refuses to load in a browser", async () => {
    const fs = await import("node:fs");
    const source = fs.readFileSync("src/lib/analysis/inventory-buckets.ts", "utf8");
    expect(source.includes('typeof window !== "undefined"')).toBe(true);
  });

  test("no client component imports it", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.tsx?$/.test(entry.name)) {
          const text = fs.readFileSync(full, "utf8");
          if (text.includes("inventory-buckets")) offenders.push(full.split(path.sep).join("/"));
        }
      }
    };
    walk("src/components");
    walk("src/stores");
    expect(offenders).toEqual([]);
  });
});

// Keeps the imported type referenced so a rename of the exported type fails the build.
const _bucketType: InventoryBucket = "PHYSICAL_AVAILABLE_POLISHED";
void _bucketType;
