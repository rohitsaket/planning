import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withApi } from "@/lib/api/with-api";
import { badRequest } from "@/lib/api/errors";
import { LIMITS } from "@/lib/api/rate-limit";
import { hashPassword, verifyPassword, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@/lib/auth/password";
import { createSession, revokeAllSessions, sessionCookie } from "@/lib/auth/session";

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
