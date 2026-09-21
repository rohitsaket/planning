import { NextResponse } from "next/server";
import pkg from "../../../../../package.json";
import { ok } from "@/lib/api-utils";
import { withApi } from "@/lib/api/with-api";
import { erpBrand, erpModules } from "@/lib/branding";

// Sign-in screen branding and build version for anonymous visitors. Public by
// necessity — it is read before a session exists. It touches no user, tenant or
// configuration data, so there is nothing here an unauthenticated caller should
// not see. Do not add company lists, user counts or any other business data.
//
// The daily quote lives at /api/public/daily-motivation: it has a different
// cache lifetime and its own upstream, so it is fetched separately.
export const GET = withApi({ public: true }, async () => {
  const res = ok({
    branding: {
      name: erpBrand.name,
      tagline: erpBrand.tagline,
      description: erpBrand.description,
      logo: erpBrand.logo,
    },
    modules: erpModules,
    version: pkg.version,
  });
  // Safe to cache for a short window: the payload is identical for every visitor
  // and changes at most once a day. Overrides withApi's default no-store.
  res.headers.set("cache-control", "public, max-age=300, stale-while-revalidate=3600");
  return res as NextResponse;
});
