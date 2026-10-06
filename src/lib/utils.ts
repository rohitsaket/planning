import { clsx, type ClassValue } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

const twMerge = extendTailwindMerge({
  extend: { theme: { spacing: ["page-x", "page-y", "section", "card", "control", "row", "tab", "bar", "nav-row", "sidebar"] } },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
