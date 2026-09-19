// One CSV policy for the whole app: export business values (never rendered components)
// and neutralise anything a spreadsheet would execute as a formula.

export interface CsvColumn<T> {
  key: string;
  header: string;
  cell?: (row: T) => unknown;
  sortValue?: (row: T) => number | string;
  exportValue?: (row: T) => string | number | boolean | null | undefined;
}

const isPrimitive = (v: unknown): v is string | number | boolean => typeof v === "string" || typeof v === "number" || typeof v === "boolean";
const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/;
const FORMULA_TRIGGER = /^[\s]*[=+\-@\t\r]/;

// The value a column exports: explicit exportValue → primitive cell output → the row field
// named by `key` → sortValue. A React element is never stringified.
export function columnExportValue<T>(col: CsvColumn<T>, row: T): string | number | boolean | null {
  if (col.exportValue) return col.exportValue(row) ?? null;
  const rendered = col.cell?.(row);
  if (isPrimitive(rendered)) return rendered;
  const field = (row as Record<string, unknown>)[col.key];
  if (isPrimitive(field)) return field;
  if (field instanceof Date) return field.toISOString();
  const sort = col.sortValue?.(row);
  return isPrimitive(sort) ? sort : null;
}

// Text that starts with = + - @ TAB or CR is prefixed with an apostrophe so Excel, LibreOffice
// and Sheets treat it as text. Real numbers (typed or plain numeric strings) are left alone.
export function csvSafeCell(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return '""';
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : '""';
  let s = String(value);
  if (!PLAIN_NUMBER.test(s) && FORMULA_TRIGGER.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

export function toCsv<T>(columns: CsvColumn<T>[], rows: T[]): string {
  const lines = [columns.map((c) => csvSafeCell(c.header)).join(",")];
  for (const r of rows) lines.push(columns.map((c) => csvSafeCell(columnExportValue(c, r))).join(","));
  return lines.join("\r\n");
}
