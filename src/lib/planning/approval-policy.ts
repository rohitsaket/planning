import type { Prisma, PrismaClient } from "@prisma/client";

/**
 * Plan approval policy: whether the planner of a case may approve or reject it.
 *
 * Stored as one row of the FeatureFlag table under this code, which is the storage the
 * approval route has always read. The rule is on (a different user must approve) unless
 * the row exists and is switched off, so a database without the row enforces separation
 * of duties.
 */
export const SEPARATE_APPROVER_POLICY_CODE = "SOD_PLANNER_APPROVER";

type Reader = Pick<PrismaClient | Prisma.TransactionClient, "featureFlag">;

export interface ApprovalPolicy {
  requireSeparateApprover: boolean;
  /** When the policy was last changed, or null while it has never been changed from the default. */
  changedAt: string | null;
}

export async function readApprovalPolicy(client: Reader): Promise<ApprovalPolicy> {
  const row = await client.featureFlag.findUnique({ where: { code: SEPARATE_APPROVER_POLICY_CODE } });
  return { requireSeparateApprover: row?.enabled !== false, changedAt: row ? row.updatedAt.toISOString() : null };
}
