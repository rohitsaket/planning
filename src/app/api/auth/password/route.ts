import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withApi } from "@/lib/api/with-api";
import { badRequest } from "@/lib/api/errors";
import { LIMITS } from "@/lib/api/rate-limit";
import { hashPassword, verifyPassword, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@/lib/auth/password";
import { createSession, revokeAllSessions, sessionCookie } from "@/lib/auth/session";

/**
 * Authenticated password change, and the only way out of a restricted session.
 *
 * `allowPasswordChangeSession` is set because an account on a temporary password must be
 * able to reach exactly this endpoint — and, apart from its own identity and logout,
 * nothing else — until it has chosen a new password.
 *
 * The current password is always verified, so possession of a live session is not by
 * itself enough to change the credential.
 *
 * On success the session is rotated: every session for the account, including the one that
 * made the change, is ended and a fresh session is issued to this browser. Another device
 * that held the old credential is signed out, and the token that was used while the
 * password was temporary never becomes a full session.
 */
const bodySchema = z
  .object({
    currentPassword: z.string().min(1).max(PASSWORD_MAX_LENGTH),
    newPassword: z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH),
  })
  .strict();

export const POST = withApi(
  { authenticated: true, allowPasswordChangeSession: true, body: bodySchema, rateLimit: LIMITS.login },
  async (req, _ctx, api) => {
    const user = await db.user.findUniqueOrThrow({ where: { id: api.principal.userId } });

    if (!(await verifyPassword(api.body.currentPassword, user.passwordHash))) {
      // Deliberately not "wrong current password" versus "unknown account": the actor is
      // already authenticated, so the only useful distinction is whether it matched.
      throw badRequest("The current password is not correct.");
    }
    if (api.body.newPassword === api.body.currentPassword) {
      throw badRequest("The new password must be different from the current one.");
    }

    const passwordHash = await hashPassword(api.body.newPassword);

    await db.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: {
          passwordHash,
          mustChangePassword: false,
          passwordChangedAt: new Date(),
          failedLoginCount: 0,
          lockedUntil: null,
          version: { increment: 1 },
        },
      });
      // No password material of any kind reaches the audit row.
      await api.audit(tx, {
        action: "USER_PASSWORD_CHANGED",
        entity: "User",
        entityId: user.id,
        before: { mustChangePassword: user.mustChangePassword },
        after: { mustChangePassword: false },
        category: "SECURITY",
      });
    });

    await revokeAllSessions(user.id);
    const { token, maxAgeSeconds } = await createSession(user.id, { ip: api.sourceIp, userAgent: req.headers.get("user-agent") });
    const res = NextResponse.json({ ok: true, mustChangePassword: false });
    res.headers.append("set-cookie", sessionCookie(token, maxAgeSeconds));
    return res;
  },
);
