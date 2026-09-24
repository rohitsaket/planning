import { db } from "@/lib/db";
import { withApi } from "@/lib/api/with-api";
import { ApiError } from "@/lib/api/errors";
import { toCsv, type CsvColumn } from "@/lib/csv-export";
import {
  CATEGORY_SORT_KEYS,
  SALES_DATA_STATE_LABELS,
  type CategorySalesRow,
  type CategorySortKey,
} from "@/lib/analytics/sales-history-contract";
import { EXPORT_ROW_LIMIT, getCategorySummaryForExport, resolveSalesSnapshot } from "@/lib/analytics/sales-history";
import { assertRequestedWindow, parseSalesFilters, parseSort } from "@/lib/analytics/sales-history-request";
import { withSalesScope } from "@/lib/analytics/sales-history";

/**
 * Sales Analysis — server-generated export of the category summary.
 *
 * The page pages its tables on the server, so a browser-side export of the loaded rows
 * would quietly export one page and call it the dataset. This route exports the same
 * snapshot, the same eligibility policy and the same filters the screen is showing,
 * bounded by an explicit row limit that is reported in the file rather than hidden.
 *
 * Reading sales on screen and taking a copy of them out of the application are separate
 * decisions, so this carries its own permission, and every export is audited.
 *
 * Values are serialised through the application-wide CSV policy, which neutralises
 * anything a spreadsheet would execute as a formula.
 */

const COLUMNS: CsvColumn<CategorySalesRow>[] = [
  { key: "categoryId", header: "Category" },
  { key: "lab", header: "Lab" },
  { key: "shape", header: "Shape" },
  { key: "weightBand", header: "Weight Band" },
  { key: "previous30Quantity", header: "Previous 30D Qty" },
  { key: "middle30Quantity", header: "Middle 30D Qty" },
  { key: "latest30Quantity", header: "Latest 30D Qty" },
  { key: "total90Quantity", header: "Confirmed Qty (window)" },
  { key: "total90Weight", header: "Confirmed Weight (ct)" },
  { key: "recordCount", header: "Sale Records" },
  { key: "latestSaleDate", header: "Latest Sale (IST)" },
  { key: "trend", header: "Trend" },
  { key: "dataState", header: "Data State", exportValue: (r) => SALES_DATA_STATE_LABELS[r.dataState] },
];

export const GET = withApi(
  { permission: "sales.export", scoped: true, rateLimit: { limit: 10, windowMs: 60_000 } },
  async (req: Request, _ctx, api) => {
    const url = new URL(req.url);
    const snapshot = await resolveSalesSnapshot();
    assertRequestedWindow(url, snapshot?.windowDays ?? null);
    if (!snapshot) {
      throw new ApiError(
        409,
        "SALES_SNAPSHOT_NOT_AVAILABLE",
        "No authoritative sales snapshot has completed, so there is nothing to export.",
      );
    }

    const filters = withSalesScope(parseSalesFilters(url, api.principal.permissions), api.scope);
    const sort = parseSort<CategorySortKey>(url, CATEGORY_SORT_KEYS, "total90", "desc");
    const { rows, total, truncated } = await getCategorySummaryForExport(snapshot, filters, sort);

    await api.audit(db, {
      action: "SALES_ANALYSIS_EXPORTED",
      entity: "DemandRun",
      entityId: snapshot.id,
      reason: `Category sales summary exported: ${rows.length} of ${total} rows${truncated ? " (row limit reached)" : ""}`,
    });

    const body = toCsv(COLUMNS, rows);
    const filename = `sales-category-summary-${snapshot.businessDateIst}.csv`;
    return new Response(body, {
      status: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${filename}"`,
        "cache-control": "no-store",
        // Partial results are declared in headers the client surfaces, never implied by
        // a short file. The row limit is a stated boundary, not a silent truncation.
        "x-sales-export-rows": String(rows.length),
        "x-sales-export-total": String(total),
        "x-sales-export-limit": String(EXPORT_ROW_LIMIT),
        "x-sales-export-truncated": String(truncated),
        "x-sales-snapshot-id": snapshot.id,
        "x-sales-snapshot-simulated": String(snapshot.isSimulated),
      },
    });
  },
);
