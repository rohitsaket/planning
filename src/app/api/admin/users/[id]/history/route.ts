import { db } from "@/lib/db";
import { ok } from "@/lib/api-utils";
import { notFound } from "@/lib/api/errors";
import { withApi, idSchema, qInt } from "@/lib/api/with-api";

/**
 * Access history for one account: who changed its roles, scope or status, when, and from
 * what to what. Read from the immutable audit log. Only the fields that describe the
 * access change are returned — never the raw audit payload, session or network details.
 */

const ACCESS_ACTIONS = ["USER_CREATED", "USER_ROLE_CHANGE", "USER_ACCESS_SCOPE_CHANGE", "USER_STATUS_CHANGE", "USER_PASSWORD_RESET"] as const;
type AccessAction = (typeof ACCESS_ACTIONS)[number];

interface AccessSnapshot {
  roles?: string[];
  status?: string;
  countries?: string[];
  labs?: string[];
}

const strings = (v: unknown): string[] | undefined => (Array.isArray(v) && v.every((x) => typeof x === "string") ? (v as string[]) : undefined);

/** Picks the access-describing fields out of a stored audit snapshot; everything else is dropped. */
function snapshot(raw: string | null): AccessSnapshot | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const o = parsed as Record<string, unknown>;
  const scope = o.scope && typeof o.scope === "object" ? (o.scope as Record<string, unknown>) : o;
  const out: AccessSnapshot = {
    roles: strings(o.roles) ?? (typeof o.role === "string" ? [o.role] : undefined),
    status: typeof o.status === "string" ? o.status : undefined,
    countries: strings(scope.countries),
    labs: strings(scope.labs),
  };
  return Object.values(out).some((v) => v !== undefined) ? out : null;
}

export const GET = withApi({ permission: "user.read" }, async (_req: Request, { params }: { params: Promise<{ id: string }> }, api) => {
  const id = idSchema.parse((await params).id);
  if (!(await db.user.findUnique({ where: { id }, select: { id: true } }))) throw notFound("User");
  const pageSize = qInt(api.url, "pageSize", { def: 25, min: 1, max: 100 });
  const page = qInt(api.url, "page", { def: 1, min: 1, max: 10_000 });

  const rows = await db.auditLog.findMany({
    where: { entity: "User", entityId: id, action: { in: [...ACCESS_ACTIONS] } },
    orderBy: { timestamp: "desc" },
    skip: (page - 1) * pageSize,
    take: pageSize + 1,
    select: { action: true, actor: true, timestamp: true, before: true, after: true, reason: true, outcome: true },
  });
  const hasMore = rows.length > pageSize;
  // Scope-change rows record a reason; other reasons may hold operator free text about
  // the person, so only the scope reason (which the API requires and describes the grant) is shown.
  return ok({
    rows: rows.slice(0, pageSize).map((r) => ({
      action: r.action as AccessAction,
      actor: r.actor,
      at: r.timestamp.toISOString(),
      outcome: r.outcome ?? "SUCCESS",
      before: snapshot(r.before),
      after: snapshot(r.after),
      reason: r.action === "USER_ACCESS_SCOPE_CHANGE" ? r.reason : null,
    })),
    page,
    pageSize,
    hasMore,
  });
});
