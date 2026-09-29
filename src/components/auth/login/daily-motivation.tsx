"use client";

import { Sun } from "lucide-react";
import type { Motivation } from "@/lib/motivation";

export interface DailyMotivationProps extends Motivation {
  /** ZenQuotes' terms require visible credit when their free API supplied the quote. */
  attribution?: { text: string; url: string } | null;
}

// Compact motivation card. Reserves its own vertical space so swapping the
// fallback for the API's quote never shifts the panel around it.
export function DailyMotivation({ title, quote, subtitle, author, attribution }: DailyMotivationProps) {
  return (
    <section
      aria-labelledby="daily-motivation-title"
      className="rounded-2xl border border-[#F5CEB5]/80 bg-white/85 p-5 shadow-2xs backdrop-blur-xs dark:border-[#3D322C] dark:bg-[#151922]/85"
    >
      <div className="flex gap-4">
        <Sun aria-hidden className="mt-0.5 h-7 w-7 flex-shrink-0 text-[#F9733E]" strokeWidth={1.75} />
        <div className="min-w-0 border-l border-[#F5CEB5] pl-4 dark:border-[#3D322C]">
          <h2 id="daily-motivation-title" className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#786960] dark:text-[#A8988E]">
            {title}
          </h2>
          <blockquote className="mt-2">
            <p className="text-base sm:text-lg font-semibold leading-snug text-[#18181B] transition-opacity motion-reduce:transition-none dark:text-[#F4F4F5]">
              &ldquo;{quote}&rdquo;
            </p>
            <div className="mt-3 h-0.5 w-8 rounded-full bg-[#F9733E]" />
            {subtitle && <p className="mt-3 text-sm text-[#786960] dark:text-[#A8988E]">{subtitle}</p>}
            {author && <footer className="mt-3 text-sm text-[#786960] dark:text-[#A8988E]">— {author}</footer>}
          </blockquote>
          {attribution && (
            <p className="mt-4 text-[11px] text-[#A8988E] dark:text-[#786960]">
              <a
                href={attribution.url}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded underline decoration-[#F5CEB5] underline-offset-2 hover:text-[#F9733E] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F9733E] dark:decoration-[#3D322C] dark:hover:text-[#F9733E]"
              >
                {attribution.text}
              </a>
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
