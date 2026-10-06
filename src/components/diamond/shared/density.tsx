"use client";

import { createContext, useContext, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export const BOUNDED_REGION_MAX_HEIGHT = "clamp(16rem, calc(100dvh - 18rem), 36rem)";

export const PAGE_BODY = "flex flex-col gap-section px-page-x py-page-y";

export function PageBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div data-page-body className={cn(PAGE_BODY, className)}>{children}</div>;
}

export const HostTabContext = createContext<{ hostTitle: string; tabLabel: string } | null>(null);
export const useHostTab = () => useContext(HostTabContext);

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

export function FilterBar({ children, actions, className }: { children?: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <div role="group" aria-label="Filters" data-filter-bar className={cn("flex flex-wrap items-center gap-2 rounded-lg border border-border/80 bg-card px-card py-2", className)}>
      {children}
      {actions && <div className={cn("flex flex-wrap items-center gap-1.5", children ? "ml-auto" : "")}>{actions}</div>}
    </div>
  );
}
