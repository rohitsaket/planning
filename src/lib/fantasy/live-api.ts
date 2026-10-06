/**
 * Live Fantasy ERP API client (server-only).
 *
 * Fantasy contract as observed against https://skylab.fantasy.mn:7600 (ASP.NET Web API on IIS):
 *   POST /token            OAuth2 password grant (grant_type=password&username&password) → bearer,
 *                          expires_in ≈ 86400. Fantasy keeps ONE active token per user: a new login
 *                          invalidates the previous token ("logged out in a different location").
 *   GET  {lotsPath}        lot listing. Optional pagination via FANTASY_API_PAGE_PARAM /
 *                          FANTASY_API_PAGE_SIZE_PARAM (unset = one response holds everything);
 *                          nothing is assumed about the vendor's paging until they confirm it.
 *   GET  /api/lots/{id}    single lot.
 *
 * Guarantees: every request has a timeout; transient failures (timeout, network, 5xx, 429 with
 * Retry-After) are retried with exponential backoff and jitter up to FANTASY_SYNC_MAX_RETRIES;
 * 401/403 are never retried beyond a single re-login; the password is read only inside login()
 * and is never logged, persisted or returned; tokens are cached in memory and, encrypted under
 * SECRETS_KEY, in IntegrationApiToken so restarts and multiple instances share one login.
 */

import { db } from "@/lib/db";
import { decryptSecret, encryptSecret, readSecretEnv } from "@/lib/security/secrets";
import { safeErrorMessage } from "@/lib/security/redact";
import { log } from "@/lib/api/with-api";
import { describeBaseUrl, getLiveFantasyConfig, type LiveFantasyConfig } from "./config";

export { describeBaseUrl, getLiveFantasyConfig };
export type { LiveFantasyConfig };
export const FANTASY_TOKEN_SOURCE = "FANTASY";
const REFRESH_MARGIN_MS = 10 * 60_000;
const MAX_PAGES = 10_000;

export type FantasyErrorCode = "NOT_CONFIGURED" | "AUTH_FAILED" | "TIMEOUT" | "NETWORK" | "UPSTREAM_ERROR" | "RATE_LIMITED" | "BAD_RESPONSE";

export class FantasyApiError extends Error {
  constructor(message: string, public code: FantasyErrorCode, public status: number | null = null, public path?: string, public retryable = false) {
    super(message);
  }
}

export interface CachedToken {
  token: string;
  tokenType: string;
  expiresAt: Date;
  issuedTo: string | null;
}

export interface TokenStore {
  load(): Promise<CachedToken | null>;
  save(t: CachedToken): Promise<void>;
  clear(): Promise<void>;
}

export interface FantasyClientDeps {
  config?: () => LiveFantasyConfig;
  fetchImpl?: typeof fetch;
  tokenStore?: TokenStore;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  /** Reads the password; defaults to the encrypted .env value. Tests inject a stub. */
  readPassword?: () => string | null;
}

export interface FetchLotsResult {
  rows: Record<string, unknown>[];
  pages: number;
  requests: number;
  durationMs: number;
  /** True when the listing is paginated and every page was retrieved. */
  complete: boolean;
}

export interface ConnectionTestResult {
  ok: boolean;
  host: string;
  usernameConfigured: boolean;
  login: { ok: boolean; issuedTo: string | null; expiresAt: string | null; fromCache: boolean; error?: string };
  lots: { path: string; ok: boolean; status: number | null; rows: number | null; sampleColumns: string[]; error?: string };
  durationMs: number;
}

type TokenResponse = { access_token?: string; token_type?: string; expires_in?: number | string; userName?: string; userID?: string; LoginMessage?: string; error?: string; error_description?: string };

// One memory cache per server process (survives Turbopack module reloads in dev).
const g = globalThis as unknown as { __fantasyToken?: CachedToken | null };

