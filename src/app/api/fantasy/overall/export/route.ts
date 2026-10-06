import { db } from "@/lib/db";
import { withApi } from "@/lib/api/with-api";
import { resolveFantasySourceStateWithHistory } from "@/lib/fantasy/config";
import { formatIST, getISTDateString } from "@/lib/fantasy/time";
import { num } from "@/lib/api-utils";
import { csvSafeCell, toCsv, type CsvColumn } from "@/lib/csv-export";
import {
  describeOverallLotFilters,
  overallLotWhere,
  parseOverallLotFilters,
} from "@/lib/fantasy/overall-filters";
import { resolveExportRowLimit } from "@/lib/config/export-limits";

export const OVERALL_EXPORT_LIMIT = resolveExportRowLimit("OVERALL_EXPORT_MAX_ROWS", 50_000);
export const OVERALL_EXPORT_ROW_LIMIT = OVERALL_EXPORT_LIMIT.rows;

const READ_BATCH = 2_000;

type LotRow = Awaited<ReturnType<typeof db.lotMasterRecord.findMany>>[number];

const COLUMNS: CsvColumn<LotRow>[] = [
  { key: "lotId", header: "Lot ID" },
  { key: "sourceType", header: "Source Type" },
  { key: "currentStatus", header: "Current Status" },
  { key: "previousStatus", header: "Previous Status", exportValue: (l) => l.previousStatus ?? "" },
  { key: "stockState", header: "Stock State", exportValue: (l) => (l.isCurrent ? "Current stock" : "History") },
  { key: "shape", header: "Shape" },
  { key: "weight", header: "Weight (ct)", exportValue: (l) => num(l.weight) },
  { key: "color", header: "Color", exportValue: (l) => l.color ?? "" },
  { key: "clarity", header: "Clarity", exportValue: (l) => l.clarity ?? "" },
  { key: "labNormalized", header: "Lab", exportValue: (l) => l.labNormalized ?? "" },
  { key: "certificate", header: "Certificate", exportValue: (l) => l.certificate ?? "" },
  { key: "customerName", header: "Customer Name", exportValue: (l) => l.customerName ?? "" },
  { key: "saleTotalUsd", header: "Sale Total (USD)", exportValue: (l) => (l.saleTotalUsd ? num(l.saleTotalUsd) : "") },
  { key: "departmentName", header: "Department", exportValue: (l) => l.departmentName ?? "" },
  { key: "locationName", header: "Location", exportValue: (l) => l.locationName ?? "" },
  { key: "branch", header: "Branch" },
  { key: "country", header: "Country" },
  { key: "removalReason", header: "Removal Reason", exportValue: (l) => l.removalReason ?? "" },
  { key: "removedFromLiveAt", header: "Removed At (IST)", exportValue: (l) => (l.removedFromLiveAt ? formatIST(l.removedFromLiveAt) : "") },
  { key: "docDate", header: "Doc Date (IST)", exportValue: (l) => formatIST(l.docDate, false) },
  { key: "firstSeenAt", header: "First Seen (IST)", exportValue: (l) => formatIST(l.firstSeenAt) },
  { key: "lastSeenAt", header: "Last Seen (IST)", exportValue: (l) => formatIST(l.lastSeenAt) },
  { key: "isSimulated", header: "Data Source", exportValue: (l) => (l.isSimulated ? "SIMULATED" : "LIVE") },
];

export const GET = withApi(
  { permission: "overall.export", rateLimit: { limit: 10, windowMs: 60_000 } },
  async (req: Request, _ctx, api) => {
    const url = new URL(req.url);
    const sourceState = await resolveFantasySourceStateWithHistory(db);

    const filters = parseOverallLotFilters(url);
    const where = overallLotWhere(filters);

    const total = await db.lotMasterRecord.count({ where });
    const exportCount = Math.min(total, OVERALL_EXPORT_ROW_LIMIT);
    const truncated = total > OVERALL_EXPORT_ROW_LIMIT;

    const lots: LotRow[] = [];
    while (lots.length < exportCount) {
      const batch = await db.lotMasterRecord.findMany({
        where,
        orderBy: [{ lastSeenAt: "desc" }, { id: "desc" }],
        skip: lots.length,
        take: Math.min(READ_BATCH, exportCount - lots.length),
      });
      if (batch.length === 0) break;
      lots.push(...batch);
    }

    await api.audit(db, {
      action: "OVERALL_DATA_EXPORTED",
      entity: "LotMasterRecord",
      entityId: `export-${getISTDateString(new Date())}`,
      reason: `Overall data exported: ${lots.length} of ${total} rows (${describeOverallLotFilters(filters)})${truncated ? " — row limit reached" : ""}`,
    });

    const notices: string[] = [];
    if (sourceState.isSimulated) {
      notices.push(csvSafeCell("NOTICE: SIMULATED / TEST FIXTURE DATA - DIAMOND PLANNING SYSTEM"));
      notices.push(csvSafeCell(`EXPORT GENERATED AT: ${formatIST(new Date())}`));
    }
    if (truncated) {
      notices.push(
        csvSafeCell(
          `NOTICE: PARTIAL EXPORT - ${lots.length} of ${total} matching records. ` +
            `This file stops at the ${OVERALL_EXPORT_ROW_LIMIT} row limit. Narrow the country, branch, lab or status filter to export the rest.`,
        ),
      );
    }

    const body = [...notices, toCsv(COLUMNS, lots)].join("\r\n");
    const filename = `overall-data-${sourceState.isSimulated ? "simulated-" : ""}${getISTDateString(new Date())}.csv`;

    return new Response(body, {
      status: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${filename}"`,
        "cache-control": "no-store",
        "x-overall-export-rows": String(lots.length),
        "x-overall-export-total": String(total),
        "x-overall-export-limit": String(OVERALL_EXPORT_ROW_LIMIT),
        "x-overall-export-truncated": String(truncated),
        "x-overall-export-simulated": String(sourceState.isSimulated),
      },
    });
  },
);
