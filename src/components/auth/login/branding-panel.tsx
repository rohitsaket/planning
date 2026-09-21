"use client";

import { BarChart3, ClipboardList, GitBranch, Layers } from "lucide-react";
import { erpBrand, brandCopyright, type ErpBrand } from "@/lib/branding";
import { DailyMotivation, type DailyMotivationProps } from "./daily-motivation";

// Informational only — deliberately not links. Nothing here navigates before
// authentication.
const MODULE_ICONS: Record<string, typeof BarChart3> = {
  Analysis: BarChart3,
  Requirements: ClipboardList,
  Planning: Layers,
  Traceability: GitBranch,
};

function ModuleIndicators({ modules }: { modules: readonly string[] }) {
  return (
    <ul className="flex flex-wrap gap-x-8 gap-y-4">
      {modules.map((m) => {
        const Icon = MODULE_ICONS[m] ?? Layers;
        return (
          <li key={m} className="flex flex-col items-center gap-1.5 text-slate-500 dark:text-slate-400">
            <Icon aria-hidden className="h-5 w-5" strokeWidth={1.5} />
            <span className="text-xs">{m}</span>
          </li>
        );
      })}
    </ul>
  );
}

/** Low-opacity architectural geometry. Inline SVG — no image request, and it
 *  never sits above text. */
function BackdropGeometry() {
  return (
    <svg
      aria-hidden
      className="pointer-events-none absolute inset-x-0 bottom-0 h-64 w-full text-blue-900/[0.06] dark:text-blue-300/[0.05]"
      viewBox="0 0 800 260"
      preserveAspectRatio="xMidYMax slice"
      fill="none"
    >
      <path d="M0 260 L140 96 L280 260 Z" fill="currentColor" />
      <path d="M180 260 L330 60 L480 260 Z" fill="currentColor" />
      <path d="M400 260 L540 120 L680 260 Z" fill="currentColor" />
      <path d="M620 260 L760 150 L800 200 L800 260 Z" fill="currentColor" />
      <g stroke="currentColor" strokeWidth="1.5">
        <path d="M60 260 V150 H150 V260" />
        <path d="M330 260 V130 H420 V260" />
        <path d="M600 260 V170 H690 V260" />
      </g>
    </svg>
  );
}

export function BrandingPanel({
  brand,
  modules,
  motivation,
  version,
}: {
  brand: ErpBrand;
  modules: readonly string[];
  motivation: DailyMotivationProps;
  version: string;
}) {
  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-[#F3F7FC] px-6 py-8 sm:px-10 lg:px-14 lg:py-12 dark:bg-slate-950">
      <BackdropGeometry />

      <div className="relative flex min-h-0 flex-1 flex-col">
        <header>
          <h1 className="text-4xl font-bold tracking-tight text-slate-900 lg:text-5xl dark:text-slate-50">
            {brand.name.split(" ").slice(0, -1).join(" ")}{" "}
            <span className="text-blue-600 dark:text-blue-400">{brand.name.split(" ").slice(-1)}</span>
          </h1>
          <p className="mt-3 text-lg text-slate-600 dark:text-slate-300">{brand.tagline}</p>
          <div className="mt-5 h-1 w-12 rounded-full bg-blue-600 dark:bg-blue-400" />
          <p className="mt-6 max-w-md text-base leading-relaxed text-slate-600 dark:text-slate-300">{brand.description}</p>
        </header>

        <div className="mt-8 max-w-lg lg:mt-10">
          <DailyMotivation {...motivation} />
        </div>

        <div className="mt-8 lg:mt-12">
          <ModuleIndicators modules={modules} />
        </div>

        <footer className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-10 text-xs text-slate-500 dark:text-slate-400">
          <span>{brandCopyright()}</span>
          <span className="tabular-nums">v{version}</span>
        </footer>
      </div>
    </div>
  );
}

export { erpBrand };
