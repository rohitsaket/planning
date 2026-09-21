// Login-screen branding. Kept in one place so the sign-in page never hardcodes
// product copy; a future multi-tenant build can serve these fields per tenant
// from /api/public/login-context without touching a component.
//
// Nothing here is confidential: every field is rendered to anonymous visitors.

export interface ErpBrand {
  name: string;
  tagline: string;
  description: string;
  logo: string;
}

export const erpBrand: ErpBrand = {
  name: "Diamond Manufacturing ERP",
  tagline: "Plan Today. Deliver Tomorrow.",
  description: "A unified platform for analysis, requirement, planning and traceability.",
  logo: "/logo.svg",
};

/** Modules advertised on the sign-in screen. Informational only — never links. */
export const erpModules = ["Analysis", "Requirements", "Planning", "Traceability"] as const;

export const brandCopyright = (year = new Date().getFullYear()) => `© ${year} ${erpBrand.name}. All rights reserved.`;
