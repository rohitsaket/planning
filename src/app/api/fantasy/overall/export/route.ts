import { db } from "@/lib/db";
import { withApi, qStr } from "@/lib/api/with-api";
import { getFantasyConfig } from "@/lib/fantasy/config";
import { formatIST } from "@/lib/fantasy/time";
import { num } from "@/lib/api-utils";

export const GET = withApi({ permission: "overall.export" }, async (req: Request) => {
  const url = new URL(req.url);
  const config = getFantasyConfig();

  const isCurrentParam = qStr(url, "isCurrent");
  const status = qStr(url, "status");

  const where: Record<string, unknown> = {};
  if (isCurrentParam === "true") where.isCurrent = true;
  else if (isCurrentParam === "false") where.isCurrent = false;
  if (status && status !== "ALL") where.currentStatus = status;

  const lots = await db.lotMasterRecord.findMany({
    where,
    orderBy: { lastSeenAt: "desc" },
    take: 5000,
  });

  const headers = [
    "Lot ID",
    "Source Type",
    "Current Status",
    "Previous Status",
    "Is Current Live",
    "Shape",
    "Weight (ct)",
    "Color",
    "Clarity",
    "Lab",
    "Certificate",
    "Customer Name",
    "Sale Total (USD)",
    "Department",
    "Location",
    "Branch",
    "Country",
    "Removal Reason",
    "Removed At (IST)",
    "Doc Date (IST)",
    "First Seen (IST)",
    "Last Seen (IST)",
    "Version",
    "Batch ID",
    "Checkpoint",
    "Simulation Flag",
  ];

  const csvRows: string[] = [];

  // Add watermarking header for simulated data
  if (config.isSimulation) {
    csvRows.push("# NOTICE: SIMULATED / TEST FIXTURE DATA - DIAMOND PLANNING SYSTEM");
    csvRows.push(`# EXPORT GENERATED AT: ${formatIST(new Date())}`);
  }

  csvRows.push(headers.map((h) => `"${h}"`).join(","));

  for (const l of lots) {
    const row = [
      l.lotId,
      l.sourceType,
      l.currentStatus,
      l.previousStatus ?? "",
      l.isCurrent ? "YES" : "NO",
      l.shape,
      num(l.weight).toString(),
      l.color ?? "",
      l.clarity ?? "",
      l.labNormalized ?? "",
      l.certificate ?? "",
      l.customerName ?? "",
      l.saleTotalUsd ? num(l.saleTotalUsd).toString() : "",
      l.departmentName ?? "",
      l.locationName ?? "",
      l.branch,
      l.country,
      l.removalReason ?? "",
      l.removedFromLiveAt ? formatIST(l.removedFromLiveAt) : "",
      formatIST(l.docDate, false),
      formatIST(l.firstSeenAt),
      formatIST(l.lastSeenAt),
      l.currentVersion.toString(),
      l.lastSyncBatchId,
      l.checkpoint.toString(),
      l.isSimulated ? "SIMULATED" : "LIVE",
    ];
    csvRows.push(row.map((val) => `"${String(val).replace(/"/g, '""')}"`).join(","));
  }

  const csvContent = csvRows.join("\r\n");

  return new Response(csvContent, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="overall-data-${config.isSimulation ? "simulated-" : ""}export.csv"`,
      "Cache-Control": "no-store",
    },
  });
});
