import type { NextResponse } from "next/server";
import { ok } from "@/lib/api-utils";
import { withApi } from "@/lib/api/with-api";
import { getDailyMotivation } from "@/lib/motivation";
import { analyticsTimeZone } from "@/lib/analytics/reporting-date";

// The day's motivational quote for the sign-in screen.
//
// Public by necessity: it is read before a session exists. It carries no user,
// tenant or business data. The ZenQuotes call happens here, server-side — the
// browser never talks to the upstream, so no employee IP is exposed to it and
// the CSP needs no third-party origin.
//
// Never fails: an upstream outage degrades to the local quote list.
export const GET = withApi({ public: true }, async () => {
  const payload = await getDailyMotivation(new Date(), analyticsTimeZone());
  const res = ok(payload);
  // Identical for every visitor and changes at most once a day. Overrides
  // withApi's default no-store; `fallback` is held briefly so a recovered
  // upstream reaches clients quickly.
  const maxAge = payload.source === "zenquotes" ? 3600 : 300;
  res.headers.set("cache-control", `public, max-age=${maxAge}, stale-while-revalidate=86400`);
  return res as NextResponse;
});
