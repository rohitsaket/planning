import { clsx, type ClassValue } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

// The density tokens (src/app/globals.css) are spacing values too, so an explicit size passed
// by a page — `h-8` over a component's `h-control` — replaces the default instead of both
// classes applying.
const twMerge = extendTailwindMerge({
  extend: { theme: { spacing: ["page-x", "page-y", "section", "card", "control", "row", "tab", "bar", "nav-row", "sidebar"] } },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
