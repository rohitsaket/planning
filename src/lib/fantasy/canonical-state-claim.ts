import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { resolveNumericEnv } from "@/lib/config/numeric-env";

if (typeof window !== "undefined") {
  throw new Error("fantasy/canonical-state-claim is server-only and must not be imported by client code.");
}

type DbClient = typeof db;

export const CANONICAL_STATE_ID = "FANTASY_CANONICAL_STATE";

export const CLAIM_HOLDERS = ["SYNC", "DEMAND"] as const;
export type ClaimHolder = (typeof CLAIM_HOLDERS)[number];

export const CANONICAL_CLAIM_LEASE_MS = resolveNumericEnv(
  "FANTASY_CANONICAL_CLAIM_LEASE_MS",
  { fallback: 15 * 60_000, max: 24 * 60 * 60_000 },
).value;

export interface CanonicalClaim {
  readonly holder: ClaimHolder;
  readonly ownerToken: string;
  readonly fencingVersion: number;
  readonly expiresAt: Date;
}

export type ClaimResult =
  | { readonly acquired: true; readonly claim: CanonicalClaim }
  | { readonly acquired: false; readonly heldBy: ClaimHolder; readonly reason: string };

export const CLAIM_BUSY_MESSAGES: Record<ClaimHolder, string> = {
  SYNC: "The Fantasy source is being updated. Wait for the synchronization to finish, then try again.",
  DEMAND: "A demand calculation is using the current Fantasy snapshot. Wait for it to finish, then try again.",
};

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

  const held = await client.canonicalStateClaim.findUniqueOrThrow({
    where: { id: CANONICAL_STATE_ID },
    select: { fencingVersion: true },
  });

  return { acquired: true, claim: { holder, ownerToken, fencingVersion: held.fencingVersion, expiresAt } };
}

export async function isClaimStillHeld(claim: CanonicalClaim, client: DbClient = db): Promise<boolean> {
  const row = await client.canonicalStateClaim.findUnique({
    where: { id: CANONICAL_STATE_ID },
    select: { ownerToken: true, fencingVersion: true },
  });
  return row?.ownerToken === claim.ownerToken && row.fencingVersion === claim.fencingVersion;
}

export async function releaseCanonicalState(claim: CanonicalClaim, client: DbClient = db): Promise<boolean> {
  const released = await client.canonicalStateClaim.updateMany({
    where: { id: CANONICAL_STATE_ID, ownerToken: claim.ownerToken },
    data: { holder: null, ownerToken: null, claimedBy: null, claimedAt: null, expiresAt: null },
  });
  return released.count > 0;
}

export interface ForcedReleaseResult {
  readonly released: boolean;
  readonly forcedActiveClaim: boolean;
  readonly previousHolder: ClaimHolder | null;
  readonly previousClaimedBy: string | null;
}

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

export class CanonicalStateBusyError extends Error {
  constructor(public readonly heldBy: ClaimHolder) {
    super(CLAIM_BUSY_MESSAGES[heldBy]);
    this.name = "CanonicalStateBusyError";
  }
}

export class CanonicalStateFencedError extends Error {
  constructor() {
    super(
      "This operation lost its claim on the Fantasy snapshot before it could finish, so its result was discarded. Run it again.",
    );
    this.name = "CanonicalStateFencedError";
  }
}