/** Encrypted, database-backed token cache shared by every server instance. */
export const dbTokenStore: TokenStore = {
  async load() {
    if (!process.env.SECRETS_KEY) return null;
    try {
      const row = await db.integrationApiToken.findUnique({ where: { source: FANTASY_TOKEN_SOURCE } });
      if (!row) return null;
      return { token: decryptSecret(row.tokenEnc), tokenType: row.tokenType, expiresAt: row.expiresAt, issuedTo: row.issuedTo };
    } catch (e) {
      log("warn", "fantasy_token_cache_read_failed", { error: safeErrorMessage(e) });
      return null;
    }
  },
  async save(t) {
    if (!process.env.SECRETS_KEY) return; // no key → memory-only cache
    try {
      const tokenEnc = encryptSecret(t.token);
      await db.integrationApiToken.upsert({
        where: { source: FANTASY_TOKEN_SOURCE },
        create: { source: FANTASY_TOKEN_SOURCE, tokenEnc, tokenType: t.tokenType, issuedTo: t.issuedTo, issuedAt: new Date(), expiresAt: t.expiresAt },
        update: { tokenEnc, tokenType: t.tokenType, issuedTo: t.issuedTo, issuedAt: new Date(), expiresAt: t.expiresAt },
      });
    } catch (e) {
      log("warn", "fantasy_token_cache_write_failed", { error: safeErrorMessage(e) });
    }
  },
  async clear() {
    try {
      await db.integrationApiToken.deleteMany({ where: { source: FANTASY_TOKEN_SOURCE } });
    } catch {
      // best effort
    }
  },
};

export const memoryTokenStore = (): TokenStore => {
  let t: CachedToken | null = null;
  return { async load() { return t; }, async save(v) { t = v; }, async clear() { t = null; } };
};

function usable(t: CachedToken | null | undefined): t is CachedToken {
  return !!t && t.expiresAt.getTime() - Date.now() > REFRESH_MARGIN_MS;
}

/** Extracts the row array from the common shapes an ASP.NET API returns. */
export function extractRows(body: unknown): Record<string, unknown>[] | null {
  if (Array.isArray(body)) return body as Record<string, unknown>[];
  if (body && typeof body === "object") {
    const o = body as Record<string, unknown>;
    for (const k of ["data", "Data", "items", "Items", "result", "Result", "rows", "Rows", "value", "lots", "Lots", "records", "Records"]) {
      if (Array.isArray(o[k])) return o[k] as Record<string, unknown>[];
    }
    for (const v of Object.values(o)) if (Array.isArray(v) && v.length && typeof v[0] === "object") return v as Record<string, unknown>[];
  }
  return null;
}

export function retryDelayMs(attempt: number, retryAfterHeader: string | null, random: () => number): number {
  const ra = retryAfterHeader ? Number(retryAfterHeader) : NaN;
  if (Number.isFinite(ra) && ra >= 0) return Math.min(ra * 1000, 120_000);
  const base = 500 * Math.pow(2, attempt); // 500, 1000, 2000, 4000 …
  return Math.min(base + Math.floor(random() * 250), 30_000);
}

