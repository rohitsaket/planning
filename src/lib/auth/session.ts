import { createHash, randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { type Permission } from "@/lib/auth/permissions";
import { ASSIGNED_ROLE_SELECT, resolveEffectiveAccess } from "@/lib/auth/effective-permissions";
import { readEffectiveScope, type EffectiveScope } from "@/lib/auth/access-scope";
import { resolveNumericEnv } from "@/lib/config/numeric-env";

export const SESSION_COOKIE = "dp_session";
const ABSOLUTE_TTL_MS = resolveNumericEnv("SESSION_TTL_HOURS", { fallback: 12, max: 24 * 30 }).value * 3600_000;
const IDLE_TTL_MS = resolveNumericEnv("SESSION_IDLE_MINUTES", { fallback: 60, max: 24 * 60 }).value * 60_000;
const TOUCH_INTERVAL_MS = 60_000;

export interface Principal {
  userId: string;
  username: string;
  displayName: string;
  role: string;
  roleCodes: string[];
  permissions: Permission[];
  scope: EffectiveScope;
  sessionId: string;
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
  const access = resolveEffectiveAccess(
    session.user.roleAssignments.map((a) => a.role),
    session.user.role,
  );

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

export async function revokeAllSessions(userId: string): Promise<number> {
  const result = await db.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
  return result.count;
}
