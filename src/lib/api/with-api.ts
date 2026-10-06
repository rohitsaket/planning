import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z, ZodError, type ZodType } from "zod";
import { db } from "@/lib/db";
import { ApiError, badRequest, forbidden, tooLarge, tooManyRequests, unauthenticated } from "@/lib/api/errors";
import { consume, type RateLimit } from "@/lib/api/rate-limit";
import { log } from "@/lib/api/log";
import { resolvePrincipal, type Principal } from "@/lib/auth/session";
import { assertWithinScope, UNRESTRICTED_SCOPE, type EffectiveScope } from "@/lib/auth/access-scope";
import type { Permission } from "@/lib/auth/permissions";
import { resolveNumericEnv } from "@/lib/config/numeric-env";

const MAX_JSON_BYTES = 64 * 1024;
const DEFAULT_READ_LIMIT: RateLimit = { limit: 300, windowMs: 60_000 };
const DEFAULT_WRITE_LIMIT: RateLimit = { limit: 60, windowMs: 60_000 };
const IDENTITY_FIELDS = ["actor", "approver", "approvedBy", "reservedBy", "createdBy", "updatedBy", "userId", "allocatedBy"];

type DbClient = Prisma.TransactionClient | typeof db;

export interface AuditInput {
  action: string;
  entity: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  outcome?: "SUCCESS" | "DENIED" | "FAILED";
  category?: "SECURITY" | "OPERATIONAL";
}

export interface ApiContext<B> {
  principal: Principal;
  body: B;
  url: URL;
  requestId: string;
  sourceIp: string | null;
  scope: EffectiveScope;
  audit: (client: DbClient, input: AuditInput) => Promise<void>;
}

type RouteCtx<P> = { params: Promise<P> };
type Handler<P, B> = (req: Request, routeCtx: RouteCtx<P>, api: ApiContext<B>) => Promise<Response> | Response;

interface Options<B> {
  permission?: Permission;
  authenticated?: true;
  public?: true;
  body?: ZodType<B>;
  rateLimit?: RateLimit;
  allowPasswordChangeSession?: true;
  scoped?: true;
  query?: readonly string[];
}

export { log };

export function clientIp(req: Request): string | null {
  if (process.env.TRUST_PROXY !== "true") return null;
  return req.headers.get("x-real-ip") || req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
}

