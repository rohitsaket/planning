import { PrismaClient } from "@prisma/client";
import { sectestUrl, SECTEST_DB } from "../tests/security/test-db";
import { proveDisposableDatabase } from "../src/lib/fantasy/database-environment";

async function run() {
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
  new URL(sectestUrl());
  console.log(`ready: ${SECTEST_DB}`);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
