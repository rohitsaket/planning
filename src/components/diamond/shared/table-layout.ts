// A table's saved column layout: order, hidden columns and widths, kept per tableId in the
// browser. A convenience only — anything unreadable is ignored and the table falls back to
// its column definitions.

export interface SavedTableLayout {
  orderedKeys: string[];
  hiddenKeys: string[];
  colWidths: Record<string, number>;
}

export const tableLayoutStorageKey = (tableId: string) => `dt_layout_${tableId}`;

const EMPTY: SavedTableLayout = { orderedKeys: [], hiddenKeys: [], colWidths: {} };

/** Parses a stored layout, keeping only well-formed parts. */
export function parseTableLayout(raw: string | null): SavedTableLayout {
  if (!raw) return EMPTY;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return EMPTY;
  }
  if (!parsed || typeof parsed !== "object") return EMPTY;
  const value = parsed as Record<string, unknown>;
  const strings = (v: unknown) => (Array.isArray(v) ? v.filter((k): k is string => typeof k === "string") : []);
  const colWidths: Record<string, number> = {};
  if (value.colWidths && typeof value.colWidths === "object" && !Array.isArray(value.colWidths)) {
    for (const [key, width] of Object.entries(value.colWidths as Record<string, unknown>)) {
      if (typeof width === "number" && Number.isFinite(width) && width > 0) colWidths[key] = width;
    }
  }
  return { orderedKeys: strings(value.orderedKeys), hiddenKeys: strings(value.hiddenKeys), colWidths };
}

/** The saved layout for a table, or an empty one without a tableId or readable storage. */
export function readTableLayout(tableId: string | undefined): SavedTableLayout {
  if (!tableId || typeof window === "undefined") return EMPTY;
  try {
    return parseTableLayout(window.localStorage.getItem(tableLayoutStorageKey(tableId)));
  } catch {
    return EMPTY;
  }
}

/**
 * The column order to show: the user's order for columns that still exist, then any column
 * not in it, in definition order. Keys that no longer name a column are dropped.
 */
export function reconcileColumnOrder(userOrder: readonly string[], columnKeys: readonly string[]): string[] {
  const known = new Set(columnKeys);
  const kept = userOrder.filter((k, i) => known.has(k) && userOrder.indexOf(k) === i);
  const placed = new Set(kept);
  return [...kept, ...columnKeys.filter((k) => !placed.has(k))];
}
