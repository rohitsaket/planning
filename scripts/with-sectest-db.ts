// Runs a TypeScript script with DATABASE_URL pointed at the throwaway security-test database.
// The script is started by the project's tsx without a shell (see process-launch.ts); the
// original URL travels to it in SECTEST_BASE_URL, in the environment only.
// Usage: tsx --env-file-if-exists=.env scripts/with-sectest-db.ts <script.ts> [args...]
import { spawnSync } from "node:child_process";
import { sectestUrl } from "../tests/security/test-db";
import { launch, tsxInvocation, type Invocation } from "./process-launch";

/** The invocation that runs `script` against the security-test database. */
export function sectestInvocation(argv: readonly string[], env: NodeJS.ProcessEnv): Invocation | null {
  const [script, ...args] = argv;
  if (!script || !/\.m?ts$/.test(script)) return null;
  // sectestUrl() reads the process environment; it names only the rewritten database.
  const target = sectestUrl();
  return tsxInvocation(script, args, { env: { ...env, SECTEST_BASE_URL: env.DATABASE_URL, DATABASE_URL: target } });
}

if (require.main === module) {
  let inv: Invocation | null;
  try {
    inv = sectestInvocation(process.argv.slice(2), process.env);
  } catch (e) {
    console.error(`with-sectest-db refused: ${e instanceof Error ? e.message : "the database URL could not be rewritten"}`);
    process.exit(2);
  }
  if (!inv) {
    console.error("Usage: tsx scripts/with-sectest-db.ts <script.ts> [args...]");
    process.exit(2);
  }
  const r = launch(inv, spawnSync);
  if (r.stderr) console.error(r.stderr);
  process.exit(r.status);
}