export function createFantasyClient(deps: FantasyClientDeps = {}) {
  const config = deps.config ?? getLiveFantasyConfig;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const store = deps.tokenStore ?? dbTokenStore;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const random = deps.random ?? Math.random;
  const readPassword = deps.readPassword ?? (() => readSecretEnv("FANTASY_API_PASSWORD"));
  const useGlobalMemory = !deps.tokenStore;

  const memGet = () => (useGlobalMemory ? g.__fantasyToken : undefined);
  const memSet = (t: CachedToken | null) => { if (useGlobalMemory) g.__fantasyToken = t; };

  async function doFetch(url: string, init: RequestInit, cfg: LiveFantasyConfig, path: string): Promise<Response> {
    try {
      return await fetchImpl(url, { ...init, signal: AbortSignal.timeout(cfg.timeoutMs), cache: "no-store" });
    } catch (e) {
      const name = e instanceof Error ? e.name : "";
      if (name === "TimeoutError" || name === "AbortError") throw new FantasyApiError(`Fantasy request timed out after ${cfg.timeoutMs}ms`, "TIMEOUT", null, path, true);
      throw new FantasyApiError(`Fantasy request failed: ${safeErrorMessage(e, 120)}`, "NETWORK", null, path, true);
    }
  }

  /** Password-grant login. The password exists only inside this call; never retried on rejection. */
  async function login(cfg: LiveFantasyConfig): Promise<CachedToken> {
    const password = readPassword();
    if (!password) throw new FantasyApiError("Fantasy ERP integration is not configured.", "NOT_CONFIGURED");
    const body = new URLSearchParams({ grant_type: "password", username: cfg.username, password }).toString();
    const res = await doFetch(`${cfg.baseUrl}/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" }, body }, cfg, "/token");
    let data: TokenResponse = {};
    try {
      data = (await res.json()) as TokenResponse;
    } catch {
      // non-JSON: handled below
    }
    if (res.status === 400 || res.status === 401 || res.status === 403 || (!res.ok && res.status < 500)) {
      log("warn", "fantasy_auth_failed", { statusCode: res.status, errorCode: data.error ?? null });
      throw new FantasyApiError("Fantasy authentication failed.", "AUTH_FAILED", res.status, "/token");
    }
    if (!res.ok) throw new FantasyApiError(`Fantasy login endpoint returned HTTP ${res.status}`, "UPSTREAM_ERROR", res.status, "/token", res.status >= 500);
    if (!data.access_token) throw new FantasyApiError("Fantasy login response carried no access token.", "BAD_RESPONSE", res.status, "/token");
    const expiresIn = Number(data.expires_in || 3600);
    const token: CachedToken = { token: data.access_token, tokenType: (data.token_type || "bearer").toLowerCase(), expiresAt: new Date(Date.now() + expiresIn * 1000), issuedTo: data.userName || data.userID || null };
    log("info", "fantasy_auth_success", { expiresAt: token.expiresAt.toISOString(), loginMessage: data.LoginMessage ?? null });
    return token;
  }

  async function getAccessToken(opts: { forceLogin?: boolean } = {}): Promise<CachedToken> {
    const cfg = config();
    if (!cfg.configured) throw new FantasyApiError("Fantasy ERP integration is not configured.", "NOT_CONFIGURED");
    if (!opts.forceLogin) {
      const m = memGet();
      if (usable(m)) return m;
      const persisted = await store.load();
      if (usable(persisted)) {
        memSet(persisted);
        return persisted;
      }
    }
    const fresh = await login(cfg);
    memSet(fresh);
    await store.save(fresh);
    return fresh;
  }

  async function tokenStatus(): Promise<{ cached: boolean; expiresAt: string | null; issuedTo: string | null }> {
    const m = memGet();
    const t = usable(m) ? m : await store.load();
    if (!t) return { cached: false, expiresAt: null, issuedTo: null };
    return { cached: t.expiresAt.getTime() > Date.now(), expiresAt: t.expiresAt.toISOString(), issuedTo: t.issuedTo };
  }

  /**
   * Authenticated GET with retry policy. Returns status/body/text; throws FantasyApiError for
   * auth failures, exhausted retries and non-JSON bodies on 2xx.
   */
  async function get(path: string): Promise<{ status: number; body: unknown; text: string }> {
    const cfg = config();
    let reloggedIn = false;
    for (let attempt = 0; ; attempt++) {
      const t = await getAccessToken();
      let res: Response;
      try {
        res = await doFetch(`${cfg.baseUrl}${path}`, { headers: { authorization: `Bearer ${t.token}`, accept: "application/json" } }, cfg, path);
      } catch (e) {
        if (e instanceof FantasyApiError && e.retryable && attempt < cfg.maxRetries) {
          const wait = retryDelayMs(attempt, null, random);
          log("warn", "fantasy_request_retry", { path, attempt: attempt + 1, errorCode: e.code, waitMs: wait });
          await sleep(wait);
          continue;
        }
        throw e;
      }
      if (res.status === 401 || res.status === 403) {
        if (res.status === 401 && !reloggedIn) {
          // The single-session rule means another login elsewhere may have invalidated our token.
          reloggedIn = true;
          memSet(null);
          await store.clear();
          await getAccessToken({ forceLogin: true });
          continue;
        }
        log("warn", "fantasy_auth_rejected", { path, statusCode: res.status });
        throw new FantasyApiError("Fantasy authentication failed.", "AUTH_FAILED", res.status, path);
      }
      if ((res.status === 429 || res.status >= 500) && attempt < cfg.maxRetries) {
        const wait = retryDelayMs(attempt, res.headers.get("retry-after"), random);
        log("warn", "fantasy_request_retry", { path, attempt: attempt + 1, statusCode: res.status, waitMs: wait });
        await sleep(wait);
        continue;
      }
      const text = await res.text();
      let body: unknown = null;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        body = null;
      }
      if (res.status === 429) throw new FantasyApiError("Fantasy API rate limit exceeded.", "RATE_LIMITED", 429, path);
      if (res.status >= 500) throw new FantasyApiError(`Fantasy API GET ${path} → HTTP ${res.status}: ${text.slice(0, 200).replace(/\s+/g, " ")}`, "UPSTREAM_ERROR", res.status, path);
      return { status: res.status, body, text };
    }
  }

  function pageUrl(cfg: LiveFantasyConfig, page: number): string {
    if (!cfg.pageParam) return cfg.lotsPath;
    const u = new URL(cfg.lotsPath, "http://x");
    u.searchParams.set(cfg.pageParam, String(page));
    if (cfg.pageSizeParam) u.searchParams.set(cfg.pageSizeParam, String(cfg.pageSize));
    return u.pathname + u.search;
  }

  /** Fetches the whole lot listing (every page when paginated). */
  async function fetchLots(): Promise<FetchLotsResult> {
    const cfg = config();
    const started = Date.now();
    const rows: Record<string, unknown>[] = [];
    let pages = 0;
    let requests = 0;
    for (let page = 1; page <= MAX_PAGES; page++) {
      const path = pageUrl(cfg, page);
      const r = await get(path);
      requests++;
      if (r.status < 200 || r.status >= 300) throw new FantasyApiError(`Fantasy API GET ${path} → HTTP ${r.status}: ${r.text.slice(0, 200).replace(/\s+/g, " ")}`, "UPSTREAM_ERROR", r.status, path);
      if (r.body === null && r.text.trim() !== "") throw new FantasyApiError(`Fantasy API GET ${path} returned a non-JSON body.`, "BAD_RESPONSE", r.status, path);
      const pageRows = r.body === null ? [] : extractRows(r.body);
      if (pageRows === null) throw new FantasyApiError(`Fantasy API GET ${path} returned an unexpected shape (no row array).`, "BAD_RESPONSE", r.status, path);
      pages++;
      rows.push(...pageRows);
      log("info", "fantasy_page_received", { page, count: pageRows.length, statusCode: r.status });
      if (!cfg.pageParam || pageRows.length === 0 || pageRows.length < cfg.pageSize) break;
    }
    return { rows, pages, requests, durationMs: Date.now() - started, complete: true };
  }

  async function testConnection(): Promise<ConnectionTestResult> {
    const started = Date.now();
    const cfg = config();
    const out: ConnectionTestResult = {
      ok: false,
      host: describeBaseUrl(cfg.baseUrl),
      usernameConfigured: cfg.usernameConfigured,
      login: { ok: false, issuedTo: null, expiresAt: null, fromCache: false },
      lots: { path: cfg.lotsPath, ok: false, status: null, rows: null, sampleColumns: [] },
      durationMs: 0,
    };
    if (!cfg.configured) {
      out.login.error = `Fantasy ERP integration is not configured (missing ${cfg.missing.join(", ")}).`;
      out.durationMs = Date.now() - started;
      return out;
    }
    try {
      const before = await tokenStatus();
      const t = await getAccessToken();
      out.login = { ok: true, issuedTo: t.issuedTo, expiresAt: t.expiresAt.toISOString(), fromCache: before.cached };
    } catch (e) {
      out.login.error = safeErrorMessage(e);
      out.durationMs = Date.now() - started;
      return out;
    }
    try {
      const r = await get(pageUrl(cfg, 1));
      out.lots.status = r.status;
      const rows = r.body === null ? null : extractRows(r.body);
      if (r.status >= 200 && r.status < 300 && rows) {
        out.lots.ok = true;
        out.lots.rows = rows.length;
        out.lots.sampleColumns = rows[0] ? Object.keys(rows[0]).slice(0, 80) : [];
      } else {
        out.lots.error = `HTTP ${r.status}: ${r.text.slice(0, 200).replace(/\s+/g, " ")}`;
      }
    } catch (e) {
      out.lots.status = e instanceof FantasyApiError ? e.status : null;
      out.lots.error = safeErrorMessage(e);
    }
    out.ok = out.login.ok && out.lots.ok;
    out.durationMs = Date.now() - started;
    return out;
  }

  return { getAccessToken, tokenStatus, get, fetchLots, testConnection };
}

export type FantasyClient = ReturnType<typeof createFantasyClient>;

// Default client used by the application.
const defaultClient = createFantasyClient();
export const getFantasyAccessToken = defaultClient.getAccessToken;
export const getFantasyTokenStatus = defaultClient.tokenStatus;
export const fantasyGet = defaultClient.get;
export const fetchFantasyLotsDetailed = defaultClient.fetchLots;
export const testFantasyConnection = defaultClient.testConnection;
export async function fetchFantasyLots(): Promise<Record<string, unknown>[]> {
  return (await defaultClient.fetchLots()).rows;
}
