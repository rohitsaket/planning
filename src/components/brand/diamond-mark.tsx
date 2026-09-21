import type { SVGProps } from "react";

/**
 * The product mark: a brilliant-cut diamond in front elevation (table, crown,
 * girdle, pavilion). Same geometry as the favicon in `src/app/icon.svg`, so the
 * browser tab and the app header read as one brand — keep the two in step.
 *
 * Stroked in `currentColor` rather than filled, so it inherits theme colour and
 * sits consistently beside the lucide icons used throughout the navigation.
 */
export function DiamondMark({ strokeWidth = 2, ...props }: SVGProps<SVGSVGElement> & { strokeWidth?: number }) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinejoin="round"
      strokeLinecap="round"
      aria-hidden
      {...props}
    >
      <path d="M11 9h10l7 6-12 11L4 15z" />
      <path d="M4 15h24M11 9v6M21 9v6M11 15l5 11M21 15l-5 11" />
    </svg>
  );
}
