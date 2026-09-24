import { createHash, randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { type Permission } from "@/lib/auth/permissions";
import { ASSIGNED_ROLE_SELECT, resolveEffectiveAccess } from "@/lib/auth/effective-permissions";
import { readEffectiveScope, type EffectiveScope } from "@/lib/auth/access-scope";
import { resolveNumericEnv } from "@/lib/config/numeric-env";

export const SESSION_COOKIE = "dp_session";
// Both lifetimes are validated before they become a date. An unreadable value used to
// produce NaN, and `new Date(now + NaN)` is an invalid date — an expiry that no
// comparison can enforce. A refused value falls back to the approved default instead.
const ABSOLUTE_TTL_MS = resolveNumericEnv("SESSION_TTL_HOURS", { fallback: 12, max: 24 * 30 }).value * 3600_000;
const IDLE_TTL_MS = resolveNumericEnv("SESSION_IDLE_MINUTES", { fallback: 60, max: 24 * 60 }).value * 60_000;
const TOUCH_INTERVAL_MS = 60_000;

export interface Principal {
  userId: string;
  username: string;
  displayName: string;
  /** Legacy single-role code. Kept for audit attribution and display, never for authorization. */
  role: string;
  /** Codes of the active roles actually assigned to this user. */
  roleCodes: string[];
  permissions: Permission[];
  /**
   * Which countries and labs this principal may see. Resolved from `UserAccessScope` on
   * every request, exactly like permissions, so a scope change takes effect on the next
   * request without revoking the session. Never read from a request body, header or query
   * parameter.
   */
  scope: EffectiveScope;
  sessionId: string;
  /**
   * True while the account is on a temporary password. A restricted session may reach
   * only its own identity, the password-change endpoint and logout.
   */
  mustChangePassword: boolean;
}

function sha256(v: string): string {
  return createHash("sha256").update(v).digest("hex");
}

export function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

// Secure defaults to on in production. Set COOKIE_SECURE=false only when the
// site is genuinely served over plain HTTP (local development).
function cookieSecure(): boolean {
  const v = process.env.COOKIE_SECURE;
  if (v === "true") return true;
  if (v === "false") return false;
  return process.env.NODE_ENV === "production";
}

export function sessionCookie(token: string, maxAgeSeconds: number): string {
  const attrs = [`${SESSION_COOKIE}=${token}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${maxAgeSeconds}`];
  if (cookieSecure()) attrs.push("Secure");
  return attrs.join("; ");
}

export async function createSession(userId: string, meta: { ip: string | null; userAgent: string | null }) {
  const token = randomBytes(32).toString("base64url");
  const session = await db.session.create({
    data: {
      tokenHash: sha256(token),
      userId,
      expiresAt: new Date(Date.now() + ABSOLUTE_TTL_MS),
      ip: meta.ip,
      userAgent: meta.userAgent?.slice(0, 200) ?? null,
    },
  });
  return { token, session, maxAgeSeconds: Math.floor(ABSOLUTE_TTL_MS / 1000) };
}

// Resolves the authenticated principal from the session cookie, or null.
// Identity, role and status always come from the database — never from the request.
export async function resolvePrincipal(req: Request): Promise<Principal | null> {
  const token = readCookie(req, SESSION_COOKIE);
  if (!token || token.length > 200) return null;
  const session = await db.session.findUnique({
    where: { tokenHash: sha256(token) },
    include: { user: { include: { roleAssignments: { select: ASSIGNED_ROLE_SELECT } } } },
  });
  if (!session || session.revokedAt) return null;
  const now = Date.now();
  if (session.expiresAt.getTime() <= now) return null;
  if (now - session.lastSeenAt.getTime() > IDLE_TTL_MS) return null;
  if (session.user.status !== "ACTIVE") return null;
  if (now - session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
    await db.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date(now) } }).catch(() => undefined);
  }
  // Authorization always comes from the database, per request: a role change therefore
  // takes effect on the very next request without revoking the session.
  const access = resolveEffectiveAccess(
    session.user.roleAssignments.map((a) => a.role),
    session.user.role,
  );

  // Read per request for the same reason permissions are: revoking someone's access to a
  // country must take effect immediately, not when their session happens to expire.
  const scope = await readEffectiveScope(session.user.id);

  return {
    userId: session.user.id,
    username: session.user.username,
    displayName: session.user.displayName,
    role: session.user.role,
    roleCodes: access.roleCodes,
    permissions: access.permissions,
    scope,
    sessionId: session.id,
    mustChangePassword: session.user.mustChangePassword,
  };
}

export async function revokeSession(sessionId: string) {
  await db.session.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: new Date() } });
}

/**
 * Ends every live session for a user and reports how many were ended, so the count can
 * be audited. `exceptSessionId` keeps the caller's own session alive — used by the
 * password-change flow, where the user should stay signed in on the device they just
 * used while every other session is invalidated.
 */
export async function revokeAllSessions(
  userId: string,
  options: { exceptSessionId?: string } = {},
): Promise<number> {
  const result = await db.session.updateMany({
    where: {
      userId,
      revokedAt: null,
      ...(options.exceptSessionId ? { id: { not: options.exceptSessionId } } : {}),
    },
    data: { revokedAt: new Date() },
  });
  return result.count;
}
