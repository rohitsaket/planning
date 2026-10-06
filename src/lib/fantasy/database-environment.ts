if (typeof window !== "undefined") {
  throw new Error("fantasy/database-environment is server-only and must not be imported by client code.");
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0"]);

export const ISOLATED_TEST_DATABASE_NAMES: ReadonlySet<string> = new Set(["planning_sectest", "planning_review", "planning_sectest_nocatalog"]);

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
  readonly host: string | null;
  readonly port: number | null;
  readonly databaseName: string | null;
  readonly message: string | null;
}

type Env = Readonly<Record<string, string | undefined>>;

export function deploymentMarker(env: Env): string | null {
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
    databaseName: decodeURIComponent(url.pathname.replace(/^\//, "")),
  };
  if (!LOOPBACK_HOSTS.has(parts.host)) {
    return fail("HOST_NOT_LOOPBACK", `The database host '${parts.host}' is not this machine. This tooling only runs against a loopback host.`, parts);
  }
  return parts;
}

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

export function proveLocalDatabase(databaseUrl: string | undefined | null, env: Env = process.env): DatabaseEnvironmentProof {
  const local = proveLocal(databaseUrl, env);
  if ("proven" in local) return local;
  return { proven: true, refusal: null, ...local, message: null };
}

export function isIsolatedTestDatabase(databaseUrl: string | undefined | null, env: Env = process.env): boolean {
  return proveDisposableDatabase(databaseUrl, env).proven;
}

export function assertDisposableDatabase(databaseUrl: string | undefined | null, operation: string, env: Env = process.env): DatabaseEnvironmentProof {
  const proof = proveDisposableDatabase(databaseUrl, env);
  if (!proof.proven) {
    throw new Error(`${operation} refused (${proof.refusal}). ${proof.message}`);
  }
  return proof;
}
