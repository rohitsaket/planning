/**
 * Operational failure sanitization.
 *
 * `withApi` already sanitizes errors that are *thrown* out of a route handler: the caller
 * receives `{ code, message, requestId }` and the stack reaches only the server log. This
 * module covers the other case — a long-running operation (a demand calculation, a
 * synchronization batch) that catches its own failure, records an honest FAILED status
 * and returns normally. Those failures are persisted and read back by an API later, so
 * they need the same guarantee without travelling through `errorResponse`.
 *
 * Two layers, both required:
 *   1. `recordOperationalFailure` converts the exception once, at the point of failure.
 *      Full diagnostics go to the server log under a reference; only the sanitized
 *      envelope is returned for persistence.
 *   2. `readPublicFailure` sanitizes again when a stored value is read back. Rows written
 *      before this module existed hold raw exception text, so the response boundary can
 *      never trust the column.
 *
 * The public message is always selected from a fixed table. No part of an exception is
 * ever echoed into it.
 *
 * Server-only.
 */

import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { log } from "@/lib/api/log";

if (typeof window !== "undefined") {
  throw new Error("api/operational-failure is server-only and must not be imported by client code.");
}

/**
 * Stable public failure codes. These are part of the API contract, so they are business
 * outcomes rather than exception class names: a caller may branch on them, and an
 * operator may quote one, without either learning how the store is built.
 */
export const OPERATIONAL_FAILURE_CODES = [
  "OPERATION_FAILED",
  "DATA_CONFLICT",
  "RECORD_MISSING",
  "SOURCE_DATA_INVALID",
  "DATA_STORE_UNAVAILABLE",
  "OPERATION_TIMEOUT",
] as const;

export type OperationalFailureCode = (typeof OPERATIONAL_FAILURE_CODES)[number];

/** The only failure shape any browser is allowed to receive. */
export interface PublicFailure {
  code: OperationalFailureCode;
  message: string;
  referenceId: string;
  occurredAt: string;
  retryable: boolean;
}

interface FailureKind {
  message: string;
  /** Only set where retrying is genuinely meaningful — never guessed. */
  retryable: boolean;
}

/**
 * Fixed public wording per code. Selection is deterministic and the strings are
 * constants, which is what keeps exception text out of the response: there is no code
 * path that can place a caught value into `message`.
 */
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

/** Prisma request codes that map to something more specific than a generic failure. */
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
  // ZodError is matched structurally rather than by import so this module stays free of
  // a validation dependency it would otherwise only need for an `instanceof`.
  if (err instanceof Error && err.name === "ZodError") return "SOURCE_DATA_INVALID";
  return "OPERATION_FAILED";
}

/** A short reference an operator can read aloud and grep for verbatim in the log. */
function newReferenceId(): string {
  return randomUUID().replace(/-/g, "").slice(0, 12).toUpperCase();
}

export interface OperationalFailureContext {
  /** Fixed event name, e.g. "demand.run". Never interpolated from user input. */
  operation: string;
  /** Model the failure was recorded against, for log correlation only. */
  entity: string;
  entityId: string;
  actorUserId?: string | null;
}

/**
 * Converts a caught exception into the sanitized envelope, and writes the full
 * diagnostic to the server log under the same reference.
 *
 * The log line carries the stack because an operator needs it and the server log is not
 * user-accessible. It carries nothing else from the failure site: no request body, no
 * source record, no credential, no environment value — only the fixed operation name and
 * the identifiers needed to find the run.
 */
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

/** Marks the stored envelope so a legacy raw-text value is never mistaken for one. */
const ENVELOPE_MARKER = "PUBLIC_FAILURE_V1";

/**
 * Serializes the envelope for a `String` column, following the project convention of
 * storing JSON as text rather than introducing a JSON column type.
 */
export function serializePublicFailure(failure: PublicFailure): string {
  return JSON.stringify({ v: ENVELOPE_MARKER, ...failure });
}

/**
 * The response boundary. Returns a browser-safe failure for any stored value.
 *
 * A value written before this module existed is raw exception text. It is never parsed,
 * inspected or echoed — its presence only tells us the operation failed, so it becomes a
 * generic failure with no reference. That loses nothing a user could act on, because the
 * text it replaces was never actionable to begin with.
 */
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

  // Rebuilt field by field from the fixed table rather than spread, so a value that
  // somehow reached the column cannot ride out through an unexpected key.
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
