// Runs a destructive database command only after proving DATABASE_URL is an isolated test
// database: loopback host, an approved test database name, and no production or staging
// marker. The proof runs before the command starts, so a refusal happens before any
// connection, delete, truncate, schema reset or insert.
// Usage: npx tsx scripts/db-guard.ts "<operation>" -- <command> [args...]
import { spawnSync } from "node:child_process";
import { proveDisposableDatabase } from "../src/lib/fantasy/database-environment";

const separator = process.argv.indexOf("--");
const operation = process.argv[2];
const command = separator > 0 ? process.argv.slice(separator + 1) : [];
if (!operation || separator !== 3 || command.length === 0) {
  console.error('Usage: npx tsx scripts/db-guard.ts "<operation>" -- <command> [args...]');
  process.exit(2);
}

const proof = proveDisposableDatabase(process.env.DATABASE_URL);
if (!proof.proven) {
  console.error(`${operation} refused (${proof.refusal}). ${proof.message}`);
  process.exit(3);
}
console.log(`${operation}: isolated test database ${proof.databaseName} on ${proof.host}:${proof.port}.`);
// The child inherits this environment, so it targets exactly the database just proven.
const r = spawnSync(command[0], command.slice(1), { stdio: "inherit", shell: process.platform === "win32", env: process.env });
process.exit(r.status ?? 1);
