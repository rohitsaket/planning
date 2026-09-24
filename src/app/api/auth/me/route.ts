import { NextResponse } from "next/server";
import { withApi } from "@/lib/api/with-api";
import { describeScope } from "@/lib/auth/access-scope";

export const GET = withApi({ authenticated: true, allowPasswordChangeSession: true }, async (_req, _ctx, api) => {
  const { userId, username, displayName, role, roleCodes, permissions, mustChangePassword, scope } = api.principal;
  return NextResponse.json({
    user: {
      id: userId,
      username,
      displayName,
      role,
      roleCodes,
      permissions,
      mustChangePassword,
      // The caller's own scope, so the global filter can offer only the countries and labs
      // they are authorized for. This is UX: every route enforces the same scope again on
      // the server, and a request for anything outside it is refused there.
      accessScope: describeScope(scope),
    },
  });
});
