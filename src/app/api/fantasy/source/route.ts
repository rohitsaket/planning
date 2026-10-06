import { db } from "@/lib/db";
import { ok } from "@/lib/api-utils";
import { withApi } from "@/lib/api/with-api";
import { describeBaseUrl, getFantasyConfig, getLiveFantasyConfig } from "@/lib/fantasy/config";
import { getFantasyTokenStatus } from "@/lib/fantasy/live-api";
import { getSchedulerStatus } from "@/lib/fantasy/scheduler";

// Integration health for the Fantasy source. Names the host and HOW credentials are stored
// (configured flags), never a username, password or token.
export const GET = withApi({ permission: "fantasy.read" }, async () => {
  const config = getFantasyConfig();
  const live = getLiveFantasyConfig();
  const [checkpoint, token] = await Promise.all([
    db.syncCheckpoint.findUnique({ where: { source: "FANTASY_LIVE_DATA" }, select: { currentCheckpoint: true, lastSyncAt: true, isLocked: true } }),
    config.sourceMode === "FANTASY_API" ? getFantasyTokenStatus().catch(() => ({ cached: false, expiresAt: null, issuedTo: null })) : Promise.resolve({ cached: false, expiresAt: null, issuedTo: null }),
  ]);
  return ok({
    sourceMode: config.sourceMode,
    isSimulated: config.isSimulation,
    checkpoint: checkpoint?.currentCheckpoint ?? 0,
    lastSyncAt: checkpoint?.lastSyncAt?.toISOString() ?? null,
    isLocked: checkpoint?.isLocked ?? false,
    live: {
      configured: live.configured,
      missing: live.missing,
      host: describeBaseUrl(live.baseUrl),
      usernameConfigured: live.usernameConfigured,
      passwordConfigured: live.passwordConfigured,
      passwordStorage: live.passwordStorage,
      lotsPath: live.lotsPath,
      syncEnabled: live.syncEnabled,
      syncIntervalMinutes: live.syncIntervalMinutes,
      token: { cached: token.cached, expiresAt: token.expiresAt },
      scheduler: getSchedulerStatus(),
    },
  });
});
