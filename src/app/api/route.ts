import { NextResponse } from "next/server";
import { withApi } from "@/lib/api/with-api";

// Public liveness probe. Returns no application data.
export const GET = withApi({ public: true }, async () => NextResponse.json({ status: "ok" }));
