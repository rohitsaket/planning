import * as XLSX from "xlsx";
import { inspectXlsxContainer, WORKBOOK_LIMITS } from "@/lib/domain/workbook-guard";

export interface ParsedLiveExport {
  rows: Record<string, unknown>[];
  headers: string[];
  sheetName: string | null;
  format: "xlsx" | "csv";
  totalRows: number;
}

export type ParseFailure = { ok: false; status: 400 | 413; message: string };

const MAX_CSV_BYTES = 25 * 1024 * 1024;

export function parseLiveExport(buffer: ArrayBuffer, fileName: string): ({ ok: true } & ParsedLiveExport) | ParseFailure {
  const lower = fileName.toLowerCase();
  const isCsv = lower.endsWith(".csv") || lower.endsWith(".txt");
  const isXlsx = lower.endsWith(".xlsx");
  if (!isCsv && !isXlsx) return { ok: false, status: 400, message: "Only .xlsx or .csv exports are accepted." };

  let workbook: XLSX.WorkBook;
  if (isXlsx) {
    const guard = inspectXlsxContainer(buffer);
    if (!guard.ok) return guard;
    try {
      workbook = XLSX.read(buffer, { type: "array", sheetRows: WORKBOOK_LIMITS.maxRows + 1, cellFormula: false, cellHTML: false, cellStyles: false, bookVBA: false, bookFiles: false, cellDates: true });
    } catch {
      return { ok: false, status: 400, message: "The file is not a readable .xlsx workbook." };
    }
  } else {
    if (buffer.byteLength > MAX_CSV_BYTES) return { ok: false, status: 413, message: "CSV exceeds the 25MB limit." };
    let text = new TextDecoder("utf-8").decode(buffer);
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    try {
      workbook = XLSX.read(text, { type: "string", sheetRows: WORKBOOK_LIMITS.maxRows + 1, raw: true, cellDates: false });
    } catch {
      return { ok: false, status: 400, message: "The file is not a readable CSV." };
    }
  }
  if (workbook.SheetNames.length === 0) return { ok: false, status: 400, message: "The export has no sheets." };
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const ref = (sheet["!fullref"] as string | undefined) ?? sheet["!ref"];
  if (!ref) return { ok: false, status: 400, message: "The first sheet is empty." };
  const range = XLSX.utils.decode_range(ref);
  if (range.e.r + 1 > WORKBOOK_LIMITS.maxRows) return { ok: false, status: 413, message: `The export has more than ${WORKBOOK_LIMITS.maxRows} rows; split it.` };
  if (range.e.c + 1 > WORKBOOK_LIMITS.maxColumns) return { ok: false, status: 400, message: `The export has more than ${WORKBOOK_LIMITS.maxColumns} columns.` };

  const table: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false, defval: null, raw: true });
  if (table.length === 0) return { ok: false, status: 400, message: "The first sheet is empty." };
  const headers = (table[0] ?? []).map((h) => (h === null || h === undefined ? "" : String(h).trim()));
  if (headers.filter(Boolean).length === 0) return { ok: false, status: 400, message: "The first row holds no column headers." };
  const rows: Record<string, unknown>[] = [];
  for (let i = 1; i < table.length; i++) {
    const line = table[i] ?? [];
    const row: Record<string, unknown> = {};
    let any = false;
    headers.forEach((h, c) => {
      if (!h) return;
      const v = line[c];
      const val = v instanceof Date ? v.toISOString() : v;
      row[h] = val === undefined ? null : val;
      if (val !== null && val !== undefined && val !== "") any = true;
    });
    if (any) rows.push(row);
  }
  return { ok: true, rows, headers: headers.filter(Boolean), sheetName, format: isXlsx ? "xlsx" : "csv", totalRows: rows.length };
}
