import { ok } from "@/lib/api-utils";
import { withApi } from "@/lib/api/with-api";
import { getLiveSyncStatus } from "@/lib/fantasy/live-sync";
import { getSchedulerStatus } from "@/lib/fantasy/scheduler";

export const GET = withApi({ permission: "fantasy.read" }, async () => {
  const status = await getLiveSyncStatus();
  return ok({ ...status, scheduler: getSchedulerStatus() });
});
