import { z } from "zod";
import { db } from "@/lib/db";
import { ok } from "@/lib/api-utils";
import { withApi, reasonSchema } from "@/lib/api/with-api";
import { readApprovalPolicy, SEPARATE_APPROVER_POLICY_CODE } from "@/lib/planning/approval-policy";

// Plan approval policy (Users & Access → Permissions). Reading and changing it are separate
// permissions, and neither is implied by plan approval or by system administration.
export const GET = withApi({ permission: "approval_policy.read" }, async () => ok(await readApprovalPolicy(db)));

const bodySchema = z.object({ requireSeparateApprover: z.boolean(), reason: reasonSchema }).strict();

export const POST = withApi({ permission: "approval_policy.manage", body: bodySchema }, async (_req, _ctx, api) => {
  const { requireSeparateApprover, reason } = api.body;
  const policy = await db.$transaction(async (tx) => {
    const before = await readApprovalPolicy(tx);
    await tx.featureFlag.upsert({
      where: { code: SEPARATE_APPROVER_POLICY_CODE },
      create: { code: SEPARATE_APPROVER_POLICY_CODE, name: "Require separate approver", enabled: requireSeparateApprover, description: "A planner cannot approve or reject their own plan." },
      update: { enabled: requireSeparateApprover },
    });
    await api.audit(tx, {
      action: "APPROVAL_POLICY_CHANGED",
      entity: "ApprovalPolicy",
      entityId: SEPARATE_APPROVER_POLICY_CODE,
      before: { requireSeparateApprover: before.requireSeparateApprover },
      after: { requireSeparateApprover },
      reason,
      category: "SECURITY",
    });
    return readApprovalPolicy(tx);
  });
  return ok(policy);
});
