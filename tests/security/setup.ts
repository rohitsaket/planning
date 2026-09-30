// Preloaded by bun test (bunfig.toml). Points Prisma at the throwaway test database and refuses
// to run against anything else.
import { sectestUrl, SECTEST_DB } from "./test-db";
import { assertDisposableDatabase } from "@/lib/fantasy/database-environment";

if (!process.env.DATABASE_URL?.includes(`/${SECTEST_DB}`)) process.env.DATABASE_URL = sectestUrl();
// Loopback host, an approved isolated test database, no production or staging marker.
if (assertDisposableDatabase(process.env.DATABASE_URL, "Security tests").databaseName !== SECTEST_DB) throw new Error("refusing to run security tests outside the sectest database");
(process.env as Record<string, string>).NODE_ENV = "test";
