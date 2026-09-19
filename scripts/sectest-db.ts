// Creates (or recreates) the throwaway security-test database next to the dev database and
// prints its NAME only. The connection string, including the password, is never printed.
// Usage: bun scripts/sectest-db.ts [--recreate]
import { PrismaClient } from "@prisma/client";
import { sectestUrl, SECTEST_DB } from "../tests/security/test-db";

const admin = new PrismaClient();
const exists = await admin.$queryRawUnsafe<{ n: bigint }[]>(`SELECT COUNT(*) AS n FROM pg_database WHERE datname = '${SECTEST_DB}'`);
let found = Number(exists[0].n) > 0;
if (found && process.argv.includes("--recreate")) {
  await admin.$executeRawUnsafe(`DROP DATABASE "${SECTEST_DB}" WITH (FORCE)`);
  found = false;
}
if (!found) await admin.$executeRawUnsafe(`CREATE DATABASE "${SECTEST_DB}"`);
await admin.$disconnect();
new URL(sectestUrl()); // validates
console.log(`ready: ${SECTEST_DB}`);
