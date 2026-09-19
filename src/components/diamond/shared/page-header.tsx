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
    <div className={cn("border-b border-border bg-card/40 px-4 py-3", className)}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h1 className="text-base font-semibold tracking-tight text-foreground truncate">{title}</h1>
          {subtitle && <p className="text-[11px] text-muted-foreground mt-0.5">{subtitle}</p>}
        </div>
        {(actions || meta) && (
          <div className="flex items-center gap-2 flex-wrap">
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
