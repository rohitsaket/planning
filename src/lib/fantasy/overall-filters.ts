/**
 * Filter parsing for canonical Fantasy lot records.
 *
 * The Overall Data list and its export must select the same rows: an export that quietly
 * ignores the country or lab the user filtered by hands them records outside the scope
 * they were looking at. The export previously read only two of the six parameters, so
 * the two endpoints are built from one parser here rather than each assembling its own
 * `where` clause.
 *
 * Every value is validated. An unrecognized `isCurrent` is refused rather than silently
 * treated as "all", because the difference between current stock and history is a
 * business distinction, not a display preference.
 *
 * Server-only.
 */

import { qStr } from "@/lib/api/with-api";
import { ApiError } from "@/lib/api/errors";

if (typeof window !== "undefined") {
  throw new Error("fantasy/overall-filters is server-only and must not be imported by client code.");
}

/**
 * Which slice of the lot history to read.
 *
 * `isCurrent` is the stored column name and is kept as the parameter name: it is the
 * established contract that existing links and bookmarks use, it is never shown to a
 * user as a label, and renaming it would break those links for no user-facing gain.
 */
const CURRENT_MODES = ["true", "false", "all"] as const;

export interface OverallLotFilters {
  isCurrent: boolean | null;
  status: string | null;
  shape: string | null;
  lab: string | null;
  country: string | null;
  branch: string | null;
  search: string | null;
}

export function parseOverallLotFilters(url: URL): OverallLotFilters {
  const rawCurrent = url.searchParams.get("isCurrent");
  if (rawCurrent !== null && rawCurrent !== "" && !(CURRENT_MODES as readonly string[]).includes(rawCurrent)) {
    throw new ApiError(
      400,
      "BAD_REQUEST",
      `Query parameter 'isCurrent' must be one of: ${CURRENT_MODES.join(", ")}.`,
    );
  }

  const normalize = (v: string | null) => (v && v !== "ALL" ? v : null);

  return {
    isCurrent: rawCurrent === "true" ? true : rawCurrent === "false" ? false : null,
    status: normalize(qStr(url, "status", 60)),
    shape: normalize(qStr(url, "shape", 60)),
    lab: normalize(qStr(url, "lab", 60)),
    country: normalize(qStr(url, "country", 60)),
    branch: normalize(qStr(url, "branch", 60)),
    search: qStr(url, "q", 120),
  };
}

/** The Prisma `where` clause for these filters. Both endpoints use this one builder. */
export function overallLotWhere(f: OverallLotFilters): Record<string, unknown> {
  const where: Record<string, unknown> = {};
  if (f.isCurrent !== null) where.isCurrent = f.isCurrent;
  if (f.status) where.currentStatus = f.status;
  if (f.shape) where.shapeNormalized = f.shape;
  if (f.lab) where.labNormalized = f.lab;
  if (f.country) where.country = f.country;
  if (f.branch) where.branch = f.branch;
  if (f.search) {
    where.OR = [
      { lotId: { contains: f.search, mode: "insensitive" } },
      { customerName: { contains: f.search, mode: "insensitive" } },
      { certificate: { contains: f.search, mode: "insensitive" } },
      { kapan: { contains: f.search, mode: "insensitive" } },
      { stoneName: { contains: f.search, mode: "insensitive" } },
    ];
  }
  return where;
}

/** Scope actually applied, for the audit record. Values only — never row contents. */
export function describeOverallLotFilters(f: OverallLotFilters): string {
  const parts: string[] = [];
  if (f.isCurrent !== null) parts.push(f.isCurrent ? "current only" : "history only");
  if (f.status) parts.push(`status=${f.status}`);
  if (f.shape) parts.push(`shape=${f.shape}`);
  if (f.lab) parts.push(`lab=${f.lab}`);
  if (f.country) parts.push(`country=${f.country}`);
  if (f.branch) parts.push(`branch=${f.branch}`);
  if (f.search) parts.push("search applied");
  return parts.length ? parts.join(", ") : "no filters";
}
