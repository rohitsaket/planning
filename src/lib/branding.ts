export interface ErpBrand {
  name: string;
  tagline: string;
  description: string;
  logo: string;
}

export const erpBrand: ErpBrand = {
  name: "Diamond Planning Utility",
  tagline: "Plan Today. Deliver Tomorrow.",
  description: "A unified platform for diamond analysis and planning.",
  logo: "/logo.svg",
};

export const erpModules = ["Analysis", "Planning"] as const;

export const brandCopyright = (year = new Date().getFullYear()) => `© ${year} ${erpBrand.name}. All rights reserved.`;
