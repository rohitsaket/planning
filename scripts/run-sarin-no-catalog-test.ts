import { readdirSync } from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { assertDisposableDatabase } from "../src/lib/fantasy/database-environment";
import { launch, prismaInvocation } from "./process-launch";

const DB_NAME = "planning_sectest_nocatalog";
const CATALOG_MIGRATION = "20260929090000_sarin_effective_mapping_catalog";

function targets(): { serverUrl: string; url: string } {
  const serverUrl = process.env.SECTEST_BASE_URL || process.env.DATABASE_URL;
  if (!serverUrl || !/^postgres(ql)?:\/\//.test(serverUrl)) throw new Error("DATABASE_URL must be a PostgreSQL URL");
  const server = new URL(serverUrl);
  const target = new URL(serverUrl);
  target.pathname = `/${DB_NAME}`;
  if (!/^planning_sectest_[a-z]+$/.test(DB_NAME) || target.pathname !== `/${DB_NAME}` || target.host !== server.host || server.pathname === target.pathname) {
    throw new Error("refusing: the no-catalog database is not an isolated test database");
  }
  assertDisposableDatabase(target.toString(), "Sarin no-catalog test database");
  return { serverUrl, url: target.toString() };
}

function execute(url: string, file: string) {
  const inv = prismaInvocation(["db", "execute", "--schema", "prisma/schema.prisma", "--file", file], { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe", encoding: "utf8" });
  const r = launch(inv);
  if (r.status !== 0) throw new Error(`migration ${path.basename(path.dirname(file))} failed: ${r.stderr.replace(/postgres(ql)?:\/\/\S+/g, "<database url>").slice(0, 2000)}`);
}

async function drop(serverUrl: string) {
  const server = new PrismaClient({ datasourceUrl: serverUrl });
  try {
    await server.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${DB_NAME}" WITH (FORCE)`);
    const left = await server.$queryRaw<{ n: bigint }[]>`SELECT COUNT(*) AS n FROM pg_database WHERE datname = ${DB_NAME}`;
    if (Number(left[0].n) !== 0) throw new Error(`${DB_NAME} was not dropped`);
  } finally {
    await server.$disconnect();
  }
}

async function prepare(serverUrl: string, url: string) {
  await drop(serverUrl);
  const server = new PrismaClient({ datasourceUrl: serverUrl });
  try {
    await server.$executeRawUnsafe(`CREATE DATABASE "${DB_NAME}"`);
  } finally {
    await server.$disconnect();
  }

  const dir = path.join(process.cwd(), "prisma", "migrations");
  const migrations = readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
  if (!migrations.includes(CATALOG_MIGRATION)) throw new Error(`${CATALOG_MIGRATION} not found`);
  const target = new PrismaClient({ datasourceUrl: url });
  try {
    const [{ d }] = await target.$queryRaw<{ d: string }[]>`SELECT current_database() AS d`;
    if (d !== DB_NAME) throw new Error(`refusing to alter ${d}`);
    for (const m of migrations) {
      if (m === CATALOG_MIGRATION) await target.$executeRaw`DELETE FROM "SarinShapeMappingRule" WHERE "mappingSetId" IN (SELECT "id" FROM "SarinShapeMappingSet" WHERE "origin" = 'MIGRATION_BASELINE')`;
      execute(url, path.join(dir, m, "migration.sql"));
    }
  } finally {
    await target.$disconnect();
  }
}

async function run(url: string): Promise<boolean> {
  process.env.SECTEST_BASE_URL ??= process.env.DATABASE_URL;
  process.env.DATABASE_URL = url;
  await import("../tests/security/setup");
  const { beginModule, runRegisteredSuites } = await import("../tests/security/harness");
  beginModule();
  await import("../tests/security/sarin-no-catalog.test");
  const summary = await runRegisteredSuites(undefined);
  console.log(`RESULT: ${summary.passed} passed, ${summary.failed} failed`);
  for (const f of summary.failures) console.log(`  - ${f}`);
  const { db } = await import("../src/lib/db");
  await db.$disconnect();
  return summary.failed === 0 && summary.passed > 0;
}

async function main() {
  const { serverUrl, url } = targets();
  let ok = false;
  try {
    await prepare(serverUrl, url);
    console.log(`ready: ${DB_NAME}`);
    ok = await run(url);
  } finally {
    await drop(serverUrl);
    console.log(`dropped: ${DB_NAME}`);
  }
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error("FATAL:", e instanceof Error ? e.message : e);
  process.exit(1);
});
