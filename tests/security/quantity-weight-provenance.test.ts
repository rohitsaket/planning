import { beforeAll, describe, expect, test } from "./harness";
import { call, db, makeUser, resetDb } from "./helpers";
import { resetRateLimits } from "@/lib/api/rate-limit";
import { POST as fantasySync } from "@/app/api/fantasy/sync/route";
import { POST as fantasyUnlock } from "@/app/api/fantasy/sync/unlock/route";
import { POST as demandRun } from "@/app/api/demand/run/route";
import { ROLE_PERMISSIONS } from "@/lib/auth/permissions";
import { SYNC_LOCK_LEASE_MS, releaseSyncLock, unlockSynchronization } from "@/lib/fantasy/sync-service";
import {
  QUANTITY_REVIEW_REASONS,
  WEIGHT_REVIEW_REASONS,
  isCountableQuantity,
  resolveCanonicalQuantity,
  resolveCanonicalWeight,
} from "@/lib/fantasy/quantity-weight";
import { resolveQuantityProvenance } from "@/lib/demand/confirmed-sales";

/**
 * Quantity and weight provenance.
 *
 * The rule under test is that nothing is assumed. A quantity the source never supplied
 * is not one piece; a weight whose unit nobody confirmed cannot choose a weight band.
 * Before this, the inventory path did `Number(quantity) > 0 ? Number(quantity) : 1`,
 * which turned every missing, zero, negative and malformed value into a confirmed piece
 * of available stock — while the sales path correctly excluded the same record.
 *
 * The decision is shared, so the last test here is the one that matters most: inventory
 * and confirmed sales must reach the same verdict for the same record.
 */

const FIXTURE = { sourceType: "FIXTURE", isSimulated: true };
const LIVE = { sourceType: "FANTASY_API", isSimulated: false };

describe("quantity provenance", () => {
  test("a fixture record with an explicit positive quantity is countable", () => {
    const d = resolveCanonicalQuantity({ ...FIXTURE, quantity: 3 });
    expect({ provenance: d.provenance, pieces: d.pieces }).toEqual({ provenance: "EXPLICIT_FIXTURE", pieces: 3 });
    expect(isCountableQuantity(d.provenance)).toBe(true);
  });

  test("a live record is refused while its quantity semantics are unconfirmed", () => {
    const d = resolveCanonicalQuantity({ ...LIVE, quantity: 4 });
    expect({ provenance: d.provenance, pieces: d.pieces }).toEqual({
      provenance: "SEMANTICS_NOT_CONFIGURED",
      pieces: null,
    });
    // The value itself is preserved, so the record stays explainable.
    expect(d.rawValue).toBe(4);
    expect(isCountableQuantity(d.provenance)).toBe(false);
  });

  test("a live record under an explicitly confirmed contract is countable", () => {
    // A row that recorded its provenance at ingestion is trusted over any inference.
    const d = resolveCanonicalQuantity({ ...LIVE, quantity: 4, quantityProvenance: "LIVE_CONFIRMED" });
    expect({ provenance: d.provenance, pieces: d.pieces }).toEqual({ provenance: "LIVE_CONFIRMED", pieces: 4 });
  });

  test("nothing becomes one piece", () => {
    const cases: Array<[string, unknown, string]> = [
      ["null", null, "MISSING"],
      ["undefined", undefined, "MISSING"],
      ["empty string", "", "MISSING"],
      ["zero", 0, "UNSUPPORTED"],
      ["negative", -2, "INVALID"],
      ["decimal", 1.5, "UNSUPPORTED"],
      ["malformed text", "one", "INVALID"],
      ["excessive", 5_000_000_000, "INVALID"],
      ["boolean", true, "INVALID"],
      ["NaN", Number.NaN, "INVALID"],
    ];
    for (const [label, quantity, expected] of cases) {
      const d = resolveCanonicalQuantity({ ...FIXTURE, quantity });
      expect({ label, provenance: d.provenance, pieces: d.pieces }).toEqual({
        label,
        provenance: expected,
        pieces: null,
      });
    }
  });

  test("a confirmed one is distinguishable from a legacy defaulted one", () => {
    // Same stored number, different recorded origin, different verdict.
    const confirmed = resolveCanonicalQuantity({ ...FIXTURE, quantity: 1, quantityProvenance: "EXPLICIT_FIXTURE" });
    const legacy = resolveCanonicalQuantity({ ...LIVE, quantity: 1, quantityProvenance: "LEGACY_DEFAULT_AMBIGUOUS" });
    expect(confirmed.pieces).toBe(1);
    expect(legacy.pieces).toBe(null);
    expect(legacy.provenance).toBe("LEGACY_DEFAULT_AMBIGUOUS");
  });

  test("a Prisma Decimal is read, not rejected as non-numeric", async () => {
    // Every canonical quantity column returns Decimal. A decision that could not read it
    // would silently zero real quantities across the whole pipeline.
    const { Prisma } = await import("@prisma/client");
    const d = resolveCanonicalQuantity({ ...FIXTURE, quantity: new Prisma.Decimal(7) });
    expect({ provenance: d.provenance, pieces: d.pieces }).toEqual({ provenance: "EXPLICIT_FIXTURE", pieces: 7 });
  });

  test("every provenance has business wording, and no internal key is user-facing", () => {
    for (const [code, text] of Object.entries(QUANTITY_REVIEW_REASONS)) {
      expect(text.length > 0).toBe(true);
      expect(text.includes(code)).toBe(false);
      expect(text.includes("_")).toBe(false);
    }
  });
});

