// Sales Analysis definitions shared by the API and the page (no server-only imports).

export const SALES_DIMENSIONS = [
  { value: "lab", label: "Lab", plural: "Labs" },
  { value: "shape", label: "Shape", plural: "Shapes" },
  { value: "weightBand", label: "Weight Band", plural: "Weight Bands" },
  { value: "color", label: "Color", plural: "Colors" },
  { value: "clarity", label: "Clarity", plural: "Clarities" },
  { value: "treatment", label: "Treatment", plural: "Treatments" },
  { value: "customer", label: "Customer", plural: "Customers" },
  { value: "country", label: "Country", plural: "Countries" },
  { value: "branch", label: "Branch", plural: "Branches" },
  { value: "month", label: "Month", plural: "Months" },
] as const;

export type SalesDimension = (typeof SALES_DIMENSIONS)[number]["value"];
export const DEFAULT_SALES_DIMENSION: SalesDimension = "shape";

export function isSalesDimension(v: string): v is SalesDimension {
  return SALES_DIMENSIONS.some((d) => d.value === v);
}

/** Permissions required on top of `sales.read`. Customer rows expose customer names and revenue. */
export function extraPermissionsFor(dimension: SalesDimension): string[] {
  return dimension === "customer" ? ["customers.read"] : [];
}

export function dimensionsAllowed(permissions: readonly string[]) {
  return SALES_DIMENSIONS.filter((d) => extraPermissionsFor(d.value).every((p) => permissions.includes(p)));
}

export interface SalesGroupRow {
  dimension: string;
  pieces: number;
  carats: number;
  value: number;
  avgPerCt: number;
  pct: number; // value mix % (group value / total value × 100)
}

export const CHART_CAP = 12;

/** The pieces chart ranks by pieces (ties: value, then name) — never by value alone. */
export function chartRowsByPieces<T extends Pick<SalesGroupRow, "dimension" | "pieces" | "value">>(rows: T[], cap = CHART_CAP): T[] {
  return [...rows]
    .sort((a, b) => b.pieces - a.pieces || b.value - a.value || String(a.dimension).localeCompare(String(b.dimension)))
    .slice(0, cap);
}

/** "Top 10 Shapes by Pieces" — N is the number of bars actually shown. */
export function chartTitle(dimension: SalesDimension, displayed: number): string {
  const d = SALES_DIMENSIONS.find((x) => x.value === dimension)!;
  return `Top ${displayed} ${displayed === 1 ? d.label : d.plural} by Pieces`;
}
