// Preloaded by bun test (bunfig.toml). Points Prisma at the throwaway test database and refuses
// to run against anything else.
import { sectestUrl, SECTEST_DB } from "./test-db";
import { assertDisposableDatabase } from "@/lib/fantasy/database-environment";

if (!process.env.DATABASE_URL?.includes(`/${SECTEST_DB}`)) process.env.DATABASE_URL = sectestUrl();
// Loopback host, an approved isolated test database, no production or staging marker — and
// that database is the security-test database or one of its approved throwaway siblings
// (planning_sectest_nocatalog, used by scripts/run-sarin-no-catalog-test.ts).
const testDatabase = assertDisposableDatabase(process.env.DATABASE_URL, "Security tests").databaseName ?? "";
if (testDatabase !== SECTEST_DB && !testDatabase.startsWith(`${SECTEST_DB}_`)) throw new Error("refusing to run security tests outside the sectest database");
(process.env as Record<string, string>).NODE_ENV = "test";
