import { ok } from "@/lib/api-utils";
import { withApi } from "@/lib/api/with-api";
import { resolveOrderSourceState, toPublicOrderAvailability } from "@/lib/analysis/customers-orders";

/**
 * ORDER AVAILABILITY — its own endpoint, with its own authority.
 *
 * This used to be a `section=orders` branch of the customer endpoint, whose outer guard
 * was `customers.read`. A user holding only `orders.read` was therefore refused before
 * the orders branch could be reached, and the customer readiness response carried order
 * diagnostics to anyone holding `customers.read`. Splitting the handler makes each
 * section carry exactly its own permission, enforced by the wrapper rather than by a
 * conditional inside a shared handler.
 *
 * Read-only. The response is an allow-listed projection: the internal source-capability
 * structure — seeded row counts and the field inventory — is never serialized.
 */
export const GET = withApi({ permission: "orders.read" }, async () => {
  const source = await resolveOrderSourceState();
  const availability = toPublicOrderAvailability(source);

  return ok({
    available: availability.available,
    state: availability.state,
    message: availability.message,
    nextStep: availability.nextStep,
    // No rows, no totals, and deliberately no zeros: an absent source is not an empty
    // order book. Seeded demonstration rows are excluded from operational reporting.
    rows: [],
  });
});
