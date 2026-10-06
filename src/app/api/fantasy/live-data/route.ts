import { ok } from "@/lib/api-utils";
import { withApi, qEnum, qInt, qStr } from "@/lib/api/with-api";
import { badRequest } from "@/lib/api/errors";
import { listLiveLots } from "@/lib/fantasy/live-repository";
import { LIVE_LOT_FIELDS, LIVE_LOT_SORTABLE } from "@/lib/fantasy/live-fields";

export const GET = withApi({ permission: "fantasy.read" }, async (_req, _ctx, { url }) => {
  const page = qInt(url, "page", { def: 1, min: 1, max: 1_000_000 });
  const pageSize = qInt(url, "pageSize", { def: 100, min: 1, max: 500 });
  const sortBy = qStr(url, "sortBy", 60);
  if (sortBy && !LIVE_LOT_SORTABLE.has(sortBy)) throw badRequest("Unsupported sortBy column.");
  const date = (name: string) => {
    const v = qStr(url, name, 40);
    if (!v) return null;
    const d = new Date(v);
    if (isNaN(d.getTime())) throw badRequest(`Query parameter '${name}' must be a date.`);
    return d;
  };
  const onHoldRaw = qEnum(url, "onHold", ["true", "false", ""] as const, "");
  const includeStale = qEnum(url, "includeStale", ["true", "false"] as const, "false") === "true";
  const result = await listLiveLots({
    page, pageSize,
    q: qStr(url, "q", 100),
    lotStatusDb: qStr(url, "lotStatusDb"), processName: qStr(url, "processName"), shape: qStr(url, "shape"), color: qStr(url, "color", 40), clarity: qStr(url, "clarity", 40),
    labName: qStr(url, "labName"), departmentAccountName: qStr(url, "departmentAccountName"), companyId: qStr(url, "companyId"),
    onHold: onHoldRaw === "" ? null : onHoldRaw === "true",
    includeStale, dateFrom: date("dateFrom"), dateTo: date("dateTo"),
    sortBy, sortOrder: qEnum(url, "sortOrder", ["asc", "desc"] as const, "desc"),
  });
  const data = result.rows.map((r) => {
    const out: Record<string, unknown> = { id: r.id, sourceRecordKey: r.sourceRecordKey, sourceActive: r.sourceActive, staleSince: r.staleSince?.toISOString() ?? null, firstSeenAt: r.firstSeenAt.toISOString(), lastSeenAt: r.lastSeenAt.toISOString(), mappingWarnings: r.mappingWarnings.length };
    for (const f of LIVE_LOT_FIELDS) {
      const v = (r as Record<string, unknown>)[f.field];
      out[f.field] = v === null || v === undefined ? null : v instanceof Date ? v.toISOString() : f.type === "decimal" ? String(v) : v;
    }
    return out;
  });
  return ok({ data, page, pageSize, totalRecords: result.totalRecords, totalPages: result.totalPages });
});
