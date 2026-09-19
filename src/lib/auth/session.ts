import { createHash, randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { permissionsFor, type Permission } from "@/lib/auth/permissions";

export const SESSION_COOKIE = "dp_session";
const ABSOLUTE_TTL_MS = Number(process.env.SESSION_TTL_HOURS || 12) * 3600_000;
const IDLE_TTL_MS = Number(process.env.SESSION_IDLE_MINUTES || 60) * 60_000;
const TOUCH_INTERVAL_MS = 60_000;

export interface Principal {
  userId: string;
  username: string;
  displayName: string;
  role: string;
  permissions: Permission[];
  sessionId: string;
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
  const session = await db.session.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } });
  if (!session || session.revokedAt) return null;
  const now = Date.now();
  if (session.expiresAt.getTime() <= now) return null;
  if (now - session.lastSeenAt.getTime() > IDLE_TTL_MS) return null;
  if (session.user.status !== "ACTIVE") return null;
  if (now - session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
    await db.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date(now) } }).catch(() => undefined);
  }
  return {
    userId: session.user.id,
    username: session.user.username,
    displayName: session.user.displayName,
    role: session.user.role,
    permissions: permissionsFor(session.user.role),
    sessionId: session.id,
  };
}

export async function revokeSession(sessionId: string) {
  await db.session.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: new Date() } });
}

export async function revokeAllSessions(userId: string) {
  await db.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
}
