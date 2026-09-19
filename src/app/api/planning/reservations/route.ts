import { db } from "@/lib/db";
import { ok, num } from "@/lib/api-utils";

export async function GET() {
  const reservations = await db.roughReservation.findMany({
    include: { rough: true, planningCase: true },
    orderBy: { reservedAt: "desc" },
  });
  return ok({
    rows: reservations.map((r) => ({
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
  });
}

export async function POST(req: Request) {
  const body = await req.json();
  const { roughId, planningCaseId, reservedBy } = body;
  if (!roughId || !reservedBy) {
    return Response.json({ error: "roughId, reservedBy required" }, { status: 400 });
  }
  try {
    const result = await db.$transaction(async (tx) => {
      const rough = await tx.roughStone.findUnique({ where: { id: roughId } });
      if (!rough) throw new Error("Rough not found");
      if (rough.planningStatus === "RESERVED" || rough.planningStatus === "RELEASED_TO_MANUFACTURING") {
        throw new Error("CONFLICT: rough already reserved");
      }
      const updated = await tx.roughStone.update({
        where: { id: roughId },
        data: { planningStatus: "RESERVED" },
      });
      const reservation = await tx.roughReservation.create({
        data: {
          roughId,
          planningCaseId: planningCaseId ?? null,
          status: "RESERVED",
          reservedBy,
        },
      });
      await tx.auditLog.create({
        data: { actor: reservedBy, action: "RESERVATION", entity: "RoughStone", entityId: roughId, reason: "Planner reserved rough" },
      });
      return { reservation, rough: updated };
    });
    return ok({ status: "RESERVED", reservationId: result.reservation.id });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    const status = msg.includes("CONFLICT") ? 409 : 400;
    return Response.json({ error: msg }, { status });
  }
}
