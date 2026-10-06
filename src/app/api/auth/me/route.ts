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
      accessScope: describeScope(scope),
    },
  });
});
