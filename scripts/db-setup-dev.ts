// Prepares a local development database without deleting or overwriting anything:
// applies pending migrations, then adds missing confirmed reference data. It loads no demo
// customers, stones, plans, demand, notifications, audit events or sync runs.
//
// Refuses a non-loopback host and any production or staging environment before it starts.
// Create the first sign-in account separately: npm run user:create.
// Usage: npm run db:setup:dev
import { spawnSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { proveLocalDatabase } from "../src/lib/fantasy/database-environment";
import { syncConfirmedReferenceData, type ReferenceSyncResult } from "../src/lib/reference-data/reference-sync";
import { runPrisma, type Spawn } from "./process-launch";

export interface SetupDependencies {
  readonly env: NodeJS.ProcessEnv;
  /** The process boundary that starts the Prisma CLI. */
  readonly spawn: Spawn;
  readonly syncReferenceData: () => Promise<ReferenceSyncResult>;
  readonly log: (message: string) => void;
  readonly error: (message: string) => void;
}

/** Runs the setup and returns the process exit code. */
export async function setupDevelopmentDatabase(deps: SetupDependencies): Promise<number> {
  const proof = proveLocalDatabase(deps.env.DATABASE_URL, deps.env);
  if (!proof.proven) {
    deps.error(`Development setup refused (${proof.refusal}). ${proof.message}`);
    return 3;
  }
  deps.log(`Development setup: ${proof.databaseName} on ${proof.host}:${proof.port}.`);

  // `migrate deploy` applies committed migrations only; it never resets or drops the database.
  const status = runPrisma(["migrate", "deploy"], deps.spawn, deps.env);
  if (status !== 0) {
    deps.error("Development setup stopped: migrations did not apply.");
    return status;
  }

  const added = await deps.syncReferenceData();
  deps.log(`Reference data: ${added.weightBands.length} weight band(s), ${added.labMappings.length} lab mapping(s), ${added.shapeMappings.length} shape mapping(s) added.`);
  deps.log("Development setup complete. No demo data was loaded. Create a sign-in account with: npm run user:create");
  return 0;
}

async function main() {
  const code = await setupDevelopmentDatabase({
    env: process.env,
    spawn: spawnSync,
    syncReferenceData: async () => {
      const db = new PrismaClient();
      try {
        return await syncConfirmedReferenceData(db, "cli");
      } finally {
        await db.$disconnect();
      }
    },
    log: (message) => console.log(message),
    error: (message) => console.error(message),
  });
  process.exit(code);
}

// Run only as a command, not when a test imports the setup.
if (require.main === module) {
  main().catch((e) => {
    console.error("Development setup failed:", e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
