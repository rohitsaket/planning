"use client";

import { BarChart3, ClipboardList, GitBranch, Layers } from "lucide-react";
import { erpBrand, brandCopyright, type ErpBrand } from "@/lib/branding";
import { DiamondMark } from "@/components/brand/diamond-mark";
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
    <ul className="flex flex-wrap gap-2.5 sm:gap-3">
      {modules.map((m) => {
        const Icon = MODULE_ICONS[m] ?? Layers;
        return (
          <li
            key={m}
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-white/80 dark:bg-[#151922]/80 border border-[#F5CEB5]/80 dark:border-[#3D322C] shadow-2xs text-xs font-semibold text-[#18181B] dark:text-[#F4F4F5]"
          >
            <Icon aria-hidden className="h-4 w-4 text-[#F9733E]" strokeWidth={2} />
            <span>{m}</span>
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
      className="pointer-events-none absolute inset-x-0 bottom-0 h-64 w-full text-[#F9733E]/[0.08] dark:text-[#F9733E]/[0.05]"
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
    <div className="relative flex h-full flex-col overflow-hidden bg-[#FFF1E2] px-6 py-8 sm:px-10 lg:px-14 lg:py-12 dark:bg-[#131720] border-r border-[#FDC698] dark:border-[#22293A]">
      <BackdropGeometry />

      <div className="relative flex min-h-0 flex-1 flex-col">
        {/* Brand Capsule matching AppShell header */}
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-[#FED7AA]/95 dark:bg-[#25201D] border border-[#FB923C]/50 dark:border-[#3D322C] shadow-2xs mb-6 w-fit">
          <div className="h-6 w-6 rounded-lg bg-[#18181B] text-white flex items-center justify-center flex-shrink-0 shadow-xs">
            <DiamondMark className="h-3.5 w-3.5" />
          </div>
          <div className="flex flex-col leading-tight">
            <span className="text-[11px] font-black tracking-tight text-[#18181B] dark:text-[#FFEDD5]">
              Planning
            </span>
            <span className="text-[8px] text-[#786960] dark:text-[#A8988E]">
              ERP Platform
            </span>
          </div>
        </div>

        <header>
          <h1 className="text-3xl font-bold tracking-tight text-[#18181B] sm:text-4xl lg:text-5xl dark:text-[#F4F4F5]">
            {brand.name.split(" ").slice(0, -1).join(" ")}{" "}
            <span className="text-[#F9733E] dark:text-[#F9733E]">{brand.name.split(" ").slice(-1)}</span>
          </h1>
          <p className="mt-3 text-base sm:text-lg font-medium text-[#5C4E46] dark:text-[#D4D4D8]">{brand.tagline}</p>
          <div className="mt-4 h-1 w-12 rounded-full bg-[#F9733E]" />
          <p className="mt-5 max-w-md text-sm sm:text-base leading-relaxed text-[#786960] dark:text-[#A1A1AA]">{brand.description}</p>
        </header>

        <div className="mt-7 max-w-lg lg:mt-9">
          <DailyMotivation {...motivation} />
        </div>

        <div className="mt-7 lg:mt-9">
          <ModuleIndicators modules={modules} />
        </div>

        <footer className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-8 text-xs text-[#786960] dark:text-[#A8988E]">
          <span>{brandCopyright()}</span>
          <span className="tabular-nums">v{version}</span>
        </footer>
      </div>
    </div>
  );
}

export { erpBrand };
