import { NextResponse } from "next/server";
import { withApi } from "@/lib/api/with-api";
import { resolvePrincipal, revokeSession, sessionCookie } from "@/lib/auth/session";

// Public so that an expired session can still clear its cookie; revokes the session when one is valid.
export const POST = withApi({ public: true }, async (req) => {
  const principal = await resolvePrincipal(req);
  if (principal) await revokeSession(principal.sessionId);
  const res = NextResponse.json({ ok: true });
  res.headers.append("set-cookie", sessionCookie("", 0));
  return res;
});
