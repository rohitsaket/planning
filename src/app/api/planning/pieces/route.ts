import { db } from "@/lib/db";
import { ok, num } from "@/lib/api-utils";
import { withApi, qStr } from "@/lib/api/with-api";

// Planned Pieces — searchable list of all planned pieces
export const GET = withApi({ permission: "plan.read" }, async (req: Request) => {
  const url = new URL(req.url);
  const fulfilledOnly = qStr(url, "fulfilled") === "true";
  const shape = qStr(url, "shape");

  const where: Record<string, unknown> = {};
  if (fulfilledOnly) where.fulfilled = true;
  if (shape) where.expectedShape = shape;

  const pieces = await db.planOptionPiece.findMany({
    where,
    include: { planOption: { include: { version: { include: { planningCase: true } } } } },
    take: 500,
    orderBy: { pieceCode: "asc" },
  });

  return ok({
    rows: pieces.map((p) => ({
      id: p.id,
      pieceCode: p.pieceCode,
      sequence: p.sequence,
      caseCode: p.planOption.version.planningCase.caseCode,
      caseStatus: p.planOption.version.planningCase.status,
      optionCode: p.planOption.optionCode,
      expectedShape: p.expectedShape,
      expectedWeight: num(p.expectedWeight),
      expectedColor: p.expectedColor,
      expectedClarity: p.expectedClarity,
      expectedCategory: p.expectedCategory,
      certificationIntent: p.certificationIntent,
      fantasyChildId: p.fantasyChildId,
      actualPolishedLotId: p.actualPolishedLotId,
      actualShape: p.actualShape,
      actualWeight: p.actualWeight ? num(p.actualWeight) : null,
      actualCategory: p.actualCategory,
      fulfilled: p.fulfilled,
    })),
  });
});
