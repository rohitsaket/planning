import { db } from "@/lib/db";
import { ok } from "@/lib/api-utils";
import { NextResponse } from "next/server";

export async function GET() {
  const rules = await db.businessRule.findMany({ orderBy: [{ status: "asc" }, { ruleId: "asc" }] });
  return ok({
    rows: rules.map((r) => ({
      id: r.id,
      ruleId: r.ruleId,
      domain: r.domain,
      name: r.name,
      version: r.version,
      effectiveDate: r.effectiveDate.toISOString(),
      status: r.status,
      configuration: r.configuration ? JSON.parse(r.configuration) : null,
      approvedBy: r.approvedBy,
      approvedAt: r.approvedAt?.toISOString() ?? null,
      notes: r.notes,
    })),
  });
}

// POST to update rule status
export async function POST(req: Request) {
  const body = await req.json();
  const { id, status, approver, notes } = body;
  if (!id || !status) return NextResponse.json({ error: "id, status required" }, { status: 400 });
  const r = await db.businessRule.update({
    where: { id },
    data: {
      status,
      approvedBy: status === "CONFIRMED" ? approver : undefined,
      approvedAt: status === "CONFIRMED" ? new Date() : undefined,
      notes: notes ?? undefined,
    },
  });
  await db.auditLog.create({
    data: { actor: approver ?? "system", action: "RULE_CHANGE", entity: "BusinessRule", entityId: id, reason: `Status changed to ${status}` },
  });
  return ok({ id: r.id, status: r.status });
}
