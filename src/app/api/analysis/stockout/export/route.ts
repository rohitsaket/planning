import { db } from "@/lib/db";
import { withApi, qEnum, qStr } from "@/lib/api/with-api";
import { ApiError } from "@/lib/api/errors";
import { csvSafeCell, toCsv, type CsvColumn } from "@/lib/csv-export";
import { getISTDateString } from "@/lib/fantasy/time";
import {
  SORT_DIRECTIONS,
  STOCKOUT_EXPORT_ROW_LIMIT,
  STOCKOUT_SORTS,
  STOCKOUT_STATE_LABELS,
  readStockoutForExport,
  readStockoutSnapshotStatus,
  type StockoutRow,
  type StockoutSortKey,
} from "@/lib/analysis/stockout";
import { describeFilters, parseFilters } from "../route";

/**
 * STOCKOUT EXPORT — the visible table, as a business CSV.
 *
 * Same run, same filters and same ordering as the table, so a file cannot disagree with
 * the screen it was taken from. Approved business fields only: no rule identifier, no
 * mapping fingerprint, no batch id, no checkpoint, no source table and no internal row
 * id. The run date and source state are carried because a recipient needs to know which
 * calculation the numbers came from.
 */

const COLUMNS: CsvColumn<StockoutRow>[] = [
  { key: "categoryId", header: "Category" },
  { key: "lab", header: "Lab", exportValue: (r) => r.lab ?? "" },
  { key: "shape", header: "Shape", exportValue: (r) => r.shape ?? "" },
  { key: "weightBand", header: "Weight Band", exportValue: (r) => r.weightBand ?? "" },
  { key: "sales90d", header: "Confirmed Sales 90D" },
  { key: "targetQuantity", header: "Target Quantity" },
  { key: "physicalAvailable", header: "Physical Available" },
  { key: "physicalShortage", header: "Physical Shortage" },
  { key: "memoQuantity", header: "Memo Advisory" },
  { key: "wipQuantity", header: "WIP Separate" },
  { key: "stockoutState", header: "Stockout State", exportValue: (r) => STOCKOUT_STATE_LABELS[r.stockoutState] },
  { key: "dataState", header: "Data State", exportValue: (r) => r.dataState.replace(/_/g, " ") },
];

export const GET = withApi(
  { permission: "analysis.export", rateLimit: { limit: 10, windowMs: 60_000 } },
  async (req: Request, _ctx, api) => {
    const url = new URL(req.url);
    const status = await readStockoutSnapshotStatus(undefined, qStr(url, "runId", 64));

    if (!status.hasRun || !status.runId) {
      throw new ApiError(
        409,
        "DEMAND_SNAPSHOT_NOT_AVAILABLE",
        "No completed 90-day demand calculation is available, so there is nothing to export.",
      );
    }

    const filters = parseFilters(url);
    const sort = {
      key: qEnum(url, "sort", STOCKOUT_SORTS, "physicalShortage") as StockoutSortKey,
      dir: qEnum(url, "dir", SORT_DIRECTIONS, "desc"),
    };

    const { rows, total, truncated } = await readStockoutForExport(status.runId, filters, sort);

    await api.audit(db, {
      action: "STOCKOUT_ANALYSIS_EXPORTED",
      entity: "DemandRun",
      entityId: status.runId,
      reason:
        `Stockout categories exported: ${rows.length} of ${total} rows ` +
        `(${describeFilters(filters).map((f) => `${f.key}=${f.value}`).join(", ") || "no filters"})` +
        `${truncated ? " — row limit reached" : ""}`,
    });

    // Notices precede the header row, so a recipient who opens only the file still learns
    // the source state and whether the file is the whole result.
    const notices: string[] = [
      csvSafeCell(
        `SOURCE: ${status.sourceLabel} - demand calculation of ${status.runCompletedIst ?? "unknown date"}, ${status.periodLabel}`,
      ),
    ];
    if (status.sourceState === "SIMULATION") {
      notices.push(csvSafeCell("NOTICE: SIMULATED / TEST FIXTURE DATA - DIAMOND PLANNING SYSTEM"));
    }
    if (status.inventoryChangedSinceRun) {
      notices.push(
        csvSafeCell(
          "NOTICE: STALE - inventory has changed since this shortage calculation. Run an authorized demand refresh to update the results.",
        ),
      );
    }
    if (status.reviewWarning) {
      notices.push(csvSafeCell(`NOTICE: ${status.reviewWarning}`));
    }
    if (truncated) {
      notices.push(
        csvSafeCell(
          `NOTICE: PARTIAL EXPORT - ${rows.length} of ${total} matching categories. This file stops at the ` +
            `${STOCKOUT_EXPORT_ROW_LIMIT} row limit. Narrow the lab, shape, weight band or state filter to export the rest.`,
        ),
      );
    }

    const body = [...notices, toCsv(COLUMNS, rows)].join("\r\n");
    const filename = `stockout-${status.sourceState === "SIMULATION" ? "simulated-" : ""}${status.businessDateIst ?? getISTDateString(new Date())}.csv`;

    return new Response(body, {
      status: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${filename}"`,
        "cache-control": "no-store",
        // Partial results are declared, never implied by a short file.
        "x-stockout-export-rows": String(rows.length),
        "x-stockout-export-total": String(total),
        "x-stockout-export-limit": String(STOCKOUT_EXPORT_ROW_LIMIT),
        "x-stockout-export-truncated": String(truncated),
        "x-stockout-export-simulated": String(status.sourceState === "SIMULATION"),
        "x-stockout-export-stale": String(status.inventoryChangedSinceRun),
      },
    });
  },
);