function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  const allowed = (process.env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (allowed.includes(origin)) return true;
  try {
    const host = (process.env.TRUST_PROXY === "true" && req.headers.get("x-forwarded-host")) || req.headers.get("host") || new URL(req.url).host;
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

async function readJson(req: Request): Promise<unknown> {
  const declared = Number(req.headers.get("content-length") || 0);
  if (declared > MAX_JSON_BYTES) throw tooLarge("Request body is too large.");
  const text = await req.text();
  if (text.length > MAX_JSON_BYTES) throw tooLarge("Request body is too large.");
  if (text.trim() === "") return {};
  try {
    return JSON.parse(text);
  } catch {
    throw badRequest("Request body is not valid JSON.");
  }
}

function isSchemaBehindCode(e: unknown): boolean {
  if (!(e instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (e.code === "P2021" || e.code === "P2022") return true;
  const sqlState = (e.meta as { code?: unknown } | undefined)?.code;
  return e.code === "P2010" && (sqlState === "42P01" || sqlState === "42703");
}

function errorResponse(e: unknown, requestId: string, route: string, userId: string | null): Response {
  let status = 500;
  let code = "INTERNAL_ERROR";
  let message = "An unexpected error occurred.";
  let details: unknown;
  if (e instanceof ApiError) {
    ({ status, code, message, details } = e);
  } else if (e instanceof ZodError) {
    status = 400;
    code = "VALIDATION_FAILED";
    message = "Request validation failed.";
    details = e.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
  } else if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") {
    status = 404;
    code = "NOT_FOUND";
    message = "Record not found.";
  } else if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
    status = 409;
    code = "CONFLICT";
    message = "The record changed or already exists. Reload and try again.";
  } else if (isSchemaBehindCode(e)) {
    status = 503;
    code = "DATABASE_NOT_READY";
    message = "This feature is not available until its database update is applied. Ask an administrator to apply the pending database migrations.";
  }
  if (status >= 500) {
    log("error", "api.unhandled", { requestId, route, userId, error: e instanceof Error ? e.stack : String(e) });
  } else if (status === 401 || status === 403 || status === 409 || status === 429) {
    log("warn", `api.${code.toLowerCase()}`, { requestId, route, userId, status });
  }
  const headers: Record<string, string> = { "x-request-id": requestId, "cache-control": "no-store" };
  if (status === 429 && details && typeof details === "object") headers["retry-after"] = String((details as { retryAfterSeconds: number }).retryAfterSeconds);
  return NextResponse.json({ error: { code, message, requestId, ...(status < 500 && details ? { details } : {}) } }, { status, headers });
}

export function withApi<P = Record<string, never>, B = undefined>(opts: Options<B>, handler: Handler<P, B>) {
  if ([opts.permission, opts.authenticated, opts.public].filter(Boolean).length !== 1) {
    throw new Error("withApi: declare exactly one of `permission`, `authenticated` or `public`.");
  }

  return async (req: Request, routeCtx: RouteCtx<P>): Promise<Response> => {
    const requestId = randomUUID();
    const url = new URL(req.url);
    const route = `${req.method} ${url.pathname}`;
    const sourceIp = clientIp(req);
    let principal: Principal | null = null;
    try {
      const mutating = req.method !== "GET" && req.method !== "HEAD";
      if (!opts.public) {
        principal = await resolvePrincipal(req);
        if (!principal) throw unauthenticated();
        if (principal.mustChangePassword && !opts.allowPasswordChangeSession) {
          throw forbidden("A password change is required before this account can be used.");
        }
        if (opts.permission && !principal.permissions.includes(opts.permission)) throw forbidden();
        if (opts.query) assertQueryShape(url, opts.query);
        if (opts.scoped) {
          for (const name of ["country", "lab"]) {
            if (url.searchParams.getAll(name).length > 1) throw badRequest(`Query parameter '${name}' may be given only once.`);
          }
          assertWithinScope(principal.scope, {
            country: url.searchParams.get("country"),
            lab: url.searchParams.get("lab"),
          });
        }
      }
      const rule = opts.rateLimit ?? (mutating ? DEFAULT_WRITE_LIMIT : DEFAULT_READ_LIMIT);
      const who = principal?.userId ?? `ip:${sourceIp ?? "unknown"}`;
      const rl = consume(`${route}|${who}`, rule);
      if (!rl.ok) throw tooManyRequests(rl.retryAfterSeconds);
      if (mutating && !sameOrigin(req)) throw forbidden("Cross-origin request rejected.");

      let body = undefined as B;
      if (opts.body) {
        const raw = await readJson(req);
        if (raw && typeof raw === "object" && !Array.isArray(raw)) {
          const ignored = IDENTITY_FIELDS.filter((f) => f in (raw as object));
          if (ignored.length) log("warn", "api.identity_field_ignored", { requestId, route, userId: principal?.userId ?? null, fields: ignored });
        }
        body = opts.body.parse(raw);
      }

      const p = principal;
      const audit: ApiContext<B>["audit"] = async (client, input) => {
        if (!p) throw new Error("audit() requires an authenticated principal");
        await client.auditLog.create({
          data: {
            actor: p.username,
            actorUserId: p.userId,
            actorRole: p.role,
            sessionId: p.sessionId,
            requestId,
            correlationId: requestId,
            sourceIp,
            action: input.action,
            entity: input.entity,
            entityId: input.entityId ?? null,
            before: input.before === undefined ? null : JSON.stringify(input.before),
            after: input.after === undefined ? null : JSON.stringify(input.after),
            reason: input.reason ?? null,
            outcome: input.outcome ?? "SUCCESS",
            category: input.category ?? "OPERATIONAL",
          },
        });
      };

      const res = await handler(req, routeCtx, {
        principal: p as Principal,
        body,
        url,
        requestId,
        sourceIp,
        scope: p?.scope ?? UNRESTRICTED_SCOPE,
        audit,
      });
      res.headers.set("x-request-id", requestId);
      if (!res.headers.has("cache-control")) res.headers.set("cache-control", "no-store");
      return res;
    } catch (e) {
      return errorResponse(e, requestId, route, principal?.userId ?? null);
    }
  };
}

function assertQueryShape(url: URL, allowed: readonly string[]): void {
  const seen = new Set<string>();
  for (const name of url.searchParams.keys()) {
    if (!allowed.includes(name)) throw badRequest("The request has a query parameter this endpoint does not accept.");
    if (seen.has(name)) throw badRequest(`Query parameter '${name}' may be given only once.`);
    seen.add(name);
  }
}

export function qInt(url: URL, name: string, o: { def: number; min: number; max: number }): number {
  const raw = url.searchParams.get(name);
  if (raw === null || raw === "") return o.def;
  if (!/^-?\d{1,9}$/.test(raw)) throw badRequest(`Query parameter '${name}' must be an integer.`);
  const n = Number(raw);
  if (n < o.min || n > o.max) throw badRequest(`Query parameter '${name}' must be between ${o.min} and ${o.max}.`);
  return n;
}

export function qStr(url: URL, name: string, max = 100): string | null {
  const raw = url.searchParams.get(name);
  if (raw === null || raw === "") return null;
  if (raw.length > max) throw badRequest(`Query parameter '${name}' is too long (max ${max}).`);
  return raw;
}

export function qEnum<T extends string>(url: URL, name: string, values: readonly T[], def: T): T {
  const raw = url.searchParams.get(name);
  if (raw === null || raw === "") return def;
  if (!(values as readonly string[]).includes(raw)) throw badRequest(`Query parameter '${name}' must be one of: ${values.join(", ")}.`);
  return raw as T;
}

export const PAGE_DEFAULT = resolveNumericEnv("API_PAGE_DEFAULT", { fallback: 500, max: 10_000 }).value;
export const PAGE_MAX = resolveNumericEnv("API_PAGE_MAX", { fallback: 2000, max: 10_000 }).value;
const SCAN_LIMIT = resolveNumericEnv("API_SCAN_MAX", { fallback: 50_000, max: 1_000_000 }).value;
export const SCAN_MAX = SCAN_LIMIT + 1;

export function scanned<T>(rows: T[]): T[] {
  if (rows.length > SCAN_LIMIT) {
    log("error", "api.scan_limit_exceeded", { limit: SCAN_LIMIT });
    throw new ApiError(503, "RESULT_LIMIT_EXCEEDED", "This dataset is larger than the report can process in one request. Narrow the filters or contact support.");
  }
  return rows;
}

export function paging(url: URL) {
  const page = qInt(url, "page", { def: 1, min: 1, max: 1_000_000 });
  const pageSize = qInt(url, "pageSize", { def: PAGE_DEFAULT, min: 1, max: PAGE_MAX });
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize + 1 };
}

export function paged<T>(rows: T[], p: { page: number; pageSize: number }) {
  const hasMore = rows.length > p.pageSize;
  return { rows: hasMore ? rows.slice(0, p.pageSize) : rows, page: p.page, pageSize: p.pageSize, hasMore };
}

export const idSchema = z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/, "invalid id");
export const reasonSchema = z.string().trim().min(5, "Reason (min 5 chars) required").max(500);
