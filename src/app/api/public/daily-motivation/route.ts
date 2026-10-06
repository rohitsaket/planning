import type { NextResponse } from "next/server";
import { ok } from "@/lib/api-utils";
import { withApi } from "@/lib/api/with-api";
import { getDailyMotivation } from "@/lib/motivation";
import { analyticsTimeZone } from "@/lib/analytics/reporting-date";

export const GET = withApi({ public: true }, async () => {
  const payload = await getDailyMotivation(new Date(), analyticsTimeZone());
  const res = ok(payload);
  const maxAge = payload.source === "zenquotes" ? 3600 : 300;
  res.headers.set("cache-control", `public, max-age=${maxAge}, stale-while-revalidate=86400`);
  return res as NextResponse;
});
