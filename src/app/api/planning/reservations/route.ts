import { db } from "@/lib/db";
import { z } from "zod";
import { ok, num } from "@/lib/api-utils";
import { withApi, idSchema, paging, paged, log } from "@/lib/api/with-api";
import { conflict, notFound } from "@/lib/api/errors";

export const GET = withApi({ permission: "rough.read" }, async (_req, _ctx, api) => {
  const p = paging(api.url);
  const reservations = await db.roughReservation.findMany({
    include: { rough: true, planningCase: true },
    orderBy: { reservedAt: "desc" },
    skip: p.skip,
    take: p.take,
  });
  return ok(paged(
    reservations.map((r) => ({
      id: r.id,
      roughId: r.roughId,
      fantasyRoughId: r.rough?.fantasyRoughId,
      stoneName: r.rough?.stoneName,
      kapan: r.rough?.kapan,
      packet: r.rough?.packet,
      roughWeight: r.rough ? num(r.rough.roughWeight) : 0,
      status: r.status,
      reservedBy: r.reservedBy,
      reservedAt: r.reservedAt.toISOString(),
      releasedAt: r.releasedAt?.toISOString() ?? null,
      caseCode: r.planningCase?.caseCode ?? null,
      notes: r.notes,
    })),
    p,
  ));
});

const bodySchema = z.object({ roughId: idSchema, planningCaseId: idSchema.nullish() });
const UNRESERVABLE = ["RESERVED", "RELEASED_TO_MANUFACTURING"];

// Body: { roughId, planningCaseId? }. reservedBy is always the authenticated user.
export const POST = withApi({ permission: "rough.reserve", body: bodySchema }, async (_req, _ctx, api) => {
  const { roughId, planningCaseId } = api.body;
  const me = api.principal;

  const reservation = await db.$transaction(async (tx) => {
    const rough = await tx.roughStone.findUnique({ where: { id: roughId } });
    if (!rough) throw notFound("Rough");
    if (planningCaseId) {
      const pc = await tx.planningCase.findUnique({ where: { id: planningCaseId } });
      if (!pc) throw notFound("Planning case");
      if (pc.roughId !== roughId) throw conflict("CASE_ROUGH_MISMATCH", "That planning case is for a different rough stone.");
    }
    // Atomic claim: only one concurrent caller can flip the status.
    const claimed = await tx.roughStone.updateMany({
      where: { id: roughId, planningStatus: { notIn: UNRESERVABLE } },
      data: { planningStatus: "RESERVED" },
    });
    if (claimed.count !== 1) throw conflict("ROUGH_ALREADY_RESERVED", "CONFLICT: rough already reserved");
    // activeRoughKey is unique, so the database itself rejects a second active reservation.
    const created = await tx.roughReservation.create({
      data: { roughId, planningCaseId: planningCaseId ?? null, status: "RESERVED", reservedBy: me.username, reservedByUserId: me.userId, activeRoughKey: roughId },
    });
    await api.audit(tx, {
      action: "RESERVATION",
      entity: "RoughStone",
      entityId: roughId,
      before: { planningStatus: rough.planningStatus },
      after: { planningStatus: "RESERVED", reservationId: created.id },
      reason: "Planner reserved rough",
    });
    return created;
  }).catch((e) => {
    if (e?.code === "P2002") {
      log("warn", "reservation.conflict", { requestId: api.requestId, userId: me.userId, roughId });
      throw conflict("ROUGH_ALREADY_RESERVED", "CONFLICT: rough already reserved");
    }
    throw e;
  });

  return ok({ status: "RESERVED", reservationId: reservation.id });
});
