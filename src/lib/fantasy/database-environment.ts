/**
 * DATABASE ENVIRONMENT PROOF.
 *
 * Destructive tooling — database recreation, Prisma reset and push, fabricated test fixtures,
 * fixture cleanup — must prove it is pointed at an isolated test database before it opens a
 * connection that writes. Not "does not look like production": that is an absence of
 * evidence, and an earlier check accepted any URL whose name contained `planning_sectest`,
 * so `postgres://user@db.internal.corp:5432/planning_sectest` passed as local.
 *
 * So this parses the URL and checks each part separately, and requires positive proof:
 *
 *   - the URL exists, parses and is PostgreSQL;
 *   - the host is a loopback address;
 *   - the database name is exactly one of the isolated test databases; the development
 *     database `planning` never qualifies;
 *   - no deployment marker names a production or staging environment.
 *
 * Anything it cannot parse, or cannot place, is refused. A tool that cannot prove where it
 * is does not get to delete anything.
 *
 * Server-only. The URL is parsed here and never logged, echoed or returned.
 */

if (typeof window !== "undefined") {
  throw new Error("fantasy/database-environment is server-only and must not be imported by client code.");
}

/** Hosts that are the machine running the process. Nothing else counts as local. */
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0"]);

/**
 * The only databases destructive tooling may reset, truncate or fill with fabricated data:
 * the security and browser suite database, the review database, and the Sarin no-catalog
 * suite's throwaway database. A name outside this set is refused even on a loopback host.
 */
export const ISOLATED_TEST_DATABASE_NAMES: ReadonlySet<string> = new Set(["planning_sectest", "planning_review", "planning_sectest_nocatalog"]);

/**
 * Environment variables that may name the deployment, and the values that mean it is not a
 * developer's machine. Checked whatever the command line says.
 */
const DEPLOYMENT_MARKER_VARIABLES = ["APP_ENV", "DEPLOY_ENV", "DEPLOYMENT_ENV", "ENVIRONMENT", "VERCEL_ENV", "NODE_ENV"] as const;
const DEPLOYED_VALUE = /^(prod|production|stage|staging|preprod|pre-production)$/i;

export const ENVIRONMENT_REFUSALS = [
  "URL_MISSING",
  "URL_UNPARSEABLE",
  "PROTOCOL_NOT_POSTGRES",
  "HOST_NOT_LOOPBACK",
  "DATABASE_NAME_NOT_DISPOSABLE",
  "DEPLOYED_ENVIRONMENT",
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

type Env = Readonly<Record<string, string | undefined>>;

/** The marker variable that names a production or staging deployment, if any. */
function deploymentMarker(env: Env): string | null {
  for (const name of DEPLOYMENT_MARKER_VARIABLES) {
    const value = env[name]?.trim();
    if (value && DEPLOYED_VALUE.test(value)) return name;
  }
  return null;
}

type Parts = { host: string; port: number; databaseName: string };

function fail(refusal: EnvironmentRefusal, message: string, parts?: Partial<Parts>): DatabaseEnvironmentProof {
  return { proven: false, refusal, host: parts?.host ?? null, port: parts?.port ?? null, databaseName: parts?.databaseName ?? null, message };
}

/** Parses the URL and proves a loopback PostgreSQL target outside any deployment. */
function proveLocal(databaseUrl: string | undefined | null, env: Env): DatabaseEnvironmentProof | Parts {
  const marker = deploymentMarker(env);
  if (marker) return fail("DEPLOYED_ENVIRONMENT", `${marker} names a production or staging environment. Destructive and setup tooling does not run there.`);

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
  const parts: Parts = {
    host: url.hostname,
    port: url.port ? Number(url.port) : 5432,
    // `pathname` is "/name"; a connection URL carries exactly one database name.
    databaseName: decodeURIComponent(url.pathname.replace(/^\//, "")),
  };
  if (!LOOPBACK_HOSTS.has(parts.host)) {
    return fail("HOST_NOT_LOOPBACK", `The database host '${parts.host}' is not this machine. This tooling only runs against a loopback host.`, parts);
  }
  return parts;
}

/**
 * Proves — or refuses to prove — that a connection string points at an isolated test
 * database that destructive tooling may reset. Every part is checked separately.
 */
export function proveDisposableDatabase(databaseUrl: string | undefined | null, env: Env = process.env): DatabaseEnvironmentProof {
  const local = proveLocal(databaseUrl, env);
  if ("proven" in local) return local;
  if (!ISOLATED_TEST_DATABASE_NAMES.has(local.databaseName)) {
    return fail(
      "DATABASE_NAME_NOT_DISPOSABLE",
      `The database '${local.databaseName}' is not an isolated test database ` +
        `(${[...ISOLATED_TEST_DATABASE_NAMES].sort().join(", ")}). Development, staging and production databases are never reset.`,
      local,
    );
  }
  return { proven: true, refusal: null, ...local, message: null };
}

/**
 * Proves a loopback database outside any production or staging deployment, whatever its
 * name. For non-destructive local setup only: it never licenses a delete.
 */
export function proveLocalDatabase(databaseUrl: string | undefined | null, env: Env = process.env): DatabaseEnvironmentProof {
  const local = proveLocal(databaseUrl, env);
  if ("proven" in local) return local;
  return { proven: true, refusal: null, ...local, message: null };
}

/** True only for an isolated test database, which may be reset without ceremony. */
export function isIsolatedTestDatabase(databaseUrl: string | undefined | null, env: Env = process.env): boolean {
  return proveDisposableDatabase(databaseUrl, env).proven;
}

/** Throws with a safe message when the target cannot be proven an isolated test database. */
export function assertDisposableDatabase(databaseUrl: string | undefined | null, operation: string, env: Env = process.env): DatabaseEnvironmentProof {
  const proof = proveDisposableDatabase(databaseUrl, env);
  if (!proof.proven) {
    throw new Error(`${operation} refused (${proof.refusal}). ${proof.message}`);
  }
  return proof;
}