describe("weight provenance", () => {
  test("a fixture weight is usable as carats", () => {
    const d = resolveCanonicalWeight({ ...FIXTURE, weight: 1.25 });
    expect({ state: d.state, carats: d.carats }).toEqual({ state: "USABLE", carats: 1.25 });
  });

  test("a live weight cannot choose a weight band while its unit is unconfirmed", () => {
    const d = resolveCanonicalWeight({ ...LIVE, weight: 1.25 });
    expect({ state: d.state, carats: d.carats }).toEqual({ state: "UNIT_NOT_CONFIGURED", carats: null });
    // Preserved, so the record is still explainable.
    expect(d.rawValue).toBe(1.25);
  });

  test("missing and invalid weights are refused rather than defaulted", () => {
    for (const [weight, expected] of [[null, "MISSING"], ["", "MISSING"], ["heavy", "INVALID"], [-1, "INVALID"], [0, "INVALID"]] as const) {
      const d = resolveCanonicalWeight({ ...FIXTURE, weight });
      expect({ weight: String(weight), state: d.state, carats: d.carats }).toEqual({
        weight: String(weight),
        state: expected,
        carats: null,
      });
    }
  });

  test("every weight review reason is business wording", () => {
    for (const [code, text] of Object.entries(WEIGHT_REVIEW_REASONS)) {
      expect(text.includes(code)).toBe(false);
      expect(text.includes("_")).toBe(false);
    }
  });
});

describe("one rule, expressed at two granularities", () => {
  test("the source-level question is whether this source may be counted at all", () => {
    // Deliberately independent of any particular value: it describes the source.
    expect(resolveQuantityProvenance({ sourceType: "FIXTURE", isSimulated: true })).toBe("EXPLICIT_FIXTURE");
    expect(resolveQuantityProvenance({ sourceType: "FANTASY_API", isSimulated: false })).toBe("UNCONFIRMED");
    expect(resolveQuantityProvenance({ sourceType: null, isSimulated: true })).toBe("UNCONFIRMED");
  });

  test("a source that may not be counted can never make a record countable", () => {
    // The invariant that matters: no value, however well-formed, promotes an
    // unconfirmed source into confirmed pieces.
    for (const quantity of [1, 2, 99, "3", null, 0, -1, 1.5]) {
      const d = resolveCanonicalQuantity({ ...LIVE, quantity });
      expect({ quantity: String(quantity), countable: isCountableQuantity(d.provenance) }).toEqual({
        quantity: String(quantity),
        countable: false,
      });
    }
  });

  test("a countable source still refuses a value it cannot read", () => {
    // And the reverse: an approved source does not make a bad value good.
    for (const quantity of [null, 0, -1, 1.5, "one"]) {
      const d = resolveCanonicalQuantity({ ...FIXTURE, quantity });
      expect({ quantity: String(quantity), countable: isCountableQuantity(d.provenance) }).toEqual({
        quantity: String(quantity),
        countable: false,
      });
    }
  });
});

