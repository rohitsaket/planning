// Creates (or recreates) the throwaway security-test database next to the dev database and
// prints its NAME only. The connection string, including the password, is never printed.
// Usage: tsx --env-file-if-exists=.env scripts/sectest-db.ts [--recreate]
import { PrismaClient } from "@prisma/client";
import { sectestUrl, SECTEST_DB } from "../tests/security/test-db";
import { proveDisposableDatabase } from "../src/lib/fantasy/database-environment";

async function run() {
  // The database dropped and created is the one sectestUrl() names. Prove it is an isolated
  // test database on this machine, outside any production or staging deployment, before
  // the administrative connection even opens.
  // A URL sectestUrl() cannot rewrite is judged as given, so the refusal names what is wrong.
  let target = process.env.SECTEST_BASE_URL || process.env.DATABASE_URL;
  try {
    target = sectestUrl();
  } catch {}
  const proof = proveDisposableDatabase(target);
  if (!proof.proven || proof.databaseName !== SECTEST_DB) {
    console.error(`Test database recreation refused (${proof.refusal ?? "DATABASE_NAME_NOT_DISPOSABLE"}). ${proof.message ?? ""}`);
    process.exit(3);
  }
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
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
