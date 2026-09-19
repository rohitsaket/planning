import { NextResponse } from "next/server";
import { withApi } from "@/lib/api/with-api";

export const GET = withApi({ authenticated: true }, async (_req, _ctx, api) => {
  const { userId, username, displayName, role, permissions } = api.principal;
  return NextResponse.json({ user: { id: userId, username, displayName, role, permissions } });
});
