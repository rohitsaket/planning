import { db } from "@/lib/db";
import { ok, num } from "@/lib/api-utils";
import { withApi, SCAN_MAX, scanned } from "@/lib/api/with-api";

// WIP Analysis — counts of planned pieces in approved plans, eligible WIP coverage
// OPEN rule: exact WIP contribution to shortage is OPEN; we display counts and configuration flags.
export const GET = withApi({ permission: "analysis.read" }, async () => {
  // Pieces in approved plans (released to manufacturing)
  const pieces = await db.planOptionPiece.findMany({ take: SCAN_MAX,
    where: {
      planOption: { approvalStatus: { in: ["APPROVED", "RELEASED"] } },
    },
    include: { planOption: { include: { version: { include: { planningCase: true } } } } },
  }).then(scanned);

  const byStatus = new Map<string, number>();
  const byDept = new Map<string, number>();
  const byShape = new Map<string, number>();
  const byCategory = new Map<string, number>();

  for (const p of pieces) {
    byStatus.set("IN_WIP", (byStatus.get("IN_WIP") ?? 0) + 1);
    byDept.set(p.planOption.version.planningCase.sourceFile ?? "Unknown", (byDept.get(p.planOption.version.planningCase.sourceFile ?? "Unknown") ?? 0) + 1);
    byShape.set(p.expectedShape, (byShape.get(p.expectedShape) ?? 0) + 1);
    if (p.expectedCategory) byCategory.set(p.expectedCategory, (byCategory.get(p.expectedCategory) ?? 0) + 1);
  }

  // Eligibility flags (OPEN rule — these are configurable, defaults shown)
  const eligibilityFlags = [
    { flag: "Counts Toward Requirement?", value: "Configurable (OPEN)", default: false },
    { flag: "Expected Qty Reliable?", value: "Configurable (OPEN)", default: false },
    { flag: "Expected Shape Reliable?", value: "Configurable (OPEN)", default: false },
    { flag: "Expected Weight Reliable?", value: "Configurable (OPEN)", default: false },
    { flag: "Expected Color Reliable?", value: "Configurable (OPEN)", default: false },
    { flag: "Expected Clarity Reliable?", value: "Configurable (OPEN)", default: false },
    { flag: "Expected Completion Available?", value: "Configurable (OPEN)", default: false },
  ];

  return ok({
    totalWipPieces: pieces.length,
    byStatus: Array.from(byStatus.entries()).map(([k, v]) => ({ dimension: k, pieces: v })),
    byDept: Array.from(byDept.entries()).map(([k, v]) => ({ dimension: k ?? "Unknown", pieces: v })),
    byShape: Array.from(byShape.entries()).map(([k, v]) => ({ dimension: k, pieces: v })).sort((a, b) => b.pieces - a.pieces),
    byCategory: Array.from(byCategory.entries()).map(([k, v]) => ({ dimension: k, pieces: v })).sort((a, b) => b.pieces - a.pieces),
    eligibilityFlags,
    openRuleNote: "OPEN rule BR-WIP-001 — exact WIP contribution logic not confirmed. Counts displayed but not auto-applied to shortage.",
  });
});
