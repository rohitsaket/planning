/**
 * DOWNSTREAM SOURCE POLICY — which interpretation of Fantasy data a consumer reads.
 *
 * Three policies are named. Only one is available.
 *
 *   LEGACY_FIXTURE      the canonical records written by the existing synchronization
 *                       service. This is what every consumer reads today, and what the
 *                       whole of Master Phase 1 has been careful not to change.
 *   SHADOW_COMPARE      shadow projection candidates, for diagnostics and reconciliation
 *                       only. Never a source for stock, demand, planning or approval.
 *   CANONICAL_PROJECTED projected records treated as authoritative. Not available:
 *                       projection cannot run in an ACTIVE mode, so there is nothing
 *                       authoritative to read. Selecting it is refused, not silently
 *                       downgraded, because a silent downgrade would let a caller
 *                       believe it had switched over when it had not.
 *
 * The point of naming a policy that does not work yet is that the switchover has a
 * shape. The point of refusing it is that the shape is not the same thing as the
 * evidence, and the evidence — a reconciled shadow run the client has reviewed — does
 * not exist.
 *
 * Server-only.
 */

if (typeof window !== "undefined") {
  throw new Error("fantasy/downstream-source-policy is server-only and must not be imported by client code.");
}

export const DOWNSTREAM_SOURCE_POLICIES = ["LEGACY_FIXTURE", "SHADOW_COMPARE", "CANONICAL_PROJECTED"] as const;
export type DownstreamSourcePolicy = (typeof DOWNSTREAM_SOURCE_POLICIES)[number];

/** What every operational consumer reads. Changing this constant is a business decision. */
export const ACTIVE_DOWNSTREAM_SOURCE_POLICY: DownstreamSourcePolicy = "LEGACY_FIXTURE";

export const POLICY_AVAILABILITY_CODES = [
  "AVAILABLE",
  "DIAGNOSTIC_ONLY",
  "NOT_IMPLEMENTED",
] as const;
export type PolicyAvailabilityCode = (typeof POLICY_AVAILABILITY_CODES)[number];

export interface PolicyAvailability {
  readonly policy: DownstreamSourcePolicy;
  readonly availability: PolicyAvailabilityCode;
  /** True only when an operational consumer may read from this policy. */
  readonly usableForOperationalReads: boolean;
  /** Fixed code. Displayed as-is; never assembled from a source value. */
  readonly reasonCode: string;
}

const AVAILABILITY: Readonly<Record<DownstreamSourcePolicy, PolicyAvailability>> = Object.freeze({
  LEGACY_FIXTURE: {
    policy: "LEGACY_FIXTURE",
    availability: "AVAILABLE",
    usableForOperationalReads: true,
    reasonCode: "LEGACY_PIPELINE_ACTIVE",
  },
  SHADOW_COMPARE: {
    policy: "SHADOW_COMPARE",
    availability: "DIAGNOSTIC_ONLY",
    usableForOperationalReads: false,
    reasonCode: "SHADOW_OUTPUT_IS_NOT_AUTHORITATIVE",
  },
  CANONICAL_PROJECTED: {
    policy: "CANONICAL_PROJECTED",
    availability: "NOT_IMPLEMENTED",
    usableForOperationalReads: false,
    reasonCode: "ACTIVATION_NOT_IMPLEMENTED",
  },
});

export function policyAvailability(policy: DownstreamSourcePolicy): PolicyAvailability {
  return AVAILABILITY[policy];
}

export function isDownstreamSourcePolicy(value: unknown): value is DownstreamSourcePolicy {
  return typeof value === "string" && (DOWNSTREAM_SOURCE_POLICIES as readonly string[]).includes(value);
}

export class DownstreamSourcePolicyError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "DownstreamSourcePolicyError";
    this.code = code;
  }
}

/**
 * Resolves the policy an operational consumer may use.
 *
 * Refuses anything that is not operationally available rather than falling back, so a
 * caller that asked for projected data and got legacy data cannot mistake one for the
 * other.
 */
export function assertOperationalPolicy(requested: DownstreamSourcePolicy): DownstreamSourcePolicy {
  const availability = policyAvailability(requested);
  if (!availability.usableForOperationalReads) {
    throw new DownstreamSourcePolicyError(
      availability.reasonCode,
      "That data source is not available for operational reads.",
    );
  }
  return requested;
}

/** Client-safe summary for a diagnostics surface. Codes and booleans only. */
export function downstreamPolicySummary(): {
  active: DownstreamSourcePolicy;
  policies: PolicyAvailability[];
} {
  return {
    active: ACTIVE_DOWNSTREAM_SOURCE_POLICY,
    policies: DOWNSTREAM_SOURCE_POLICIES.map((p) => AVAILABILITY[p]),
  };
}
