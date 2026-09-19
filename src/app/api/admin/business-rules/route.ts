import { db } from "@/lib/db";
import { ok } from "@/lib/api-utils";
import { z } from "zod";
import { withApi, idSchema } from "@/lib/api/with-api";
import { notFound } from "@/lib/api/errors";

export const GET = withApi({ permission: "business_rule.read" }, async () => {
  const rules = await db.businessRule.findMany({ orderBy: [{ status: "asc" }, { ruleId: "asc" }], take: 1000 });
  return ok({
    rows: rules.map((r) => ({
      id: r.id,
      ruleId: r.ruleId,
      domain: r.domain,
      name: r.name,
      version: r.version,
      effectiveDate: r.effectiveDate.toISOString(),
      status: r.status,
      configuration: safeJson(r.configuration),
      approvedBy: r.approvedBy,
      approvedAt: r.approvedAt?.toISOString() ?? null,
      notes: r.notes,
    })),
  });
});

function safeJson(v: string | null): unknown {
  if (!v) return null;
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
}


const bodySchema = z.object({
  id: idSchema,
  status: z.enum(["CONFIRMED", "PROPOSED", "OPEN", "DEPRECATED"]),
  notes: z.string().trim().max(1000).optional(),
});

// POST to update rule status. approvedBy / audit actor come from the session.
export const POST = withApi({ permission: "business_rule.manage", body: bodySchema }, async (_req, _ctx, api) => {
  const { id, status, notes } = api.body;
  const me = api.principal;
  const r = await db.$transaction(async (tx) => {
    const before = await tx.businessRule.findUnique({ where: { id } });
    if (!before) throw notFound("Business rule");
    const row = await tx.businessRule.update({
      where: { id },
      data: {
        status,
        approvedBy: status === "CONFIRMED" ? me.username : undefined,
        approvedAt: status === "CONFIRMED" ? new Date() : undefined,
        notes: notes ?? undefined,
      },
    });
    await api.audit(tx, {
      action: "RULE_CHANGE",
      entity: "BusinessRule",
      entityId: id,
      before: { ruleId: before.ruleId, version: before.version, status: before.status, notes: before.notes },
      after: { ruleId: row.ruleId, version: row.version, status: row.status, notes: row.notes },
      reason: `Status changed to ${status}`,
    });
    return row;
  });
  return ok({ id: r.id, status: r.status });
});
