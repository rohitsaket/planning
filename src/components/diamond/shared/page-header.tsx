"use client";

import { ReactNode, useState } from "react";
import { cn } from "@/lib/utils";
import { BOUNDED_REGION_MAX_HEIGHT, SectionContext, useHostTab } from "./density";

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  meta?: ReactNode;
  className?: string;
}

/**
 * One concise header per page: title, an optional one-line description, and actions on the
 * same row where they fit.
 *
 * Inside a tabbed host the host already shows the page title and the tab label, so this
 * renders only what it adds — its description, metadata and actions — as a slim row, and
 * shows its title (as a sub-heading) only when it says something the tab label does not.
 */
export function PageHeader({ title, subtitle, actions, meta, className }: PageHeaderProps) {
  const host = useHostTab();

  if (host) {
    const showTitle = title !== host.tabLabel && title !== host.hostTitle;
    if (!showTitle && !subtitle && !actions && !meta) return null;
    return (
      <div data-page-header="embedded" className={cn("flex flex-wrap items-center gap-x-3 gap-y-1.5", className)}>
        <div className="min-w-0 flex-1">
          {showTitle && <h2 className="truncate text-sm font-semibold text-foreground">{title}</h2>}
          {subtitle && <p className="truncate text-xs text-muted-foreground" title={subtitle}>{subtitle}</p>}
        </div>
        {(actions || meta) && <div className="ml-auto flex flex-wrap items-center gap-1.5">{meta}{actions}</div>}
      </div>
    );
  }

  return (
    <div
      data-page-header="page"
      className={cn("sticky top-0 z-30 -mx-page-x -mt-page-y border-b border-border/80 bg-white/95 dark:bg-[#131720]/95 px-page-x py-2 backdrop-blur-md shadow-2xs", className)}
    >
      <div className="flex min-h-control flex-wrap items-center gap-x-3 gap-y-1.5">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-semibold tracking-tight text-foreground">{title}</h1>
          {subtitle && <p className="truncate text-xs text-muted-foreground" title={subtitle}>{subtitle}</p>}
        </div>
        {(actions || meta) && <div className="ml-auto flex flex-wrap items-center gap-1.5">{meta}{actions}</div>}
      </div>
    </div>
  );
}

interface SectionProps {
  title?: ReactNode;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  /**
   * "flow" (default): grows with its content; the page scrolls.
   * "bounded": the body scrolls inside a viewport-aware height, for a long list that sits
   * beside other panels. The body is then a focusable, named region for keyboard scrolling,
   * and reaching either end hands the gesture back to the page.
   */
  layout?: "flow" | "bounded";
}

/**
 * The shared panel: a subtle border, a slim header with actions on the same row, and a
 * compact body. A table placed at the edge of the default body runs flush to the panel
 * border instead of drawing a second card inside it.
 *
 * A Section grows with its content and never hides it: the page scrolls. Only a panel that
 * asks for `layout="bounded"` scrolls its body, and a table that needs its own scroll area
 * says so itself (DataTable `scroll="bounded"`).
 * `overflow-clip` only trims children to the rounded corners; unlike `overflow-hidden` it
 * does not make the section a scroll container, so sticky content still sticks to the page.
 */
export function Section({ title, description, actions, children, className, bodyClassName, layout = "flow" }: SectionProps) {
  const [headerSlot, setHeaderSlot] = useState<HTMLDivElement | null>(null);
  const hasHeader = Boolean(title || actions);

  return (
    <section data-section className={cn("flex flex-col overflow-clip rounded-xl border border-border/80 bg-white dark:bg-card shadow-2xs", className)}>
      {hasHeader && (
        <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 border-b border-border/70 bg-muted/40 backdrop-blur-xs px-card py-1.5 flex-shrink-0">
          <div className="min-w-0 flex items-center gap-2">
            {typeof title === "string" ? (
              <h2 className="text-[13px] font-semibold tracking-tight text-foreground">{title}</h2>
            ) : (
              title
            )}
            {description && <p className="text-xs text-muted-foreground">{description}</p>}
          </div>
          <div className="flex flex-wrap items-center gap-1.5 ml-auto">
            {actions}
            <div ref={setHeaderSlot} className="flex flex-wrap items-center gap-1.5 empty:hidden" />
          </div>
        </header>
      )}
      <SectionContext.Provider value={{ inSection: true, hasHeader, headerSlot }}>
        <div
          className={cn(
            bodyClassName ??
              "p-card [&>[data-table-root]]:-mx-card [&>[data-table-root]:first-child]:-mt-card [&>[data-table-root]:last-child]:-mb-card",
            layout === "bounded" && "overflow-y-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
          )}
          {...(layout === "bounded"
            ? { tabIndex: 0, role: "region", "aria-label": typeof title === "string" ? title : "Panel", style: { maxHeight: BOUNDED_REGION_MAX_HEIGHT } }
            : {})}
        >
          {children}
        </div>
      </SectionContext.Provider>
    </section>
  );
}
