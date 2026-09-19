import { db } from "@/lib/db";
import { ok } from "@/lib/api-utils";
import { NextResponse } from "next/server";

// Mark a planning case as REPLAN_REQUIRED (e.g., actual output missed requirement category).
// Body: { reason: string, actor: string }
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const { reason, actor } = body;
  if (!reason || reason.trim().length < 5) {
    return NextResponse.json({ error: "Reason (min 5 chars) required" }, { status: 400 });
  }
  if (!actor) {
    return NextResponse.json({ error: "actor required" }, { status: 400 });
  }

  const before = await db.planningCase.findUnique({ where: { id } });
  if (!before) return NextResponse.json({ error: "Planning case not found" }, { status: 404 });

  // Bump version, mark previous version as superseded
  const newVersionNumber = before.currentVersion + 1;
  const updated = await db.planningCase.update({
    where: { id },
    data: {
      status: "REPLAN_REQUIRED",
      currentVersion: newVersionNumber,
      approvalComment: `[REPLAN by ${actor}] ${reason}`,
    },
  });

  await db.planVersion.create({
    data: {
      planningCaseId: id,
      versionNumber: newVersionNumber,
      reason,
      status: "DRAFT",
      createdBy: actor,
    },
  });

  await db.auditLog.create({
    data: {
      actor,
      action: "PLAN_REPLAN",
      entity: "PlanningCase",
      entityId: id,
      before: JSON.stringify({ status: before.status, version: before.currentVersion }),
      after: JSON.stringify({ status: "REPLAN_REQUIRED", version: newVersionNumber }),
      reason,
      timestamp: new Date(),
    },
  });

  return ok({
    id: updated.id,
    caseCode: updated.caseCode,
    status: updated.status,
    currentVersion: updated.currentVersion,
    auditLogged: true,
  });
}
