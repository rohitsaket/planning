import { db } from "@/lib/db";
import { withApi, qEnum, qStr } from "@/lib/api/with-api";
import { ApiError } from "@/lib/api/errors";
import { csvSafeCell, toCsv, type CsvColumn } from "@/lib/csv-export";
import { getISTDateString } from "@/lib/fantasy/time";
import { readStockoutSnapshotStatus, SORT_DIRECTIONS } from "@/lib/analysis/stockout";
import {
  EXCESS_EXPORT_ROW_LIMIT,
  EXCESS_SORTS,
  EXCESS_STATE_LABELS,
  readExcessForExport,
  type ExcessRow,
  type ExcessSortKey,
} from "@/lib/analysis/excess";
import { describeExcessFilters, parseExcessFilters } from "../route";

const COLUMNS: CsvColumn<ExcessRow>[] = [
  { key: "categoryId", header: "Category" },
  { key: "lab", header: "Lab", exportValue: (r) => r.lab ?? "" },
  { key: "shape", header: "Shape", exportValue: (r) => r.shape ?? "" },
  { key: "weightBand", header: "Weight Band", exportValue: (r) => r.weightBand ?? "" },
  { key: "sales90d", header: "Confirmed Sales 90D" },
  { key: "targetQuantity", header: "Target Quantity" },
  { key: "physicalAvailable", header: "Physical Available" },
  { key: "excessQuantity", header: "Excess Quantity" },
  { key: "memoQuantity", header: "Memo Advisory" },
  { key: "wipQuantity", header: "WIP Separate" },
  { key: "latestSaleDateIst", header: "Latest Confirmed Sale (IST)", exportValue: (r) => r.latestSaleDateIst ?? "" },
  { key: "excessState", header: "Excess State", exportValue: (r) => EXCESS_STATE_LABELS[r.excessState] },
  { key: "dataState", header: "Data State", exportValue: (r) => r.dataState.replace(/_/g, " ") },
];

export const GET = withApi(
  { permission: "analysis.export", scoped: true, rateLimit: { limit: 10, windowMs: 60_000 } },
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

    const filters = parseExcessFilters(url, api.scope);
    const sort = {
      key: qEnum(url, "sort", EXCESS_SORTS, "excess") as ExcessSortKey,
      dir: qEnum(url, "dir", SORT_DIRECTIONS, "desc"),
    };

    const { rows, total, truncated } = await readExcessForExport(status.runId, filters, sort);

    await api.audit(db, {
      action: "EXCESS_ANALYSIS_EXPORTED",
      entity: "DemandRun",
      entityId: status.runId,
      reason:
        `Excess categories exported: ${rows.length} of ${total} rows ` +
        `(${describeExcessFilters(filters).map((f) => `${f.key}=${f.value}`).join(", ") || "no filters"})` +
        `${truncated ? " — row limit reached" : ""}`,
    });

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
          "NOTICE: STALE - inventory has changed since this calculation. Run an authorized demand refresh to update the results.",
        ),
      );
    }
    if (status.reviewWarning) notices.push(csvSafeCell(`NOTICE: ${status.reviewWarning}`));
    if (truncated) {
      notices.push(
        csvSafeCell(
          `NOTICE: PARTIAL EXPORT - ${rows.length} of ${total} matching categories. This file stops at the ` +
            `${EXCESS_EXPORT_ROW_LIMIT} row limit. Narrow the lab, shape, weight band or state filter to export the rest.`,
        ),
      );
    }

    const body = [...notices, toCsv(COLUMNS, rows)].join("\r\n");
    const filename = `excess-stock-${status.sourceState === "SIMULATION" ? "simulated-" : ""}${status.businessDateIst ?? getISTDateString(new Date())}.csv`;

    return new Response(body, {
      status: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${filename}"`,
        "cache-control": "no-store",
        "x-excess-export-rows": String(rows.length),
        "x-excess-export-total": String(total),
        "x-excess-export-limit": String(EXCESS_EXPORT_ROW_LIMIT),
        "x-excess-export-truncated": String(truncated),
        "x-excess-export-simulated": String(status.sourceState === "SIMULATION"),
        "x-excess-export-stale": String(status.inventoryChangedSinceRun),
      },
    });
  },
);
