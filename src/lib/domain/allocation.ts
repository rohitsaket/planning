import type { Prisma } from "@prisma/client";
import { conflict, notFound } from "@/lib/api/errors";

// Concurrency-safe requirement allocation primitive.
// No API route allocates requirements today; any future route MUST go through this function.
// Invariant: SUM(active allocatedQty) never exceeds the requirement's allocatable quantity.
// The guard is a single conditional UPDATE, so two concurrent callers cannot both succeed.
export async function allocateRequirement(
  tx: Prisma.TransactionClient,
  input: { requirementId: string; qty: number; planOptionId?: string | null; allocatedBy: string },
) {
  if (!Number.isInteger(input.qty) || input.qty <= 0) throw conflict("INVALID_ALLOCATION_QTY", "Allocation quantity must be a positive whole number.");
  const claimed = await tx.requirement.updateMany({
    where: { id: input.requirementId, status: { notIn: ["CANCELLED", "EXPIRED", "FULFILLED", "ON_HOLD"] }, remainingUnplanned: { gte: input.qty } },
    data: { remainingUnplanned: { decrement: input.qty }, approvedPlanCoverage: { increment: input.qty } },
  });
  if (claimed.count !== 1) {
    const exists = await tx.requirement.findUnique({ where: { id: input.requirementId }, select: { id: true } });
    if (!exists) throw notFound("Requirement");
    throw conflict("REQUIREMENT_CONFLICT", "The requirement changed or has insufficient remaining quantity.");
  }
  return tx.requirementAllocation.create({
    data: { requirementId: input.requirementId, planOptionId: input.planOptionId ?? null, allocatedQty: input.qty, allocatedBy: input.allocatedBy, status: "ALLOCATED" },
  });
}
