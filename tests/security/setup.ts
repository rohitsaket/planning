import { sectestUrl, SECTEST_DB } from "./test-db";
import { assertDisposableDatabase } from "@/lib/fantasy/database-environment";

if (!process.env.DATABASE_URL?.includes(`/${SECTEST_DB}`)) process.env.DATABASE_URL = sectestUrl();
const testDatabase = assertDisposableDatabase(process.env.DATABASE_URL, "Security tests").databaseName ?? "";
if (testDatabase !== SECTEST_DB && !testDatabase.startsWith(`${SECTEST_DB}_`)) throw new Error("refusing to run security tests outside the sectest database");
(process.env as Record<string, string>).NODE_ENV = "test";
