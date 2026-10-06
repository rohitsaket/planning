import { db } from "@/lib/db";
import { ok } from "@/lib/api-utils";
import { withApi } from "@/lib/api/with-api";
import { LIMITS } from "@/lib/api/rate-limit";
import { getFantasyConfig } from "@/lib/fantasy/config";
import { testFantasyConnection } from "@/lib/fantasy/live-api";

// Connection diagnostics: login (cached token when possible) + one listing call.
// Same permission as triggering a sync; the result carries no credentials and is audited.
export const POST = withApi({ permission: "fantasy.sync.run", rateLimit: LIMITS.expensive }, async (_req, _ctx, { audit }) => {
  const config = getFantasyConfig();
  const result = await testFantasyConnection();
  await audit(db, {
    action: "FANTASY_API_CONNECTION_TEST",
    entity: "IntegrationSyncRun",
    after: { sourceMode: config.sourceMode, ok: result.ok, host: result.host, loginOk: result.login.ok, lotsStatus: result.lots.status, lotsRows: result.lots.rows, error: result.lots.error ?? result.login.error ?? null },
    reason: "Manual Fantasy API connection test",
  });
  return ok({ sourceMode: config.sourceMode, ...result });
});
