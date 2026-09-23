import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withApi, log } from "@/lib/api/with-api";
import { ApiError } from "@/lib/api/errors";
import { consume, LIMITS } from "@/lib/api/rate-limit";
import { tooManyRequests } from "@/lib/api/errors";
import { DUMMY_HASH, verifyPassword } from "@/lib/auth/password";
import { createSession, sessionCookie } from "@/lib/auth/session";
import { ASSIGNED_ROLE_SELECT, resolveEffectiveAccess } from "@/lib/auth/effective-permissions";

const MAX_FAILED = 10;
const LOCK_MS = 15 * 60_000;

const bodySchema = z.object({
  username: z.string().trim().min(1).max(100),
  password: z.string().min(1).max(200),
});

const invalid = () => new ApiError(401, "INVALID_CREDENTIALS", "Invalid username or password.");

// Public by necessity: this is where a session is obtained.
export const POST = withApi({ public: true, body: bodySchema, rateLimit: LIMITS.loginPerClient }, async (req, _ctx, api) => {
  const username = api.body.username.toLowerCase();
  // Per-username throttle, so guessing one account cannot lock everyone else out of the login endpoint.
  const rl = consume(`login-user|${username}`, LIMITS.login);
  if (!rl.ok) throw tooManyRequests(rl.retryAfterSeconds);
  const user = await db.user.findUnique({
    where: { username },
    include: { roleAssignments: { select: ASSIGNED_ROLE_SELECT } },
  });
  const passwordOk = await verifyPassword(api.body.password, user?.passwordHash ?? DUMMY_HASH);
  const locked = !!user?.lockedUntil && user.lockedUntil.getTime() > Date.now();

  if (!user || !passwordOk || locked || user.status !== "ACTIVE") {
    if (user && !passwordOk && !locked) {
      const failed = user.failedLoginCount + 1;
      await db.user.update({
        where: { id: user.id },
        data: { failedLoginCount: failed, lockedUntil: failed >= MAX_FAILED ? new Date(Date.now() + LOCK_MS) : undefined },
      });
    }
    log("warn", "auth.login_failed", { requestId: api.requestId, username: username.slice(0, 50), knownUser: !!user, locked, sourceIp: api.sourceIp });
    await db.auditLog.create({
      data: { actor: "anonymous", action: "LOGIN_FAILED", entity: "User", entityId: user?.id ?? null, reason: "Invalid credentials, locked or disabled account", requestId: api.requestId, sourceIp: api.sourceIp },
    });
    throw invalid();
  }

  await db.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() } });
  const { token, session, maxAgeSeconds } = await createSession(user.id, { ip: api.sourceIp, userAgent: req.headers.get("user-agent") });
  await db.auditLog.create({
    data: { actor: user.username, actorUserId: user.id, actorRole: user.role, sessionId: session.id, action: "LOGIN", entity: "User", entityId: user.id, requestId: api.requestId, sourceIp: api.sourceIp },
  });
  const access = resolveEffectiveAccess(user.roleAssignments.map((a) => a.role), user.role);
  const res = NextResponse.json({
    user: {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      role: user.role,
      roleCodes: access.roleCodes,
      permissions: access.permissions,
      // The client routes a restricted session straight to the password-change screen.
      mustChangePassword: user.mustChangePassword,
    },
  });
  res.headers.append("set-cookie", sessionCookie(token, maxAgeSeconds));
  return res;
});
