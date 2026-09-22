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
    <div className={cn("sticky top-0 z-20 -mx-3 -mt-3 mb-2 border-b border-border bg-card/95 backdrop-blur-md px-3 py-1.5 shadow-xs", className)}>
      <div className="flex items-center justify-between gap-3 flex-wrap min-h-9">
        <div className="flex items-center gap-2 min-w-0">
          <h1 className="text-lg font-bold tracking-tight text-foreground truncate">{title}</h1>
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
    <section className={cn("rounded-md border border-border bg-card overflow-hidden", className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-2 px-3 py-2 border-b border-border bg-muted/30">
          <div>
            {title && <h2 className="text-xs font-semibold tracking-wide text-foreground">{title}</h2>}
            {description && <p className="text-[10px] text-muted-foreground mt-0.5">{description}</p>}
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={cn("p-3", bodyClassName)}>{children}</div>
    </section>
  );
}
