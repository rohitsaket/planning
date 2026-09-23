/**
 * MUTUAL EXCLUSION OVER THE CANONICAL FANTASY RECORDS.
 *
 * Synchronization guarded its own operation with a sync lock; the demand calculation
 * guarded its own with a demand lock. Neither knew about the other, so a synchronization
 * could commit batch N+1 while a demand run was part-way through reading the rows it was
 * changing — producing one calculation whose sales came from before the batch and whose
 * inventory came from after it. Nothing in the result would have looked wrong.
 *
 * Both operations now claim this one row. It is the only place that exclusion can be
 * decided atomically across processes, which is the point: a check followed by a later
 * claim is two statements, and two statements are a race.
 *
 * Why serialization rather than versioned reads. An as-of snapshot would let the two run
 * concurrently, but it needs every canonical row to be addressable at a version. Only the
 * rows a batch touched carry that batch's id and checkpoint; an unchanged row still
 * carries whichever batch last moved it. So "every row as of checkpoint N" is not
 * expressible against this schema, and pretending `lastSyncBatchId` provides it would
 * produce exactly the mixed-state result this module exists to prevent.
 *
 * Server-only.
 */

import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";

if (typeof window !== "undefined") {
  throw new Error("fantasy/canonical-state-claim is server-only and must not be imported by client code.");
}

type DbClient = typeof db;

/** The singleton row. One canonical state, one claim. */
export const CANONICAL_STATE_ID = "FANTASY_CANONICAL_STATE";

export const CLAIM_HOLDERS = ["SYNC", "DEMAND"] as const;
export type ClaimHolder = (typeof CLAIM_HOLDERS)[number];

/**
 * How long a claim is honoured.
 *
 * Long enough that a healthy batch or calculation finishes well inside it, short enough
 * that a crashed worker does not block the other operation until someone intervenes.
 * Reclaiming an expired claim is safe because both operations commit transactionally: an
 * abandoned one wrote everything or nothing.
 */
export const CANONICAL_CLAIM_LEASE_MS = Number(process.env.FANTASY_CANONICAL_CLAIM_LEASE_MS || 15 * 60_000);

export interface CanonicalClaim {
  readonly holder: ClaimHolder;
  readonly ownerToken: string;
  /**
   * The claim generation. Recorded by the holder and re-checked before it finalizes, so
   * a worker whose claim was force-released cannot afterwards advance a checkpoint or
   * mark its run successful — even though it still holds its own token.
   */
  readonly fencingVersion: number;
  readonly expiresAt: Date;
}

export type ClaimResult =
  | { readonly acquired: true; readonly claim: CanonicalClaim }
  | { readonly acquired: false; readonly heldBy: ClaimHolder; readonly reason: string };

/** What a caller may be told when the claim is busy. No token, no row id, no SQL. */
export const CLAIM_BUSY_MESSAGES: Record<ClaimHolder, string> = {
  SYNC: "The Fantasy source is being updated. Wait for the synchronization to finish, then try again.",
  DEMAND: "A demand calculation is using the current Fantasy snapshot. Wait for it to finish, then try again.",
};

/**
 * Claims the canonical state, or reports who holds it.
 *
 * One conditional `updateMany` decides it. The row is free when nobody holds it or when
 * the holder's lease has run out, and both cases are evaluated by the database inside the
 * same statement, so two workers cannot both win.
 */
export async function claimCanonicalState(
  holder: ClaimHolder,
  actor: string,
  client: DbClient = db,
  leaseMs: number = CANONICAL_CLAIM_LEASE_MS,
): Promise<ClaimResult> {
  const now = new Date();
  const ownerToken = randomUUID();
  const expiresAt = new Date(now.getTime() + leaseMs);

  const claimed = await client.canonicalStateClaim.updateMany({
    where: {
      id: CANONICAL_STATE_ID,
      OR: [{ holder: null }, { expiresAt: { lt: now } }],
    },
    data: {
      holder,
      ownerToken,
      claimedBy: actor,
      claimedAt: now,
      expiresAt,
      // Every claim is a new generation, so a displaced worker's recorded version is
      // stale the moment anyone else claims.
      fencingVersion: { increment: 1 },
    },
  });

  if (claimed.count === 0) {
    const current = await client.canonicalStateClaim.findUnique({
      where: { id: CANONICAL_STATE_ID },
      select: { holder: true },
    });
    const heldBy: ClaimHolder = current?.holder === "DEMAND" ? "DEMAND" : "SYNC";
    return { acquired: false, heldBy, reason: CLAIM_BUSY_MESSAGES[heldBy] };
  }

  // Read back the generation this claim was given. Safe to read after the fact: the row
  // is ours until the lease expires, and only a forced release can change it — which is
  // precisely what the fencing check is for.
  const held = await client.canonicalStateClaim.findUniqueOrThrow({
    where: { id: CANONICAL_STATE_ID },
    select: { fencingVersion: true },
  });

  return { acquired: true, claim: { holder, ownerToken, fencingVersion: held.fencingVersion, expiresAt } };
}

