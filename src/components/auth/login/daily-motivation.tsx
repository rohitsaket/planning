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
      className="rounded-xl border border-white/70 bg-white/70 p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] backdrop-blur-[2px] dark:border-slate-700/60 dark:bg-slate-900/40"
    >
      <div className="flex gap-4">
        <Sun aria-hidden className="mt-0.5 h-8 w-8 flex-shrink-0 text-blue-600 dark:text-blue-400" strokeWidth={1.5} />
        <div className="min-w-0 border-l border-slate-200 pl-4 dark:border-slate-700">
          <h2 id="daily-motivation-title" className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">
            {title}
          </h2>
          <blockquote className="mt-2">
            <p className="text-lg font-semibold leading-snug text-slate-900 transition-opacity motion-reduce:transition-none dark:text-slate-100">
              &ldquo;{quote}&rdquo;
            </p>
            <div className="mt-3 h-0.5 w-8 rounded-full bg-blue-600 dark:bg-blue-400" />
            {subtitle && <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">{subtitle}</p>}
            {author && <footer className="mt-3 text-sm text-slate-500 dark:text-slate-400">— {author}</footer>}
          </blockquote>
          {attribution && (
            <p className="mt-4 text-[11px] text-slate-400 dark:text-slate-500">
              <a
                href={attribution.url}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded underline decoration-slate-300 underline-offset-2 hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 dark:decoration-slate-600 dark:hover:text-slate-300"
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