describe("persisted provenance", () => {
  beforeAll(async () => {
    await resetDb();
  });

  test("the canonical tables carry provenance columns and default them to unknown", async () => {
    const lotId = `QWP-${Date.now()}`;
    const created = await db.lotMasterRecord.create({
      data: {
        lotId, currentStatus: "STOCK", statusEffectiveDate: new Date(), docDate: new Date(),
        shape: "ROUND", weight: 1.2, country: "IN", branch: "SRT",
        lastSyncBatchId: "QWP", quantity: 1,
      },
      select: { quantity: true, quantityProvenance: true, confirmedPieces: true, sourceType: true, isSimulated: true },
    });

    // The column default wrote 1, and nothing recorded where it came from.
    expect(created.quantityProvenance).toBe(null);
    expect(created.confirmedPieces).toBe(null);

    // And this is exactly why recording provenance at ingestion matters: `sourceType`
    // defaults to "FIXTURE" and `isSimulated` to true, so a row nobody ingested still
    // *looks* like approved fixture data to any check that reads only those columns.
    expect({ sourceType: created.sourceType, isSimulated: created.isSimulated }).toEqual({
      sourceType: "FIXTURE",
      isSimulated: true,
    });
    const inferred = resolveCanonicalQuantity({
      quantity: created.quantity,
      sourceType: created.sourceType,
      isSimulated: created.isSimulated,
      quantityProvenance: created.quantityProvenance,
    });
    expect(isCountableQuantity(inferred.provenance)).toBe(true);

    // A row that recorded its own provenance is not countable, whatever the defaults say.
    await db.lotMasterRecord.update({
      where: { lotId },
      data: { quantityProvenance: "LEGACY_DEFAULT_AMBIGUOUS", confirmedPieces: null },
    });
    const stored = await db.lotMasterRecord.findUniqueOrThrow({
      where: { lotId },
      select: { quantity: true, quantityProvenance: true, sourceType: true, isSimulated: true },
    });
    const recorded = resolveCanonicalQuantity({
      quantity: stored.quantity,
      sourceType: stored.sourceType,
      isSimulated: stored.isSimulated,
      quantityProvenance: stored.quantityProvenance,
    });
    expect({ provenance: recorded.provenance, countable: isCountableQuantity(recorded.provenance) }).toEqual({
      provenance: "LEGACY_DEFAULT_AMBIGUOUS",
      countable: false,
    });

    await db.lotMasterRecord.delete({ where: { lotId } });
  });
});

describe("operational actions are assigned, not inherited from administration", () => {
  const OPERATIONAL = ["fantasy.sync.run", "fantasy.sync.retry", "fantasy.sync.unlock", "demand.run", "demand.unlock"] as const;

  test("an ordinary administrator holds none of them by default", () => {
    for (const p of OPERATIONAL) {
      expect({ p, admin: ROLE_PERMISSIONS.ADMIN.includes(p) }).toEqual({ p, admin: false });
    }
  });

  test("the roles whose job it is still hold them, so the check above is not vacuous", () => {
    expect(ROLE_PERMISSIONS.FANTASY_INTEGRATION.includes("fantasy.sync.run")).toBe(true);
    expect(ROLE_PERMISSIONS.FANTASY_INTEGRATION.includes("fantasy.sync.retry")).toBe(true);
    expect(ROLE_PERMISSIONS.ANALYSIS_MANAGER.includes("demand.run")).toBe(true);
  });

  test("unlock stays separately assignable, granted to neither operator role", () => {
    expect(ROLE_PERMISSIONS.FANTASY_INTEGRATION.includes("fantasy.sync.unlock")).toBe(false);
    expect(ROLE_PERMISSIONS.ANALYSIS_MANAGER.includes("demand.unlock")).toBe(false);
  });

  test("the boundary is enforced at the route, not only in the role table", async () => {
    await resetDb();
    resetRateLimits();
    const admin = (await makeUser("ops.admin", "ADMIN")).cookie;
    const origin = { origin: "http://localhost:3000" };

    for (const [label, handler] of [
      ["sync", fantasySync],
      ["unlock", fantasyUnlock],
      ["demand run", demandRun],
    ] as const) {
      resetRateLimits();
      const res = await call(handler, { method: "POST", path: "/api/x", cookie: admin, body: {}, headers: origin });
      expect({ label, status: res.status }).toEqual({ label, status: 403 });
    }
  });

  test("an authorized operator is not blocked by the same boundary", async () => {
    resetRateLimits();
    const operator = (await makeUser("ops.integration", "FANTASY_INTEGRATION")).cookie;
    const res = await call(fantasySync, {
      method: "POST", path: "/api/fantasy/sync", cookie: operator, body: {},
      headers: { origin: "http://localhost:3000" },
    });
    // Authorized: whatever the source state decides, it is not a permission refusal.
    expect([401, 403].includes(res.status)).toBe(false);
  });
});

