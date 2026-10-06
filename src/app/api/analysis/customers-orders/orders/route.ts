import { ok } from "@/lib/api-utils";
import { withApi } from "@/lib/api/with-api";
import { resolveOrderSourceState, toPublicOrderAvailability } from "@/lib/analysis/customers-orders";

export const GET = withApi({ permission: "orders.read" }, async () => {
  const source = await resolveOrderSourceState();
  const availability = toPublicOrderAvailability(source);

  return ok({
    available: availability.available,
    state: availability.state,
    message: availability.message,
    nextStep: availability.nextStep,
    rows: [],
  });
});
