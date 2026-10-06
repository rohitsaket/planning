import type { SVGProps } from "react";

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