describe("synchronization lock ownership", () => {
  beforeAll(async () => {
    await db.syncCheckpoint.upsert({
      where: { source: "FANTASY" },
      create: { source: "FANTASY", currentCheckpoint: 0, isLocked: false },
      update: { isLocked: false, lockToken: null, lockExpiresAt: null },
    });
  });

  async function claim(token: string, expiresInMs = SYNC_LOCK_LEASE_MS) {
    const now = new Date();
    return db.syncCheckpoint.updateMany({
      where: { source: "FANTASY", OR: [{ isLocked: false }, { lockExpiresAt: { lt: now } }] },
      data: {
        isLocked: true, lockedAt: now, lockedBy: "worker",
        lockToken: token, lockExpiresAt: new Date(now.getTime() + expiresInMs),
      },
    });
  }

  test("only one worker wins a free lock", async () => {
    await db.syncCheckpoint.update({
      where: { source: "FANTASY" },
      data: { isLocked: false, lockToken: null, lockExpiresAt: null },
    });
    // Genuinely overlapping claims against the same row.
    const [a, b] = await Promise.all([claim("token-a"), claim("token-b")]);
    expect(a.count + b.count).toBe(1);
  });

  test("a wrong token cannot release another worker's lock", async () => {
    const held = await db.syncCheckpoint.findUniqueOrThrow({ where: { source: "FANTASY" } });
    expect(held.isLocked).toBe(true);

    expect(await releaseSyncLock("not-the-owner")).toBe(false);
    const stillHeld = await db.syncCheckpoint.findUniqueOrThrow({ where: { source: "FANTASY" } });
    expect({ locked: stillHeld.isLocked, token: stillHeld.lockToken }).toEqual({
      locked: true,
      token: held.lockToken,
    });
  });

  test("the owning token releases its own lock", async () => {
    const held = await db.syncCheckpoint.findUniqueOrThrow({ where: { source: "FANTASY" } });
    expect(await releaseSyncLock(held.lockToken!)).toBe(true);
    const freed = await db.syncCheckpoint.findUniqueOrThrow({ where: { source: "FANTASY" } });
    expect({ locked: freed.isLocked, token: freed.lockToken }).toEqual({ locked: false, token: null });
  });

  test("an expired lease is reclaimable without a manual unlock", async () => {
    await claim("stale-token", -1_000);
    const reclaimed = await claim("fresh-token");
    expect(reclaimed.count).toBe(1);
    const held = await db.syncCheckpoint.findUniqueOrThrow({ where: { source: "FANTASY" } });
    expect(held.lockToken).toBe("fresh-token");
    expect(await releaseSyncLock("fresh-token")).toBe(true);
  });

  test("an authorized unlock still clears a live lease, and says that it did", async () => {
    await claim("live-token");
    // The recovery path is deliberately not refusable — a stuck lock must be clearable —
    // but it reports that it broke active work rather than looking like routine cleanup.
    const res = await unlockSynchronization("ADMIN_TEST", "recovery", { ownerToken: null });
    expect({ success: res.success, forced: res.forcedActiveLease }).toEqual({ success: true, forced: true });

    const freed = await db.syncCheckpoint.findUniqueOrThrow({ where: { source: "FANTASY" } });
    expect({ locked: freed.isLocked, token: freed.lockToken }).toEqual({ locked: false, token: null });
  });

  test("clearing a lock the caller owns is not reported as forced", async () => {
    await claim("mine");
    const res = await unlockSynchronization("worker", "done", { ownerToken: "mine" });
    expect({ success: res.success, forced: res.forcedActiveLease }).toEqual({ success: true, forced: false });
  });
});
