/**
 * DATABASE ENVIRONMENT PROOF.
 *
 * Destructive local tooling — the seed, the Analysis Review fixture loader, the fixture
 * cleanup — must be able to prove it is pointed at a local development or disposable
 * review database. Not "does not look like production": that is an absence of evidence,
 * and the previous check accepted any URL whose database name happened to contain
 * `planning_sectest`, so `postgres://user@db.internal.corp:5432/planning_sectest` passed
 * as local.
 *
 * So this parses the URL and checks each part separately, and requires positive proof:
 *
 *   - the host must be a loopback address, and
 *   - the database name must be one of the recognised local or disposable names.
 *
 * Anything it cannot parse, or cannot place, is refused. A tool that cannot prove where
 * it is does not get to delete anything.
 *
 * Server-only. The URL is parsed here and never logged, echoed or returned.
 */

if (typeof window !== "undefined") {
  throw new Error("fantasy/database-environment is server-only and must not be imported by client code.");
}

/** Hosts that are the machine running the process. Nothing else counts as local. */
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0"]);

/**
 * Database names this tooling may write to.
 *
 * `planning` is the local development database; `planning_sectest` is the disposable
 * isolated suite database. A name outside this set is refused even on a loopback host,
 * so a second database on the same machine cannot be reset by accident.
 */
export const DISPOSABLE_DATABASE_NAMES = new Set(["planning", "planning_sectest", "planning_review"]);

export const ENVIRONMENT_REFUSALS = [
  "URL_MISSING",
  "URL_UNPARSEABLE",
  "PROTOCOL_NOT_POSTGRES",
  "HOST_NOT_LOOPBACK",
  "DATABASE_NAME_NOT_DISPOSABLE",
] as const;
export type EnvironmentRefusal = (typeof ENVIRONMENT_REFUSALS)[number];

export interface DatabaseEnvironmentProof {
  readonly proven: boolean;
  readonly refusal: EnvironmentRefusal | null;
  /** Host and database name only. Never the user, password, or query string. */
  readonly host: string | null;
  readonly port: number | null;
  readonly databaseName: string | null;
  /** Safe to show an operator: names what was wrong, never the connection string. */
  readonly message: string | null;
}

/**
 * Proves — or refuses to prove — that a connection string points at a local or
 * disposable database.
 *
 * Every part is checked separately: protocol, host, port and database name. A previous
 * version searched the whole string for substrings, which is why a remote host with a
 * familiar-looking database name passed.
 */
export function proveDisposableDatabase(databaseUrl: string | undefined | null): DatabaseEnvironmentProof {
  const fail = (refusal: EnvironmentRefusal, message: string, parts?: Partial<DatabaseEnvironmentProof>) => ({
    proven: false,
    refusal,
    host: parts?.host ?? null,
    port: parts?.port ?? null,
    databaseName: parts?.databaseName ?? null,
    message,
  });

  if (!databaseUrl || databaseUrl.trim() === "") {
    return fail("URL_MISSING", "DATABASE_URL is not set, so the target database cannot be identified.");
  }

  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    return fail("URL_UNPARSEABLE", "DATABASE_URL could not be parsed as a connection URL.");
  }

  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    return fail("PROTOCOL_NOT_POSTGRES", "DATABASE_URL is not a PostgreSQL connection URL.");
  }

  const host = url.hostname;
  const port = url.port ? Number(url.port) : 5432;
  // `pathname` is "/name"; a connection URL carries exactly one database name.
  const databaseName = decodeURIComponent(url.pathname.replace(/^\//, ""));
  const parts = { host, port, databaseName };

  if (!LOOPBACK_HOSTS.has(host)) {
    return fail(
      "HOST_NOT_LOOPBACK",
      `The database host '${host}' is not this machine. Destructive local tooling only runs against a loopback host.`,
      parts,
    );
  }

  if (!DISPOSABLE_DATABASE_NAMES.has(databaseName)) {
    return fail(
      "DATABASE_NAME_NOT_DISPOSABLE",
      `The database '${databaseName}' is not a recognised local or disposable database ` +
        `(${[...DISPOSABLE_DATABASE_NAMES].sort().join(", ")}).`,
      parts,
    );
  }

  return { proven: true, refusal: null, host, port, databaseName, message: null };
}

/** True only for the throwaway suite database, which may be reset without ceremony. */
export function isIsolatedTestDatabase(databaseUrl: string | undefined | null): boolean {
  const proof = proveDisposableDatabase(databaseUrl);
  return proof.proven && (proof.databaseName === "planning_sectest" || proof.databaseName === "planning_review");
}

/** Throws with a safe message when the target cannot be proven disposable. */
export function assertDisposableDatabase(databaseUrl: string | undefined | null, operation: string): DatabaseEnvironmentProof {
  const proof = proveDisposableDatabase(databaseUrl);
  if (!proof.proven) {
    throw new Error(`${operation} refused. ${proof.message}`);
  }
  return proof;
}