/**
 * Whether this claim is still the one in force.
 *
 * Called before anything irreversible — advancing a checkpoint, marking a run successful.
 * Both the token and the generation must match: the token proves it is our claim, and the
 * generation proves nobody has broken and re-issued it since.
 */
export async function isClaimStillHeld(claim: CanonicalClaim, client: DbClient = db): Promise<boolean> {
  const row = await client.canonicalStateClaim.findUnique({
    where: { id: CANONICAL_STATE_ID },
    select: { ownerToken: true, fencingVersion: true },
  });
  return row?.ownerToken === claim.ownerToken && row.fencingVersion === claim.fencingVersion;
}

/**
 * Releases a claim, and only that claim.
 *
 * The token is matched inside the same statement that clears the row, so there is no
 * window between checking ownership and releasing in which another worker could claim it.
 * Returns false when the claim was already broken, which the caller reports rather than
 * treating as success.
 */
export async function releaseCanonicalState(claim: CanonicalClaim, client: DbClient = db): Promise<boolean> {
  const released = await client.canonicalStateClaim.updateMany({
    where: { id: CANONICAL_STATE_ID, ownerToken: claim.ownerToken },
    data: { holder: null, ownerToken: null, claimedBy: null, claimedAt: null, expiresAt: null },
  });
  return released.count > 0;
}

export interface ForcedReleaseResult {
  readonly released: boolean;
  /** Whether a live, unexpired claim was broken, as opposed to a stale one cleared. */
  readonly forcedActiveClaim: boolean;
  readonly previousHolder: ClaimHolder | null;
  /** Who held it, for the audit record. Never a token. */
  readonly previousClaimedBy: string | null;
}

/**
 * Administrative recovery: clears whatever claim is in force.
 *
 * Deliberately not refusable — a genuinely stuck claim must be clearable — but it
 * increments the generation, which fences the displaced worker: its next ownership check
 * fails, so it cannot advance a checkpoint or mark itself successful afterwards.
 *
 * The caller is responsible for the permission decision and the audit record; this
 * function returns what the audit needs and no more.
 */
export async function forceReleaseCanonicalState(
  actor: string,
  client: DbClient = db,
): Promise<ForcedReleaseResult> {
  const current = await client.canonicalStateClaim.findUnique({
    where: { id: CANONICAL_STATE_ID },
    select: { holder: true, claimedBy: true, expiresAt: true },
  });

  if (!current?.holder) {
    return { released: false, forcedActiveClaim: false, previousHolder: null, previousClaimedBy: null };
  }

  const now = new Date();
  const forcedActiveClaim = current.expiresAt !== null && current.expiresAt > now;

  await client.canonicalStateClaim.update({
    where: { id: CANONICAL_STATE_ID },
    data: {
      holder: null,
      ownerToken: null,
      claimedBy: null,
      claimedAt: null,
      expiresAt: null,
      fencingVersion: { increment: 1 },
      lastForcedBy: actor,
      lastForcedAt: now,
    },
  });

  return {
    released: true,
    forcedActiveClaim,
    previousHolder: current.holder === "DEMAND" ? "DEMAND" : "SYNC",
    previousClaimedBy: current.claimedBy,
  };
}

/** Raised when a claim could not be taken. Carries no token and no row detail. */
export class CanonicalStateBusyError extends Error {
  constructor(public readonly heldBy: ClaimHolder) {
    super(CLAIM_BUSY_MESSAGES[heldBy]);
    this.name = "CanonicalStateBusyError";
  }
}

/** Raised when a claim was broken underneath its holder. */
export class CanonicalStateFencedError extends Error {
  constructor() {
    super(
      "This operation lost its claim on the Fantasy snapshot before it could finish, so its result was discarded. Run it again.",
    );
    this.name = "CanonicalStateFencedError";
  }
}
