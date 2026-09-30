"use client";

import { createContext, useContext, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Shared compact density.
 *
 * Dimensions live as CSS variables in src/app/globals.css (`--dp-*`) and reach components as
 * spacing utilities: px-page-x, py-page-y, gap-section, p-card, h-control, h-row, h-tab,
 * h-bar, h-nav-row, w-sidebar. Phones get larger controls and rows from the same tokens.
 * Pages and shared components use these rather than choosing their own sizes.
 */

/**
 * The height of a bounded scroll region (a long unpaginated list beside other panels): what
 * the viewport leaves after the top bar, the page's tab strip and a panel header, never taller
 * than 36rem and never shorter than 16rem. `dvh` follows mobile browser toolbars.
 */
export const BOUNDED_REGION_MAX_HEIGHT = "clamp(16rem, calc(100dvh - 18rem), 36rem)";

/** The body of every page: page gutters and the gap between blocks. */
export const PAGE_BODY = "flex flex-col gap-section px-page-x py-page-y";

export function PageBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div data-page-body className={cn(PAGE_BODY, className)}>{children}</div>;
}

/**
 * Set by a tabbed host around its active tab. A page header inside it does not repeat the
 * host title or the tab label, and it is not a second sticky page header.
 */
export const HostTabContext = createContext<{ hostTitle: string; tabLabel: string } | null>(null);
export const useHostTab = () => useContext(HostTabContext);

/** Set by a Section around its body, so a table inside it can integrate into the section header or avoid drawing a second card. */
export interface SectionContextValue {
  inSection: boolean;
  hasHeader: boolean;
  headerSlot: HTMLElement | null;
}

export const SectionContext = createContext<SectionContextValue>({
  inSection: false,
  hasHeader: false,
  headerSlot: null,
});
export const useSectionContext = () => useContext(SectionContext);
export const useInSection = () => useContext(SectionContext).inSection;

/**
 * One compact filter toolbar: the page's selectors and search on a single wrapping row, with
 * reset or saved-view actions at the end. Replaces a titled "Filters" card.
 */
export function FilterBar({ children, actions, className }: { children?: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <div role="group" aria-label="Filters" data-filter-bar className={cn("flex flex-wrap items-center gap-2 rounded-lg border border-border/80 bg-card px-card py-2", className)}>
      {children}
      {actions && <div className={cn("flex flex-wrap items-center gap-1.5", children ? "ml-auto" : "")}>{actions}</div>}
    </div>
  );
}
