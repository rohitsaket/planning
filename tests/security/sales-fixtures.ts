// Deterministic Sales Analysis fixtures for the throwaway test database only.
import { db } from "./helpers";

export async function resetSales() {
  await db.$executeRawUnsafe(`TRUNCATE "SalesRecord", "MemoRecord", "SalesOrderLine", "SalesOrder", "Customer" CASCADE`);
}

let seq = 0;
export interface SaleInput {
  docDate: string | Date;
  status?: "Invoice" | "Memo" | "Stock";
  shape?: string;
  weight?: number;
  value?: number | null;
  qty?: number;
  lab?: string | null;
  country?: string;
  branch?: string;
  customerId?: string;
  weightBandId?: string | null;
  color?: string | null;
}

export async function customer(code: string, name: string, country = "IN", branch = "SRT") {
  return db.customer.create({ data: { customerCode: `${code}-${Date.now()}-${seq++}`, name, country, branch } });
}

export async function sales(customerId: string, rows: SaleInput[]) {
  await db.salesRecord.createMany({
    data: rows.map((r) => ({
      lotId: `LOT-T-${Date.now()}-${seq++}`,
      docDate: new Date(r.docDate),
      lotStatusDb: r.status ?? "Invoice",
      shape: r.shape ?? "Round",
      weight: r.weight ?? 1,
      saleTotalUsd: r.value === undefined ? 1000 : r.value,
      qty: r.qty ?? 1,
      labNormalized: r.lab === undefined ? "GIA" : r.lab,
      country: r.country ?? "IN",
      branch: r.branch ?? "SRT",
      customerId: r.customerId ?? customerId,
      weightBandId: r.weightBandId ?? null,
      color: r.color ?? null,
    })),
  });
}

export const repeat = <T,>(n: number, row: T): T[] => Array.from({ length: n }, () => row);
