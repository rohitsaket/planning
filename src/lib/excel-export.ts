import * as XLSX from "xlsx";

export interface ExcelColumn {
  header: string;
  key: string;
  format?: (value: any) => string | number;
}

export function exportToExcel(
  data: Record<string, unknown>[],
  columns: ExcelColumn[],
  filename: string,
  sheetName = "Sheet1"
): void {
  // Build the worksheet data with headers
  const headers = columns.map((c) => c.header);
  const rows = data.map((row) =>
    columns.map((c) => {
      const val = row[c.key];
      return c.format ? c.format(val) : (val ?? "");
    })
  );
  const wsData = [headers, ...rows];

  const ws = XLSX.utils.aoa_to_sheet(wsData);
  // Set column widths based on header length
  ws["!cols"] = columns.map((c) => ({ wch: Math.max(c.header.length + 2, 12) }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`);
}

// Convenience helper for the DataTable's exportable feature
export function exportDataTableToExcel<T>(
  rows: T[],
  columns: Array<{ header: string; key: string }>,
  filename: string
): void {
  exportToExcel(rows as Record<string, unknown>[], columns, filename);
}
