import { db } from "@/lib/db";
import { ok } from "@/lib/api-utils";
import { NextResponse } from "next/server";

// Override a requirement's priority (manual business-owned classification).
// Body: { priority: "CRITICAL"|"HIGH"|"NORMAL"|"LOW"|"WATCH", reason: string, actor: string }
// Audit logged. Reason is required.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const { priority, reason, actor } = body;
  if (!priority || !["CRITICAL", "HIGH", "NORMAL", "LOW", "WATCH"].includes(priority)) {
    return NextResponse.json({ error: "Valid priority required (CRITICAL|HIGH|NORMAL|LOW|WATCH)" }, { status: 400 });
  }
  if (!reason || reason.trim().length < 5) {
    return NextResponse.json({ error: "Reason (min 5 chars) required for audit" }, { status: 400 });
  }
  if (!actor) {
    return NextResponse.json({ error: "actor required" }, { status: 400 });
  }

  const before = await db.requirement.findUnique({ where: { id } });
  if (!before) return NextResponse.json({ error: "Requirement not found" }, { status: 404 });

  const updated = await db.requirement.update({
    where: { id },
    data: {
      requirementPriority: priority,
      priorityReason: `[MANUAL OVERRIDE by ${actor}] ${reason}`,
      updatedBy: actor,
    },
  });

  await db.auditLog.create({
    data: {
      actor,
      action: "REQUIREMENT_PRIORITY_OVERRIDE",
      entity: "Requirement",
      entityId: id,
      before: JSON.stringify({ priority: before.requirementPriority, reason: before.priorityReason }),
      after: JSON.stringify({ priority, reason }),
      reason,
      timestamp: new Date(),
    },
  });

  return ok({
    id: updated.id,
    requirementCode: updated.requirementCode,
    requirementPriority: updated.requirementPriority,
    priorityReason: updated.priorityReason,
    auditLogged: true,
  });
}
