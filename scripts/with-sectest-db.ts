// Runs a command with DATABASE_URL pointed at the throwaway security-test database.
// Usage: npx tsx scripts/with-sectest-db.ts <command> [args...]
import { spawnSync } from "node:child_process";
import { sectestUrl } from "../tests/security/test-db";

const [cmd, ...args] = process.argv.slice(2);
const r = spawnSync(cmd, args, { stdio: "inherit", env: { ...process.env, SECTEST_BASE_URL: process.env.DATABASE_URL, DATABASE_URL: sectestUrl() } });
process.exit(r.status ?? 1);
