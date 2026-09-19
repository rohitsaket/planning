// Run before `prisma migrate deploy`: reports rows that would violate the new unique indexes.
// Usage: DATABASE_URL=postgresql://... bun scripts/check-migration-preconditions.ts
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const dupVersions = await db.$queryRaw<{ planningCaseId: string; versionNumber: number; n: bigint }[]>`
  SELECT "planningCaseId", "versionNumber", COUNT(*) AS n FROM "PlanVersion" GROUP BY 1, 2 HAVING COUNT(*) > 1`;
const dupReservations = await db.$queryRaw<{ roughId: string; n: bigint }[]>`
  SELECT "roughId", COUNT(*) AS n FROM "RoughReservation"
  WHERE "status" IN ('RESERVED', 'SOFT_RESERVED') AND "releasedAt" IS NULL GROUP BY 1 HAVING COUNT(*) > 1`;

for (const d of dupVersions) console.log(`DUPLICATE VERSION  case=${d.planningCaseId} version=${d.versionNumber} rows=${d.n}`);
for (const d of dupReservations) console.log(`DOUBLE RESERVATION rough=${d.roughId} active=${d.n}`);
if (dupVersions.length || dupReservations.length) {
  console.log("\nResolve before migrating: renumber the later duplicate versions (keep createdAt order) and release all but the");
  console.log("earliest active reservation per rough (set status='RELEASED', releasedAt=now). Both need a business decision.");
  process.exit(1);
}
console.log("OK: no conflicting rows. Safe to run the migration.");
