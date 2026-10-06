import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { log } from "@/lib/api/log";

if (typeof window !== "undefined") {
  throw new Error("api/operational-failure is server-only and must not be imported by client code.");
}

export const OPERATIONAL_FAILURE_CODES = [
  "OPERATION_FAILED",
  "DATA_CONFLICT",
  "RECORD_MISSING",
  "SOURCE_DATA_INVALID",
  "DATA_STORE_UNAVAILABLE",
  "OPERATION_TIMEOUT",
] as const;

export type OperationalFailureCode = (typeof OPERATIONAL_FAILURE_CODES)[number];

export interface PublicFailure {
  code: OperationalFailureCode;
  message: string;
  referenceId: string;
  occurredAt: string;
  retryable: boolean;
}

interface FailureKind {
  message: string;
  retryable: boolean;
}

const FAILURE_KINDS: Record<OperationalFailureCode, FailureKind> = {
  OPERATION_FAILED: {
    message: "The operation did not complete. No partial result was kept.",
    retryable: false,
  },
  DATA_CONFLICT: {
    message: "The data changed while the operation was running. Reload and try again.",
    retryable: true,
  },
  RECORD_MISSING: {
    message: "A record the operation depended on was no longer present. No partial result was kept.",
    retryable: false,
  },
  SOURCE_DATA_INVALID: {
    message: "Source data did not match the expected structure, so the operation was stopped before any result was recorded.",
    retryable: false,
  },
  DATA_STORE_UNAVAILABLE: {
    message: "The data store could not be reached. No partial result was kept.",
    retryable: true,
  },
  OPERATION_TIMEOUT: {
    message: "The operation exceeded its time limit and was stopped. No partial result was kept.",
    retryable: true,
  },
};

const PRISMA_CODE_MAP: Record<string, OperationalFailureCode> = {
  P2002: "DATA_CONFLICT",
  P2025: "RECORD_MISSING",
  P2024: "OPERATION_TIMEOUT",
  P1001: "DATA_STORE_UNAVAILABLE",
  P1002: "DATA_STORE_UNAVAILABLE",
  P1008: "OPERATION_TIMEOUT",
  P1017: "DATA_STORE_UNAVAILABLE",
};

function classify(err: unknown): OperationalFailureCode {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    return PRISMA_CODE_MAP[err.code] ?? "OPERATION_FAILED";
  }
  if (err instanceof Prisma.PrismaClientInitializationError) return "DATA_STORE_UNAVAILABLE";
  if (err instanceof Prisma.PrismaClientValidationError) return "SOURCE_DATA_INVALID";
  if (err instanceof Error && err.name === "ZodError") return "SOURCE_DATA_INVALID";
  return "OPERATION_FAILED";
}

function newReferenceId(): string {
  return randomUUID().replace(/-/g, "").slice(0, 12).toUpperCase();
}

export interface OperationalFailureContext {
  operation: string;
  entity: string;
  entityId: string;
  actorUserId?: string | null;
}

export function recordOperationalFailure(err: unknown, ctx: OperationalFailureContext): PublicFailure {
  const code = classify(err);
  const kind = FAILURE_KINDS[code];
  const referenceId = newReferenceId();
  const occurredAt = new Date().toISOString();

  log("error", "operation.failed", {
    referenceId,
    operation: ctx.operation,
    entity: ctx.entity,
    entityId: ctx.entityId,
    actorUserId: ctx.actorUserId ?? null,
    code,
    diagnostic: err instanceof Error ? (err.stack ?? err.message) : String(err),
  });

  return { code, message: kind.message, referenceId, occurredAt, retryable: kind.retryable };
}

const ENVELOPE_MARKER = "PUBLIC_FAILURE_V1";

export function serializePublicFailure(failure: PublicFailure): string {
  return JSON.stringify({ v: ENVELOPE_MARKER, ...failure });
}

export function readPublicFailure(stored: string | null | undefined): PublicFailure | null {
  if (!stored) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(stored);
  } catch {
    return legacyFailure();
  }

  if (!parsed || typeof parsed !== "object") return legacyFailure();
  const row = parsed as Record<string, unknown>;
  if (row.v !== ENVELOPE_MARKER) return legacyFailure();

  const code = OPERATIONAL_FAILURE_CODES.includes(row.code as OperationalFailureCode)
    ? (row.code as OperationalFailureCode)
    : "OPERATION_FAILED";
  const kind = FAILURE_KINDS[code];

  return {
    code,
    message: kind.message,
    referenceId: typeof row.referenceId === "string" && /^[0-9A-F]{12}$/.test(row.referenceId) ? row.referenceId : "",
    occurredAt: typeof row.occurredAt === "string" ? row.occurredAt : "",
    retryable: kind.retryable,
  };
}

function legacyFailure(): PublicFailure {
  const kind = FAILURE_KINDS.OPERATION_FAILED;
  return { code: "OPERATION_FAILED", message: kind.message, referenceId: "", occurredAt: "", retryable: kind.retryable };
}
