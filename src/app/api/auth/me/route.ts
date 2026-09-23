import { NextResponse } from "next/server";
import { withApi } from "@/lib/api/with-api";

export const GET = withApi({ authenticated: true, allowPasswordChangeSession: true }, async (_req, _ctx, api) => {
  const { userId, username, displayName, role, roleCodes, permissions, mustChangePassword } = api.principal;
  return NextResponse.json({ user: { id: userId, username, displayName, role, roleCodes, permissions, mustChangePassword } });
});
