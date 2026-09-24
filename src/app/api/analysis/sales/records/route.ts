import { ok } from "@/lib/api-utils";
import { withApi } from "@/lib/api/with-api";
import { RECORD_SORT_KEYS, type RecordSortKey } from "@/lib/analytics/sales-history-contract";
import { getSupportingRecords, resolveSalesSnapshot } from "@/lib/analytics/sales-history";
import { assertRequestedWindow, parseSalesFilters, parseSalesPaging, parseSort } from "@/lib/analytics/sales-history-request";
import { withSalesScope } from "@/lib/analytics/sales-history";

/**
 * Sales Analysis — the exact confirmed sale records behind a selected aggregate.
 *
 * Allowlisted business fields only. A raw Fantasy payload, a stored exclusion reason, a
 * free-text remark, an internal rule identifier and a calculation formula are all absent
 * by construction: the read service selects named columns and nothing else.
 *
 * Customer code and name are attached only for a principal holding customers.read.
 */
export const GET = withApi({ permission: "sales.read", scoped: true }, async (req: Request, _ctx, api) => {
  const url = new URL(req.url);
  const snapshot = await resolveSalesSnapshot();
  assertRequestedWindow(url, snapshot?.windowDays ?? null);
  if (!snapshot) return ok({ rows: [], paging: { page: 1, pageSize: 0, total: 0, hasMore: false }, snapshotId: null });

  const filters = withSalesScope(parseSalesFilters(url, api.principal.permissions), api.scope);
  const sort = parseSort<RecordSortKey>(url, RECORD_SORT_KEYS, "docDate", "desc");
  const result = await getSupportingRecords(snapshot, filters, sort, parseSalesPaging(url), {
    includeCustomer: api.principal.permissions.includes("customers.read"),
  });
  return ok({ ...result, snapshotId: snapshot.id });
});
