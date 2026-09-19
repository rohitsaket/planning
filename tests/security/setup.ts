// Preloaded by bun test (bunfig.toml). Points Prisma at the throwaway test database and refuses
// to run against anything else.
import { sectestUrl, SECTEST_DB } from "./test-db";

if (!process.env.DATABASE_URL?.includes(`/${SECTEST_DB}`)) process.env.DATABASE_URL = sectestUrl();
if (!new URL(process.env.DATABASE_URL).pathname.startsWith(`/${SECTEST_DB}`)) throw new Error("refusing to run security tests outside the sectest database");
(process.env as Record<string, string>).NODE_ENV = "test";
