import { NextResponse } from "next/server";
import { withApi, idSchema, qEnum, qInt, qStr } from "@/lib/api/with-api";
import { badRequest, notFound } from "@/lib/api/errors";
import { SARIN_VALIDATION_ISSUE_STATUSES, SARIN_VALIDATION_SEVERITIES } from "@/lib/sarin/domain";
import { SARIN_ISSUE_CATALOG } from "@/lib/sarin/issue-catalog";
import { listValidationIssues, SARIN_ISSUE_PAGE } from "@/lib/sarin/validation-queries";

const CODES = Object.keys(SARIN_ISSUE_CATALOG);

// One page of an import's validation findings, in the order they were raised. Defaults to
// the latest completed attempt. Scoped in the query (404 outside it).
export const GET = withApi<{ batchId: string }>({ permission: "sarin.import.read" }, async (_req, { params }, api) => {
  const batchId = idSchema.parse((await params).batchId);
  const url = api.url;
  const attempt = url.searchParams.get("attempt") ? qInt(url, "attempt", { def: 1, min: 1, max: 1_000_000 }) : null;
  const severity = url.searchParams.get("severity") ? qEnum(url, "severity", SARIN_VALIDATION_SEVERITIES, "BLOCKING") : null;
  const status = url.searchParams.get("status") ? qEnum(url, "status", SARIN_VALIDATION_ISSUE_STATUSES, "OPEN") : null;
  const code = qStr(url, "code", 64);
  if (code !== null && !CODES.includes(code)) throw badRequest("Query parameter 'code' is not a known finding code.");
  const page = qInt(url, "page", { def: 1, min: 1, max: 1_000_000 });
  const pageSize = qInt(url, "pageSize", { def: SARIN_ISSUE_PAGE.default, min: 1, max: SARIN_ISSUE_PAGE.max });
  const result = await listValidationIssues(api.scope, batchId, { attempt, severity, status, code }, { page, pageSize });
  if (!result) throw notFound("Sarin import");
  return NextResponse.json(result);
});
