import { db } from "@/lib/db";
import { ok, num } from "@/lib/api-utils";

// Planning Cases — list with aggregates
export async function GET(req: Request) {
  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const planner = url.searchParams.get("planner");
  const stoneType = url.searchParams.get("stoneType");

  const where: Record<string, unknown> = {};
  if (status) where.status = status;
  if (planner) where.planner = planner;
  if (stoneType) where.stoneType = stoneType;

  const cases = await db.planningCase.findMany({
    where,
    include: {
      rough: true,
      versions: { include: { options: { include: { pieces: true } } } },
    },
    orderBy: { planningDate: "desc" },
  });

  const rows = cases.map((c) => {
    const opts = c.versions[0]?.options ?? [];
    const selectedOpt = opts.find((o) => o.id === c.selectedOptionId) ?? opts.find((o) => o.selected) ?? null;
    const expectedPieces = selectedOpt ? selectedOpt.expectedPieces : opts.reduce((s, o) => s + o.expectedPieces, 0);
    const expectedYield = selectedOpt ? num(selectedOpt.yieldPct) : (opts.length > 0 ? num(opts[0].yieldPct) : 0);
    const reqCov = selectedOpt ? num(selectedOpt.coveragePct) : 0;
    return {
      id: c.id,
      caseCode: c.caseCode,
      roughId: c.roughId,
      fantasyRoughId: c.rough?.fantasyRoughId ?? null,
      stoneName: c.stoneName,
      kapan: c.kapan,
      packet: c.packet,
      signer: c.rough?.signer ?? null,
      originalRoughWeight: num(c.originalRoughWeight),
      stoneType: c.stoneType,
      planner: c.planner,
      planningDate: c.planningDate.toISOString(),
      status: c.status,
      currentVersion: c.currentVersion,
      selectedOptionCode: selectedOpt?.optionCode ?? null,
      approvedBy: c.approvedBy,
      approvedAt: c.approvedAt?.toISOString() ?? null,
      approvalComment: c.approvalComment,
      optionCount: opts.length,
      expectedPieces,
      expectedYieldPct: expectedYield,
      requirementCoveragePct: reqCov,
    };
  });

  return ok({ rows });
}
