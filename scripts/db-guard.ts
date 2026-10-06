// Runs a destructive Prisma command only after proving DATABASE_URL is an isolated test
// database: loopback host, an approved test database name, and no production or staging
// marker. The proof runs before Prisma starts, so a refusal happens before any connection,
// delete, truncate, schema reset or insert. Prisma is started without a shell, with its
// arguments as separate values (see process-launch.ts).
// Usage: tsx scripts/db-guard.ts <operation> -- <prisma arguments...>
//   e.g. tsx scripts/db-guard.ts test-migrations -- migrate deploy
import { spawnSync } from "node:child_process";
import { proveDisposableDatabase } from "../src/lib/fantasy/database-environment";
import { runPrisma, type Spawn } from "./process-launch";

export interface GuardDependencies {
  readonly env: NodeJS.ProcessEnv;
  readonly spawn: Spawn;
  readonly log: (message: string) => void;
  readonly error: (message: string) => void;
}

/** Proves the target, then runs Prisma with these arguments; returns the exit code. */
export function guardedPrisma(operation: string, prismaArgs: readonly string[], deps: GuardDependencies): number {
  const proof = proveDisposableDatabase(deps.env.DATABASE_URL, deps.env);
  if (!proof.proven) {
    deps.error(`${operation} refused (${proof.refusal}). ${proof.message}`);
    return 3;
  }
  deps.log(`${operation}: isolated test database ${proof.databaseName} on ${proof.host}:${proof.port}.`);
  // The child receives this environment, so it targets exactly the database just proven.
  return runPrisma(prismaArgs, deps.spawn, deps.env);
}

/** Parses `<operation> -- <prisma arguments...>`; null when the shape is wrong. */
export function parseGuardArgs(argv: readonly string[]): { operation: string; prismaArgs: string[] } | null {
  const separator = argv.indexOf("--");
  if (separator !== 1 || !argv[0] || argv.length < 3) return null;
  return { operation: argv[0], prismaArgs: argv.slice(2) };
}

if (require.main === module) {
  const parsed = parseGuardArgs(process.argv.slice(2));
  if (!parsed) {
    console.error("Usage: tsx scripts/db-guard.ts <operation> -- <prisma arguments...>");
    process.exit(2);
  }
  process.exit(
    guardedPrisma(parsed.operation, parsed.prismaArgs, {
      env: process.env,
      spawn: spawnSync,
      log: (m) => console.log(m),
      error: (m) => console.error(m),
    }),
  );
}
