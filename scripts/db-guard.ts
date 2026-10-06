import { spawnSync } from "node:child_process";
import { proveDisposableDatabase } from "../src/lib/fantasy/database-environment";
import { runPrisma, type Spawn } from "./process-launch";

export interface GuardDependencies {
  readonly env: NodeJS.ProcessEnv;
  readonly spawn: Spawn;
  readonly log: (message: string) => void;
  readonly error: (message: string) => void;
}

export function guardedPrisma(operation: string, prismaArgs: readonly string[], deps: GuardDependencies): number {
  const proof = proveDisposableDatabase(deps.env.DATABASE_URL, deps.env);
  if (!proof.proven) {
    deps.error(`${operation} refused (${proof.refusal}). ${proof.message}`);
    return 3;
  }
  deps.log(`${operation}: isolated test database ${proof.databaseName} on ${proof.host}:${proof.port}.`);
  return runPrisma(prismaArgs, deps.spawn, deps.env);
}

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
