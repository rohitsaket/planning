"use client";

import { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  meta?: ReactNode;
  className?: string;
}

export function PageHeader({ title, subtitle, actions, meta, className }: PageHeaderProps) {
  return (
    <div className={cn("sticky top-0 z-40 -mx-3 -mt-3 mb-3 border-b border-border bg-card/95 backdrop-blur-md px-4 sm:px-6 py-2.5 shadow-2xs", className)}>
      <div className="flex items-center justify-between gap-3 flex-wrap min-h-10">
        <div className="flex flex-col min-w-0">
          <h1 className="text-lg sm:text-xl font-bold tracking-tight text-foreground truncate">{title}</h1>
          {subtitle && <p className="text-xs text-muted-foreground mt-0.5 truncate">{subtitle}</p>}
        </div>
        {(actions || meta) && (
          <div className="flex items-center gap-2 flex-wrap ml-auto">
            {meta}
            {actions}
          </div>
        )}
      </div>
    </div>
  );
}

interface SectionProps {
  title?: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}

export function Section({ title, description, actions, children, className, bodyClassName }: SectionProps) {
  return (
    <section className={cn("rounded-2xl border border-border/80 bg-card shadow-[0_4px_20px_-4px_rgba(249,115,62,0.04)] overflow-hidden", className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border/70 bg-[#FAF7F4]/90 dark:bg-card/60 backdrop-blur-sm">
          <div>
            {title && <h2 className="text-sm font-bold tracking-tight text-foreground">{title}</h2>}
            {description && <p className="text-[11px] text-muted-foreground mt-0.5">{description}</p>}
          </div>
          {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
        </header>
      )}
      <div className={cn("p-4", bodyClassName)}>{children}</div>
    </section>
  );
}
