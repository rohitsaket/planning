import { NextResponse } from "next/server";
import pkg from "../../../../../package.json";
import { ok } from "@/lib/api-utils";
import { withApi } from "@/lib/api/with-api";
import { erpBrand, erpModules } from "@/lib/branding";

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
  res.headers.set("cache-control", "public, max-age=300, stale-while-revalidate=3600");
  return res as NextResponse;
});
