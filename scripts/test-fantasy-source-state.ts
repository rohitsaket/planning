/**
 * FANTASY SOURCE STATE & RAW ORCHESTRATION (Phase 4)
 *
 * Runs against the isolated security-test database only (planning_sectest).
 *
 * Proves: configured mode, runtime health and effective state stay separate; the
 * effective state is derived in exactly one place; fixture data is always labelled
 * simulated and can never reach a live state; an absent, unsupported or `FILE_IMPORT`
 * configuration fails closed at validation instead of throwing later; an uninstalled
 * or unhealthy live provider never appears ready; an injected provider can be
 * orchestrated into Phase 3A raw ingestion without a single canonical write or
 * checkpoint change; cursor metadata stays out of the row data and out of every
 * returned result; and status and synchronization routes stay server-authorized.
 *
 * All provider data here is synthetic and confined to this file.
 *
 * Usage: npx tsx scripts/with-sectest-db.ts npx tsx scripts/test-fantasy-source-state.ts
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { db } from "../src/lib/db";
import { SECTEST_DB } from "../tests/security/test-db";
import { call, makeUser } from "../tests/security/helpers";
import { resetRateLimits } from "../src/lib/api/rate-limit";
import {
  deriveEffectiveSourceState,
  deriveHistoricalSourceState,
  parseConfiguredSourceMode,
  FANTASY_SOURCE_STATE_LABELS,
  isUsableFreshnessWindow,
  type FantasyProviderCapabilities,
  type FantasyRuntimeHealth,
} from "../src/lib/fantasy/source-state";
import {
  createFantasyProviderContext,
  isFantasyProviderContext,
  INSTALLED_LIVE_PROVIDERS,
  isLiveConfigurationComplete,
  toPublicCapabilities,
  type FantasyProviderRegistration,
} from "../src/lib/fantasy/provider-registry.server";
import {
  fantasySyncRunScope,
  getFantasySourceConfiguration,
  resolveFantasySourceState,
  resolveFantasySourceStateWithHistory,
} from "../src/lib/fantasy/config";
import {
  orchestrateFantasyRawIngestion,
  type RawOrchestrationResult,
} from "../src/lib/fantasy/raw-orchestration";
import {
  FANTASY_ROW_CONTRACT_V1,
  FANTASY_V1_HEADERS,
  type FantasyRowSourceProvider,
  type FantasySourceBatch,
  type FantasySourceCursor,
} from "../src/lib/fantasy/row-contract";
import type { RawIngestionDb } from "../src/lib/fantasy/raw-ingestion";
import { GET as syncGET, POST as syncPOST } from "../src/app/api/fantasy/sync/route";

const url = process.env.DATABASE_URL ?? "";
if (!url || !new URL(url).pathname.startsWith(`/${SECTEST_DB}`)) {
  console.error(`REFUSING TO RUN: DATABASE_URL must point at the isolated ${SECTEST_DB} database.`);
  process.exit(1);
}

let passed = 0;
let failed = 0;
const failures: string[] = [];

function assert(condition: boolean, message: string) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    failures.push(message);
    console.error(`  ✗ ${message}`);
  }
}

function section(title: string) {
  console.log(`\n--- ${title} ---`);
}

const NOW = new Date("2026-09-22T12:00:00.000Z");
const RECENT = new Date(NOW.getTime() - 60 * 60 * 1000);
const OLD = new Date(NOW.getTime() - 48 * 60 * 60 * 1000);

// ---------------------------------------------------------------------------
// Synthetic test providers. Deliberately obvious simulation values: nothing here
// resembles real client inventory, and none of it is production code.
// ---------------------------------------------------------------------------

const HEADERS = [...FANTASY_V1_HEADERS] as string[];

function syntheticRow(lotId: string): unknown[] {
  return HEADERS.map((h) => (h === "Lot ID" ? lotId : `SIMULATED-${h}`));
}

interface TestProviderOptions {
  readonly providerId?: string;
  readonly simulated?: boolean;
  readonly supportsDryRunFetch?: boolean;
  readonly contractVersion?: string;
  readonly batchContractVersion?: string;
  readonly deliveryMode?: FantasyProviderCapabilities["deliveryMode"];
  readonly implementationStatus?: FantasyProviderCapabilities["implementationStatus"];
  readonly batchId?: string;
  readonly rows?: unknown[][];
  readonly cursorOverride?: FantasySourceCursor;
  readonly returnsNull?: boolean;
  readonly throws?: boolean;
  readonly onFetch?: (cursor: FantasySourceCursor) => void;
}

let providerSeq = 0;

function makeTestProvider(options: TestProviderOptions = {}): {
  provider: FantasyRowSourceProvider;
  capabilities: FantasyProviderCapabilities;
} {
  providerSeq++;
  const contractVersion = options.contractVersion ?? FANTASY_ROW_CONTRACT_V1;
  const deliveryMode = options.deliveryMode ?? "FULL_SNAPSHOT";
  const batchId = options.batchId ?? `P4-TEST-${providerSeq}`;

  const capabilities: FantasyProviderCapabilities = {
    providerId: options.providerId ?? `test-raw-provider-${providerSeq}`,
    contractVersion,
    deliveryMode,
    implementationStatus: options.implementationStatus ?? "IMPLEMENTED",
    supportsDryRunFetch: options.supportsDryRunFetch ?? true,
    simulated: options.simulated ?? true,
  };

  const provider: FantasyRowSourceProvider = {
    contractVersion,
    getSourceMode: () => "TEST_SIMULATION",
    async fetchBatch(cursor: FantasySourceCursor): Promise<FantasySourceBatch | null> {
      options.onFetch?.(cursor);
      if (options.throws) throw new Error(`provider exploded while reading SIMULATED-Lot-SECRET with token ${cursor.token}`);
      if (options.returnsNull) return null;
      return {
        contractVersion: options.batchContractVersion ?? contractVersion,
        sourceMode: "TEST_SIMULATION",
        batchId,
        headers: HEADERS,
        rows: options.rows ?? [syntheticRow("SIMULATED-LOT-1"), syntheticRow("SIMULATED-LOT-2")],
        cursor:
          options.cursorOverride ??
          (deliveryMode === "FULL_SNAPSHOT"
            ? { kind: "FULL_SNAPSHOT", token: null }
            : { kind: "PROVIDER_SUPPLIED", token: "PROVIDER-CURSOR-TOKEN-SECRET" }),
      };
    },
  };

  return { provider, capabilities };
}

const FIXTURE_STATE = resolveFantasySourceState({ env: { FANTASY_SOURCE_MODE: "FIXTURE_SIMULATION" }, now: NOW });
const UNCONFIGURED_STATE = resolveFantasySourceState({ env: {}, now: NOW });

/** Canonical tables Phase 4 must never write to. */
async function canonicalSnapshot() {
  const [lotMaster, lotHistory, polished, rough, sales, memo, requirements, plans, planPieces, demandRuns, demandMetrics, syncRuns, dqIssues, checkpoints] =
    await Promise.all([
      db.lotMasterRecord.count(), db.lotHistoryRecord.count(), db.polishedStone.count(), db.roughStone.count(),
      db.salesRecord.count(), db.memoRecord.count(), db.requirement.count(), db.planningCase.count(),
      db.planOptionPiece.count(), db.demandRun.count(), db.demandMetric.count(), db.integrationSyncRun.count(),
      db.dataQualityIssue.count(), db.syncCheckpoint.findMany({ orderBy: { source: "asc" } }),
    ]);
  return {
    counts: { lotMaster, lotHistory, polished, rough, sales, memo, requirements, plans, planPieces, demandRuns, demandMetrics, syncRuns, dqIssues },
    checkpoints: checkpoints.map((c) => ({ source: c.source, mode: c.mode, currentCheckpoint: c.currentCheckpoint, lastBatchId: c.lastBatchId, isLocked: c.isLocked })),
  };
}

async function main() {
  console.log("===============================================================================");
  console.log("FANTASY SOURCE STATE & RAW ORCHESTRATION (Phase 4)");
  console.log("===============================================================================");

  await db.fantasyRawRow.deleteMany({});
  await db.fantasyRawBatch.deleteMany({});
  await db.syncCheckpoint.upsert({
    where: { source: "FANTASY" },
    create: { source: "FANTASY", mode: "FIXTURE", currentCheckpoint: 2, lastBatchId: "PRE-EXISTING" },
    update: { mode: "FIXTURE", currentCheckpoint: 2, lastBatchId: "PRE-EXISTING", isLocked: false },
  });

  const before = await canonicalSnapshot();

  // =========================================================================
  section("A. Configuration and legacy compatibility");
  // =========================================================================
  assert(FIXTURE_STATE.configuredMode === "FIXTURE_SIMULATION", "Fixture configuration resolves to FIXTURE_SIMULATION");
  assert(FIXTURE_STATE.effectiveState === "FIXTURE_SIMULATION", "Fixture configuration resolves to the fixture effective state");
  assert(FIXTURE_STATE.isSimulated === true, "Fixture state is always marked simulated");
  assert(FIXTURE_STATE.runtimeHealth === "NOT_APPLICABLE", "Fixture state reports no live runtime health");
  assert(FIXTURE_STATE.statusLabel === "Fixture Simulation", "Fixture state is labelled Fixture Simulation");

  assert(UNCONFIGURED_STATE.configuredMode === "NOT_CONFIGURED", "No configuration resolves to NOT_CONFIGURED");
  assert(UNCONFIGURED_STATE.reasonCode === "SOURCE_NOT_CONFIGURED", "No configuration reports its own fixed reason code");
  assert(UNCONFIGURED_STATE.isSimulated === false, "An unconfigured source is not claimed to be simulation output");
  assert(UNCONFIGURED_STATE.statusLabel === "Not Configured", "An unconfigured source is labelled Not Configured");

  const liveSelected = resolveFantasySourceState({ env: { FANTASY_SOURCE_MODE: "LIVE_FANTASY" }, now: NOW });
  assert(liveSelected.configuredMode === "LIVE_FANTASY", "Live can be selected as a configured mode");
  assert(liveSelected.effectiveState === "NOT_CONFIGURED", "Live selected without an implementation does not resolve to a live state");
  assert(liveSelected.reasonCode === "PROVIDER_NOT_IMPLEMENTED", "Live without an implementation reports PROVIDER_NOT_IMPLEMENTED");
  assert(liveSelected.providerInstalled === false, "No live provider is reported as installed");
  assert(liveSelected.configurationComplete === false, "Live configuration is not claimed complete without a provider");
  assert(INSTALLED_LIVE_PROVIDERS.length === 0, "No live provider is registered in this build");

  let threw = false;
  try {
    resolveFantasySourceState({ env: { FANTASY_SOURCE_MODE: "LIVE_FANTASY" }, now: NOW });
    getFantasySourceConfiguration({ FANTASY_SOURCE_MODE: "LIVE_FANTASY" });
  } catch {
    threw = true;
  }
  assert(!threw, "Missing live configuration does not throw an unhandled exception");

  const legacyFixture = parseConfiguredSourceMode("FIXTURE");
  assert(legacyFixture.configuredMode === "FIXTURE_SIMULATION", "Legacy FIXTURE maps to FIXTURE_SIMULATION");
  assert(legacyFixture.canonicalSourceMode === "FIXTURE", "Legacy FIXTURE still drives the legacy canonical pipeline");
  assert(parseConfiguredSourceMode("fixture").configuredMode === "FIXTURE_SIMULATION", "Legacy value parsing is case-insensitive");
  assert(parseConfiguredSourceMode("  FIXTURE  ").configuredMode === "FIXTURE_SIMULATION", "Legacy value parsing trims surrounding whitespace");

  const legacyApi = parseConfiguredSourceMode("FANTASY_API");
  assert(legacyApi.configuredMode === "LIVE_FANTASY", "Legacy FANTASY_API maps to a configured live selection");
  const legacyApiState = resolveFantasySourceState({ env: { FANTASY_SOURCE_MODE: "FANTASY_API" }, now: NOW });
  assert(legacyApiState.effectiveState === "NOT_CONFIGURED", "Legacy FANTASY_API never reports a working live provider");
  assert(legacyApiState.isSimulated === false, "Legacy FANTASY_API is not relabelled as simulation");

  const fileImport = parseConfiguredSourceMode("FILE_IMPORT");
  assert(fileImport.configuredMode === "NOT_CONFIGURED", "FILE_IMPORT is rejected at configuration validation");
  assert(fileImport.reasonCode === "FILE_IMPORT_NOT_SUPPORTED", "FILE_IMPORT reports its own fixed reason code");
  assert(fileImport.canonicalSourceMode === null, "FILE_IMPORT drives no synchronization pipeline");
  const fileImportState = resolveFantasySourceState({ env: { FANTASY_SOURCE_MODE: "FILE_IMPORT" }, now: NOW });
  assert(fileImportState.effectiveState === "NOT_CONFIGURED", "FILE_IMPORT cannot pass configuration and fail later");
  assert(fileImportState.effectiveState !== "LIVE_FANTASY", "FILE_IMPORT is never silently mapped to live Fantasy");

  for (const unknown of ["EXCEL", "FANTASY", "LIVE", "true", "1"]) {
    const parsed = parseConfiguredSourceMode(unknown);
    assert(parsed.configuredMode === "NOT_CONFIGURED", `Unknown configuration value "${unknown}" fails closed`);
  }
  assert(parseConfiguredSourceMode(undefined).configuredMode === "NOT_CONFIGURED", "An absent configuration value fails closed");
  assert(parseConfiguredSourceMode("   ").configuredMode === "NOT_CONFIGURED", "A blank configuration value fails closed");

  // =========================================================================
  section("B. Effective-state derivation");
  // =========================================================================
  const liveReady = deriveEffectiveSourceState({
    configuredMode: "LIVE_FANTASY",
    configuredReasonCode: "LIVE_SOURCE_READY",
    providerInstalled: true,
    configurationComplete: true,
    providerHealth: "READY",
    // Readiness also requires history the provider can prove is its own.
    providerHistoryTrusted: true,
    lastSuccessAt: RECENT,
    lastFailureAt: null,
    now: NOW,
  });
  assert(liveReady.effectiveState === "LIVE_FANTASY", "Configured live plus a ready implemented provider resolves to LIVE_FANTASY");
  assert(liveReady.runtimeHealth === "READY", "A ready live source reports READY health");

  const degradedCases: Array<[string, Partial<Parameters<typeof deriveEffectiveSourceState>[0]>]> = [
    ["a degraded provider", { providerHealth: "DEGRADED" }],
    ["an unavailable provider", { providerHealth: "UNAVAILABLE" }],
    ["unknown provider health", { providerHealth: "NOT_APPLICABLE" }],
    ["a never-successful connection", { lastSuccessAt: null }],
    ["a newer failure than success", { lastFailureAt: NOW }],
    ["stale data", { lastSuccessAt: OLD }],
  ];
  for (const [label, override] of degradedCases) {
    const derived = deriveEffectiveSourceState({
      configuredMode: "LIVE_FANTASY",
      configuredReasonCode: "LIVE_SOURCE_READY",
      providerInstalled: true,
      configurationComplete: true,
      providerHealth: "READY",
      providerHistoryTrusted: true,
      lastSuccessAt: RECENT,
      lastFailureAt: null,
      now: NOW,
      ...override,
    });
    assert(derived.effectiveState === "LIVE_FANTASY_DEGRADED", `Configured live with ${label} resolves to LIVE_FANTASY_DEGRADED`);
    assert(derived.runtimeHealth !== "READY", `Configured live with ${label} never reports READY health`);
  }

  const missingConfig = deriveEffectiveSourceState({
    configuredMode: "LIVE_FANTASY",
    configuredReasonCode: "LIVE_SOURCE_READY",
    providerInstalled: true,
    configurationComplete: false,
    providerHealth: "READY",
    providerHistoryTrusted: true,
    lastSuccessAt: RECENT,
    lastFailureAt: null,
    now: NOW,
  });
  assert(missingConfig.effectiveState === "NOT_CONFIGURED", "Incomplete live configuration resolves to NOT_CONFIGURED");
  assert(missingConfig.reasonCode === "LIVE_CONFIGURATION_INCOMPLETE", "Incomplete live configuration reports its own code");

  for (const health of ["READY", "DEGRADED", "UNAVAILABLE", "NOT_APPLICABLE"] as FantasyRuntimeHealth[]) {
    const fixtureDerived = deriveEffectiveSourceState({
      configuredMode: "FIXTURE_SIMULATION",
      configuredReasonCode: "FIXTURE_SIMULATION_ACTIVE",
      providerInstalled: true,
      configurationComplete: true,
      providerHealth: health,
      providerHistoryTrusted: true,
      lastSuccessAt: RECENT,
      lastFailureAt: null,
      now: NOW,
    });
    assert(fixtureDerived.effectiveState === "FIXTURE_SIMULATION", `Fixtures cannot resolve to a live state even with ${health} health`);
  }

  const notConfiguredDerived = deriveEffectiveSourceState({
    configuredMode: "NOT_CONFIGURED",
    configuredReasonCode: "SOURCE_NOT_CONFIGURED",
    providerInstalled: true,
    configurationComplete: true,
    providerHealth: "READY",
    providerHistoryTrusted: true,
    lastSuccessAt: RECENT,
    lastFailureAt: null,
    now: NOW,
  });
  assert(notConfiguredDerived.effectiveState === "NOT_CONFIGURED", "A not-configured source cannot report a successful live connection");
  assert(notConfiguredDerived.runtimeHealth === "NOT_APPLICABLE", "A not-configured source reports no runtime health");

  assert(deriveHistoricalSourceState(true, "FIXTURE") === "FIXTURE_SIMULATION", "A stored simulated run is labelled Fixture Simulation");
  assert(deriveHistoricalSourceState(false, "FANTASY_API") === "LIVE_FANTASY", "A stored live run keeps its live label");
  assert(deriveHistoricalSourceState(false, "FILE_IMPORT") === "NOT_CONFIGURED", "A stored unsupported run reads back as Not Configured");
  assert(Object.keys(FANTASY_SOURCE_STATE_LABELS).length === 4, "Exactly four effective states have labels");
  assert(FANTASY_SOURCE_STATE_LABELS.LIVE_FANTASY_DEGRADED === "Live Fantasy — Degraded", "The degraded label is explicit");

  // =========================================================================
  section("B2. Server/client boundary");
  // =========================================================================
  const fantasyDir = path.join(process.cwd(), "src", "lib", "fantasy");
  const clientSafeSource = readFileSync(path.join(fantasyDir, "source-state.ts"), "utf8");

  assert(!/requiredConfigKeys/.test(clientSafeSource), "The client-safe source-state module names no required configuration key");
  assert(!/INSTALLED_LIVE_PROVIDERS/.test(clientSafeSource), "The client-safe source-state module holds no provider registry");
  assert(!/findInstalledLiveProvider/.test(clientSafeSource), "The client-safe source-state module performs no provider discovery");
  assert(!/process\.env/.test(clientSafeSource), "The client-safe source-state module reads no environment variable");
  assert(!/FANTASY_SOURCE_MODE/.test(clientSafeSource), "The client-safe source-state module names no environment variable");
  assert(
    !/from "\.\/(provider-registry\.server|config|raw-ingestion|raw-orchestration|raw-encoding)"/.test(clientSafeSource),
    "The client-safe source-state module imports nothing server-only, so it can re-export nothing server-only",
  );
  assert(
    !/export \*/.test(clientSafeSource),
    "The client-safe source-state module has no wildcard re-export that could leak a server-only value",
  );

  const registrySource = readFileSync(path.join(fantasyDir, "provider-registry.server.ts"), "utf8");
  assert(/typeof window !== "undefined"/.test(registrySource), "The provider registry guards against browser execution");
  const configModuleSource = readFileSync(path.join(fantasyDir, "config.ts"), "utf8");
  assert(/typeof window !== "undefined"/.test(configModuleSource), "The server configuration module guards against browser execution");
  assert(
    !/requiredConfigKeys/.test(configModuleSource),
    "Configuration key names stay inside the registry, not the configuration resolver",
  );

  // Every module a client component can reach, followed transitively.
  const walkTs = (dir: string, acc: string[] = []): string[] => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walkTs(full, acc);
      else if (/\.tsx?$/.test(entry.name)) acc.push(full);
    }
    return acc;
  };
  const resolveImport = (fromFile: string, spec: string): string | null => {
    const base = spec.startsWith("@/")
      ? path.join(process.cwd(), "src", spec.slice(2))
      : spec.startsWith(".")
      ? path.resolve(path.dirname(fromFile), spec)
      : null;
    if (base === null) return null;
    for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")]) {
      try {
        if (statSync(candidate).isFile()) return candidate;
      } catch {
        /* not this candidate */
      }
    }
    return null;
  };
  const importsOf = (file: string): string[] =>
    [...readFileSync(file, "utf8").matchAll(/from\s+"([^"]+)"/g)]
      .map((m) => resolveImport(file, m[1]))
      .filter((f): f is string => f !== null);

  const clientEntryPoints = walkTs(path.join(process.cwd(), "src", "components")).filter((f) =>
    /^\s*["']use client["']/.test(readFileSync(f, "utf8")),
  );
  assert(clientEntryPoints.length > 0, "Client components were found, so the boundary scan below is meaningful");

  const clientClosure = new Set<string>();
  const pending = [...clientEntryPoints];
  while (pending.length > 0) {
    const file = pending.pop()!;
    if (clientClosure.has(file)) continue;
    clientClosure.add(file);
    for (const dep of importsOf(file)) if (!clientClosure.has(dep)) pending.push(dep);
  }

  const serverOnlyModules = [
    "provider-registry.server.ts",
    "config.ts",
    "raw-orchestration.ts",
    "raw-ingestion.ts",
    "raw-encoding.ts",
    "row-contract.ts",
  ];
  for (const serverModule of serverOnlyModules) {
    assert(
      !clientClosure.has(path.join(fantasyDir, serverModule)),
      `No client component reaches ${serverModule} through any import chain`,
    );
  }
  assert(
    clientClosure.has(path.join(fantasyDir, "source-state.ts")),
    "Client components do reach the client-safe source-state module (the scan follows real import chains)",
  );

  assert(INSTALLED_LIVE_PROVIDERS.length === 0, "The installed live-provider registry is empty");
  assert(isLiveConfigurationComplete(null, { ANY_KEY: "value" }) === false, "No registered provider means configuration is never complete");

  const registrationSample: FantasyProviderRegistration = {
    providerId: "test-registration",
    contractVersion: FANTASY_ROW_CONTRACT_V1,
    deliveryMode: "FULL_SNAPSHOT",
    implementationStatus: "IMPLEMENTED",
    supportsDryRunFetch: true,
    simulated: false,
    requiredConfigKeys: ["TEST_FANTASY_SECRET_KEY"],
    stampsRunProviderId: false,
  };
  assert(
    isLiveConfigurationComplete(registrationSample, { TEST_FANTASY_SECRET_KEY: "" }) === false,
    "An empty required key leaves configuration incomplete",
  );
  assert(
    isLiveConfigurationComplete(registrationSample, { TEST_FANTASY_SECRET_KEY: "present" }) === true,
    "A present required key completes configuration",
  );
  const publicView = toPublicCapabilities(registrationSample);
  assert(!("requiredConfigKeys" in publicView), "The public capability view drops the configuration key names");
  assert(!("stampsRunProviderId" in publicView), "The public capability view drops server-only registration details");
  assert(
    !JSON.stringify(publicView).includes("TEST_FANTASY_SECRET_KEY"),
    "No configuration key name survives into the public capability view",
  );

  const fixtureConfig = getFantasySourceConfiguration({ FANTASY_SOURCE_MODE: "FIXTURE_SIMULATION" });
  assert(typeof fixtureConfig.configurationComplete === "boolean", "Configuration completeness leaves the server as a boolean");
  assert(
    !Object.values(fixtureConfig).some((v) => typeof v === "string" && v.includes("FANTASY_SOURCE_MODE")),
    "The resolved configuration carries no environment variable name",
  );

  // Built client assets, when a production build is present.
  const clientChunkDir = path.join(process.cwd(), ".next", "static");
  if (existsSync(clientChunkDir)) {
    const assets = walkTs(clientChunkDir).concat(
      readdirSync(clientChunkDir, { withFileTypes: true, recursive: true } as never)
        .filter((e: unknown) => (e as { isFile(): boolean }).isFile())
        .map((e: unknown) => {
          const entry = e as { name: string; parentPath?: string; path?: string };
          return path.join(entry.parentPath ?? entry.path ?? clientChunkDir, entry.name);
        }),
    );
    const scripts = assets.filter((f) => /\.(js|mjs)$/.test(f));
    const leaking = scripts.filter((f) => readFileSync(f, "utf8").includes("FANTASY_SOURCE_MODE"));
    assert(leaking.length === 0, `No built client asset names the source-mode environment variable (scanned ${scripts.length})`);
  } else {
    assert(true, "No built client assets present to scan — run after a production build for the asset-level check");
  }

  // =========================================================================
  section("B3. History is scoped to the configured source");
  // =========================================================================
  const fixtureScope = fantasySyncRunScope("FIXTURE_SIMULATION", "SUCCESS");
  assert(fixtureScope?.isSimulated === true, "The fixture history query requires isSimulated = true");
  assert(
    JSON.stringify(fixtureScope?.sourceMode.in) === JSON.stringify(["FIXTURE", "FIXTURE_SIMULATION"]),
    "The fixture history query reads both the legacy and current fixture mode names",
  );
  const liveScope = fantasySyncRunScope("LIVE_FANTASY", "SUCCESS");
  assert(liveScope?.isSimulated === false, "The live history query requires isSimulated = false");
  assert(
    JSON.stringify(liveScope?.sourceMode.in) === JSON.stringify(["FANTASY_API", "LIVE_FANTASY"]),
    "The live history query reads both the legacy and current live mode names",
  );
  assert(fantasySyncRunScope("NOT_CONFIGURED", "SUCCESS") === null, "An unconfigured source reads no history at all");

  // Real rows of each kind, in one table, read back through the real resolver.
  const runStamp = Date.now();
  const makeRun = (o: { status: string; sourceMode: string; isSimulated: boolean; at: Date }) =>
    db.integrationSyncRun.create({
      data: {
        source: "Fantasy",
        entity: "ALL",
        status: o.status,
        sourceMode: o.sourceMode,
        isSimulated: o.isSimulated,
        batchId: `P4-HIST-${runStamp}-${o.sourceMode}-${o.status}`,
        startedAt: o.at,
        finishedAt: o.at,
      },
    });

  const fixtureSuccessAt = new Date(NOW.getTime() - 30 * 60 * 1000);
  const fixtureFailureAt = new Date(NOW.getTime() - 20 * 60 * 1000);
  const liveSuccessAt = new Date(NOW.getTime() - 10 * 60 * 1000);
  const liveFailureAt = new Date(NOW.getTime() - 5 * 60 * 1000);
  const unknownModeAt = new Date(NOW.getTime() - 1 * 60 * 1000);

  await makeRun({ status: "SUCCESS", sourceMode: "FIXTURE", isSimulated: true, at: fixtureSuccessAt });
  await makeRun({ status: "FAILED", sourceMode: "FIXTURE", isSimulated: true, at: fixtureFailureAt });
  await makeRun({ status: "SUCCESS", sourceMode: "FANTASY_API", isSimulated: false, at: liveSuccessAt });
  await makeRun({ status: "FAILED", sourceMode: "FANTASY_API", isSimulated: false, at: liveFailureAt });
  await makeRun({ status: "SUCCESS", sourceMode: "FILE_IMPORT", isSimulated: true, at: unknownModeAt });

  const fixtureWithHistory = await resolveFantasySourceStateWithHistory(db, {
    env: { FANTASY_SOURCE_MODE: "FIXTURE_SIMULATION" },
    now: NOW,
  });
  const newestFixtureSuccess = await db.integrationSyncRun.findFirst({
    where: fantasySyncRunScope("FIXTURE_SIMULATION", "SUCCESS")!,
    orderBy: { startedAt: "desc" },
    select: { finishedAt: true, startedAt: true },
  });
  const newestFixtureFailure = await db.integrationSyncRun.findFirst({
    where: fantasySyncRunScope("FIXTURE_SIMULATION", "FAILED")!,
    orderBy: { startedAt: "desc" },
    select: { finishedAt: true, startedAt: true },
  });
  const expectedSuccess = (newestFixtureSuccess?.finishedAt ?? newestFixtureSuccess?.startedAt)?.toISOString() ?? null;
  const expectedFailure = (newestFixtureFailure?.finishedAt ?? newestFixtureFailure?.startedAt)?.toISOString() ?? null;
  assert(fixtureWithHistory.lastSuccessAt === expectedSuccess, "Fixture state reads the newest fixture success");
  assert(fixtureWithHistory.lastFailureAt === expectedFailure, "Fixture state reads the newest fixture failure");
  assert(fixtureWithHistory.lastSuccessAt !== liveSuccessAt.toISOString(), "Fixture state never reports the live success as its own");
  assert(fixtureWithHistory.lastFailureAt !== liveFailureAt.toISOString(), "Fixture state never reports the live failure as its own");
  assert(fixtureWithHistory.effectiveState === "FIXTURE_SIMULATION", "A live failure does not alter fixture presentation");
  assert(fixtureWithHistory.isSimulated === true, "A live success does not stop fixture data being marked simulated");

  const unknownModeRow = await db.integrationSyncRun.findFirst({
    where: { batchId: `P4-HIST-${runStamp}-FILE_IMPORT-SUCCESS` },
    select: { startedAt: true },
  });
  assert(unknownModeRow !== null, "The unknown-mode run really is stored, so the exclusion below is meaningful");
  assert(
    fixtureWithHistory.lastSuccessAt !== unknownModeRow?.startedAt.toISOString(),
    "A run recorded under an unknown source mode proves nothing and is excluded",
  );

  // The live scope, read against the same table, sees only the live rows.
  const liveSuccessRow = await db.integrationSyncRun.findFirst({
    where: liveScope!,
    orderBy: { startedAt: "desc" },
    select: { startedAt: true, sourceMode: true, isSimulated: true },
  });
  assert(liveSuccessRow?.sourceMode === "FANTASY_API", "The live history query returns a live run");
  assert(liveSuccessRow?.isSimulated === false, "The live history query never returns a simulated run");
  const fixtureSuccessRow = await db.integrationSyncRun.findFirst({
    where: fixtureScope!,
    orderBy: { startedAt: "desc" },
    select: { startedAt: true, sourceMode: true, isSimulated: true },
  });
  assert(fixtureSuccessRow?.isSimulated === true, "The fixture history query never returns a live run");
  assert(fixtureSuccessRow?.sourceMode === "FIXTURE", "The fixture history query returns the fixture run");

  // With a fixture success on record, live still cannot be called ready.
  const liveWithFixtureHistory = await resolveFantasySourceStateWithHistory(db, {
    env: { FANTASY_SOURCE_MODE: "LIVE_FANTASY" },
    now: NOW,
  });
  assert(liveWithFixtureHistory.effectiveState !== "LIVE_FANTASY", "A fixture success cannot make live mode ready");
  assert(liveWithFixtureHistory.effectiveState === "NOT_CONFIGURED", "Live stays not configured while no live provider is installed");

  // Provider-specific evidence: history that cannot be attributed is not readiness.
  const liveReadyInputs = {
    configuredMode: "LIVE_FANTASY",
    configuredReasonCode: "LIVE_SOURCE_READY",
    providerInstalled: true,
    configurationComplete: true,
    providerHealth: "READY",
    lastSuccessAt: RECENT,
    lastFailureAt: null,
    now: NOW,
  } as const;
  const untrustedHistory = deriveEffectiveSourceState({ ...liveReadyInputs });
  assert(untrustedHistory.effectiveState === "LIVE_FANTASY_DEGRADED", "Live history that cannot be attributed to the provider leaves the source degraded");
  assert(untrustedHistory.reasonCode === "LIVE_PROVIDER_HISTORY_UNVERIFIED", "Unattributable live history reports its own fixed reason code");
  assert(
    deriveEffectiveSourceState({ ...liveReadyInputs, providerHistoryTrusted: true }).effectiveState === "LIVE_FANTASY",
    "A provider that can prove its own history may reach LIVE_FANTASY",
  );

  // Freshness threshold validation.
  assert(isUsableFreshnessWindow(60_000) === true, "A finite positive freshness window is usable");
  for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    assert(isUsableFreshnessWindow(bad) === false, `A freshness window of ${String(bad)} is refused`);
    const derived = deriveEffectiveSourceState({ ...liveReadyInputs, providerHistoryTrusted: true, freshnessWindowMs: bad });
    assert(derived.effectiveState === "LIVE_FANTASY_DEGRADED", `A freshness window of ${String(bad)} fails closed to degraded`);
    assert(derived.reasonCode === "LIVE_FRESHNESS_WINDOW_INVALID", `A freshness window of ${String(bad)} reports the invalid-window code`);
  }
  assert(isUsableFreshnessWindow("6h") === false, "A non-numeric freshness window is refused");

  // Rows inserted above are deliberate test history, so later isolation checks measure
  // from here rather than from the start of the suite.
  const postHistoryBaseline = await canonicalSnapshot();

  // =========================================================================
  section("B4. Capability consistency is enforced before any fetch");
  // =========================================================================
  const capabilityBaseline = await canonicalSnapshot();
  const fixtureBaseState = resolveFantasySourceState({ env: { FANTASY_SOURCE_MODE: "FIXTURE_SIMULATION" }, now: NOW });
  const injectedLiveState = { ...fixtureBaseState, effectiveState: "LIVE_FANTASY" as const, isSimulated: false };
  const injectedDegradedState = { ...fixtureBaseState, effectiveState: "LIVE_FANTASY_DEGRADED" as const, isSimulated: false };

  let fetchCount = 0;
  const countingFetch = () => {
    fetchCount++;
  };

  const simulatedOk = makeTestProvider({ simulated: true, onFetch: countingFetch });
  fetchCount = 0;
  const allowedFixture = await orchestrateFantasyRawIngestion({
    mode: "DRY_RUN",
    context: createFantasyProviderContext({ sourceState: FIXTURE_STATE, provider: simulatedOk.provider, capabilities: simulatedOk.capabilities }),
    db,
  });
  assert(allowedFixture.outcome === "INGESTED", "Fixture state plus a simulated connector is allowed");
  assert(fetchCount === 1, "The allowed combination did reach the connector");

  const realUnderFixture = makeTestProvider({ simulated: false, onFetch: countingFetch });
  fetchCount = 0;
  const refusedRealUnderFixture = await orchestrateFantasyRawIngestion({
    mode: "PERSIST",
    context: createFantasyProviderContext({ sourceState: FIXTURE_STATE, provider: realUnderFixture.provider, capabilities: realUnderFixture.capabilities }),
    db,
  });
  assert(
    refusedRealUnderFixture.outcome === "REFUSED" && refusedRealUnderFixture.failureCode === "PROVIDER_SIMULATION_MISMATCH",
    "Fixture state plus a non-simulated connector is refused",
  );
  assert(fetchCount === 0, "A non-simulated connector under fixture state is refused before any fetch");

  const simulatedUnderLive = makeTestProvider({ simulated: true, onFetch: countingFetch });
  fetchCount = 0;
  const refusedSimulatedUnderLive = await orchestrateFantasyRawIngestion({
    mode: "PERSIST",
    context: createFantasyProviderContext({ sourceState: injectedLiveState, provider: simulatedUnderLive.provider, capabilities: simulatedUnderLive.capabilities }),
    db,
  });
  assert(
    refusedSimulatedUnderLive.outcome === "REFUSED" && refusedSimulatedUnderLive.failureCode === "PROVIDER_SIMULATION_MISMATCH",
    "Live state plus a simulated connector is refused",
  );
  assert(fetchCount === 0, "A simulated connector under live state is refused before any fetch");
  assert(
    !JSON.stringify(refusedSimulatedUnderLive).includes("SIMULATED-"),
    "A simulation mismatch never presents the simulated connector's data as live",
  );

  const realUnderLive = makeTestProvider({ simulated: false, onFetch: countingFetch });
  const allowedLive = await orchestrateFantasyRawIngestion({
    mode: "DRY_RUN",
    context: createFantasyProviderContext({ sourceState: injectedLiveState, provider: realUnderLive.provider, capabilities: realUnderLive.capabilities }),
    db,
  });
  assert(allowedLive.outcome === "INGESTED", "Live state plus a non-simulated implemented connector proceeds in an injected test context");
  assert(allowedLive.outcome === "INGESTED" && allowedLive.providerSimulated === false, "A non-simulated connector is never reported as simulated");

  const realUnderDegraded = makeTestProvider({ simulated: false });
  const allowedDegraded = await orchestrateFantasyRawIngestion({
    mode: "DRY_RUN",
    context: createFantasyProviderContext({ sourceState: injectedDegradedState, provider: realUnderDegraded.provider, capabilities: realUnderDegraded.capabilities }),
    db,
  });
  assert(allowedDegraded.outcome === "INGESTED", "A degraded live source may retry with a real connector");
  const simulatedUnderDegraded = makeTestProvider({ simulated: true });
  const refusedSimulatedDegraded = await orchestrateFantasyRawIngestion({
    mode: "DRY_RUN",
    context: createFantasyProviderContext({ sourceState: injectedDegradedState, provider: simulatedUnderDegraded.provider, capabilities: simulatedUnderDegraded.capabilities }),
    db,
  });
  assert(
    refusedSimulatedDegraded.outcome === "REFUSED" && refusedSimulatedDegraded.failureCode === "PROVIDER_SIMULATION_MISMATCH",
    "A degraded live source cannot retry with a simulated connector",
  );

  fetchCount = 0;
  const unconfiguredNeverFetches = makeTestProvider({ onFetch: countingFetch });
  const refusedUnconfiguredFetch = await orchestrateFantasyRawIngestion({
    mode: "PERSIST",
    context: createFantasyProviderContext({ sourceState: UNCONFIGURED_STATE, provider: unconfiguredNeverFetches.provider, capabilities: unconfiguredNeverFetches.capabilities }),
    db,
  });
  assert(refusedUnconfiguredFetch.outcome === "REFUSED", "A not-configured source refuses orchestration");
  assert(fetchCount === 0, "A not-configured source never calls the connector");

  fetchCount = 0;
  const noDryRun = makeTestProvider({ supportsDryRunFetch: false, onFetch: countingFetch });
  const refusedDryRun = await orchestrateFantasyRawIngestion({
    mode: "DRY_RUN",
    context: createFantasyProviderContext({ sourceState: FIXTURE_STATE, provider: noDryRun.provider, capabilities: noDryRun.capabilities }),
    db,
  });
  assert(
    refusedDryRun.outcome === "REFUSED" && refusedDryRun.failureCode === "DRY_RUN_FETCH_NOT_SUPPORTED",
    "A dry run against a connector that cannot preview is refused",
  );
  assert(fetchCount === 0, "An unsupported dry run never reaches the connector");
  const persistWithoutDryRun = await orchestrateFantasyRawIngestion({
    mode: "PERSIST",
    context: createFantasyProviderContext({ sourceState: FIXTURE_STATE, provider: noDryRun.provider, capabilities: noDryRun.capabilities }),
    db,
  });
  assert(persistWithoutDryRun.outcome === "INGESTED", "The same connector still serves a normal persist");

  const supportedDryRunBaseline = { batches: await db.fantasyRawBatch.count(), rows: await db.fantasyRawRow.count() };
  const dryRunSupported = makeTestProvider({ supportsDryRunFetch: true });
  const dryRunAllowed = await orchestrateFantasyRawIngestion({
    mode: "DRY_RUN",
    context: createFantasyProviderContext({ sourceState: FIXTURE_STATE, provider: dryRunSupported.provider, capabilities: dryRunSupported.capabilities }),
    db,
  });
  assert(dryRunAllowed.outcome === "INGESTED" && dryRunAllowed.rawBatchId === null, "A supported dry run still allocates no raw batch");
  assert(
    (await db.fantasyRawBatch.count()) === supportedDryRunBaseline.batches &&
      (await db.fantasyRawRow.count()) === supportedDryRunBaseline.rows,
    "A supported dry run keeps the zero-write guarantee",
  );

  // An unbranded context — the shape a caller could assemble by hand — is refused.
  const handBuilt = makeTestProvider();
  const rawBatchesBeforeUnbranded = await db.fantasyRawBatch.count();
  const refusedUnbranded = await orchestrateFantasyRawIngestion({
    mode: "PERSIST",
    context: {
      sourceState: FIXTURE_STATE,
      capabilities: handBuilt.capabilities,
      provider: handBuilt.provider,
    } as unknown as Parameters<typeof orchestrateFantasyRawIngestion>[0]["context"],
    db,
  });
  assert(
    refusedUnbranded.outcome === "REFUSED" && refusedUnbranded.failureCode === "SOURCE_PROVIDER_MISMATCH",
    "A context that did not come from the server registry is refused at run time",
  );
  assert((await db.fantasyRawBatch.count()) === rawBatchesBeforeUnbranded, "A refused mismatch creates no raw batch");
  assert(
    isFantasyProviderContext(
      createFantasyProviderContext({ sourceState: FIXTURE_STATE, provider: handBuilt.provider, capabilities: handBuilt.capabilities }),
    ),
    "A registry-created context is recognized",
  );
  assert(!isFantasyProviderContext({ sourceState: FIXTURE_STATE }), "A partial object is not recognized as a context");

  // Refusals cost nothing and say nothing.
  for (const refusal of [
    refusedRealUnderFixture, refusedSimulatedUnderLive, refusedSimulatedDegraded,
    refusedUnconfiguredFetch, refusedDryRun, refusedUnbranded,
  ]) {
    const text = JSON.stringify(refusal);
    assert(!text.includes("SIMULATED-"), `A ${refusal.outcome === "REFUSED" ? refusal.failureCode : "?"} refusal carries no source value`);
    assert(
      !text.includes("FANTASY_SOURCE_MODE") && !text.includes("TEST_FANTASY_SECRET_KEY"),
      `A ${refusal.outcome === "REFUSED" ? refusal.failureCode : "?"} refusal carries no configuration detail`,
    );
  }
  const afterRefusals = await canonicalSnapshot();
  assert(
    JSON.stringify(afterRefusals.counts) === JSON.stringify(capabilityBaseline.counts),
    "Refused orchestration changes no canonical table",
  );
  assert(
    JSON.stringify(afterRefusals.checkpoints) === JSON.stringify(capabilityBaseline.checkpoints),
    "Refused orchestration changes no checkpoint",
  );


  // =========================================================================
  section("C. Orchestration into Phase 3A");
  // =========================================================================
  const dryRunTarget = makeTestProvider();
  const dryBefore = { batches: await db.fantasyRawBatch.count(), rows: await db.fantasyRawRow.count() };
  const dryResult = await orchestrateFantasyRawIngestion({
    mode: "DRY_RUN",
    context: createFantasyProviderContext({ sourceState: FIXTURE_STATE, provider: dryRunTarget.provider, capabilities: dryRunTarget.capabilities }),
    db,
  });
  assert(dryResult.outcome === "INGESTED", "A test provider batch reaches Phase 3A dry run");
  assert(dryResult.outcome === "INGESTED" && dryResult.rawBatchId === null, "A dry run allocates no raw batch identifier");
  assert(dryResult.outcome === "INGESTED" && dryResult.counts.received === 2, "A dry run reports what would have been ingested");
  assert(
    (await db.fantasyRawBatch.count()) === dryBefore.batches && (await db.fantasyRawRow.count()) === dryBefore.rows,
    "A dry run creates no database rows",
  );

  const persistTarget = makeTestProvider({ batchId: "P4-PERSIST-1" });
  const persisted = await orchestrateFantasyRawIngestion({
    mode: "PERSIST",
    context: createFantasyProviderContext({ sourceState: FIXTURE_STATE, provider: persistTarget.provider, capabilities: persistTarget.capabilities }),
    db,
  });
  assert(persisted.outcome === "INGESTED", "A test provider batch reaches Phase 3A persistence");
  const persistedBatchId = persisted.outcome === "INGESTED" ? persisted.rawBatchId : null;
  assert(persistedBatchId !== null, "Persistence returns the raw batch identifier");
  assert((await db.fantasyRawBatch.count({ where: { providerBatchId: "P4-PERSIST-1" } })) === 1, "Persistence creates exactly one raw batch");
  assert((await db.fantasyRawRow.count({ where: { batchId: persistedBatchId! } })) === 2, "Persistence creates the raw rows only");
  assert(persisted.outcome === "INGESTED" && persisted.providerSimulated === true, "The orchestration result carries the provider's simulated declaration");

  const afterOrchestration = await canonicalSnapshot();
  assert(JSON.stringify(afterOrchestration.counts) === JSON.stringify(postHistoryBaseline.counts), "Orchestration creates no canonical record");
  assert(JSON.stringify(afterOrchestration.checkpoints) === JSON.stringify(before.checkpoints), "Orchestration does not change the synchronization checkpoint");

  const replay = await orchestrateFantasyRawIngestion({
    mode: "PERSIST",
    context: createFantasyProviderContext({ sourceState: FIXTURE_STATE, provider: persistTarget.provider, capabilities: persistTarget.capabilities }),
    db,
  });
  assert(replay.outcome === "INGESTED" && replay.idempotentReplay === true, "An exact replay through orchestration keeps Phase 3A idempotency");
  assert(replay.outcome === "INGESTED" && replay.rawBatchId === persistedBatchId, "An exact replay resolves to the stored raw batch");
  assert((await db.fantasyRawBatch.count({ where: { providerBatchId: "P4-PERSIST-1" } })) === 1, "An exact replay stores no second batch");

  const conflicting = makeTestProvider({ batchId: "P4-PERSIST-1", rows: [syntheticRow("SIMULATED-LOT-DIFFERENT")] });
  const conflictResult = await orchestrateFantasyRawIngestion({
    mode: "PERSIST",
    context: createFantasyProviderContext({ sourceState: FIXTURE_STATE, provider: conflicting.provider, capabilities: conflicting.capabilities }),
    db,
  });
  assert(conflictResult.outcome === "INGESTED" && conflictResult.conflict === true, "A conflicting batch identity keeps Phase 3A conflict behaviour");
  assert(conflictResult.outcome === "INGESTED" && conflictResult.batchStatus === "CONFLICT", "The conflicting batch is stored as CONFLICT");

  // Refusals.
  const unconfiguredTarget = makeTestProvider();
  const refusedUnconfigured = await orchestrateFantasyRawIngestion({
    mode: "PERSIST",
    context: createFantasyProviderContext({ sourceState: UNCONFIGURED_STATE, provider: unconfiguredTarget.provider, capabilities: unconfiguredTarget.capabilities }),
    db,
  });
  assert(
    refusedUnconfigured.outcome === "REFUSED" && refusedUnconfigured.failureCode === "SOURCE_NOT_CONFIGURED",
    "An unconfigured source refuses orchestration with a fixed code",
  );

  const notImplemented = makeTestProvider({ implementationStatus: "NOT_IMPLEMENTED" });
  const refusedNotImplemented = await orchestrateFantasyRawIngestion({
    mode: "PERSIST",
    context: createFantasyProviderContext({ sourceState: FIXTURE_STATE, provider: notImplemented.provider, capabilities: notImplemented.capabilities }),
    db,
  });
  assert(
    refusedNotImplemented.outcome === "REFUSED" && refusedNotImplemented.failureCode === "PROVIDER_NOT_IMPLEMENTED",
    "An unimplemented provider refuses orchestration with a fixed code",
  );

  const rawBeforeMismatch = await db.fantasyRawBatch.count();
  const badContract = makeTestProvider({ contractVersion: "FANTASY_ROW_CONTRACT_V9" });
  const refusedContract = await orchestrateFantasyRawIngestion({
    mode: "PERSIST",
    context: createFantasyProviderContext({ sourceState: FIXTURE_STATE, provider: badContract.provider, capabilities: badContract.capabilities }),
    db,
  });
  assert(
    refusedContract.outcome === "REFUSED" && refusedContract.failureCode === "CONTRACT_VERSION_MISMATCH",
    "An unsupported contract version fails before persistence",
  );
  assert((await db.fantasyRawBatch.count()) === rawBeforeMismatch, "A contract mismatch writes nothing");

  const batchVersionMismatch = makeTestProvider({ batchContractVersion: "FANTASY_ROW_CONTRACT_V9" });
  const refusedBatchVersion = await orchestrateFantasyRawIngestion({
    mode: "PERSIST",
    context: createFantasyProviderContext({ sourceState: FIXTURE_STATE, provider: batchVersionMismatch.provider, capabilities: batchVersionMismatch.capabilities }),
    db,
  });
  assert(
    refusedBatchVersion.outcome === "REFUSED" && refusedBatchVersion.failureCode === "CONTRACT_VERSION_MISMATCH",
    "A batch that disagrees with its provider's declared version fails safely",
  );
  assert((await db.fantasyRawBatch.count()) === rawBeforeMismatch, "A provider/batch version mismatch writes nothing");

  const exploding = makeTestProvider({ throws: true, deliveryMode: "PROVIDER_CURSOR" });
  const refusedProvider = await orchestrateFantasyRawIngestion({
    mode: "PERSIST",
    context: createFantasyProviderContext({ sourceState: FIXTURE_STATE, provider: exploding.provider, capabilities: exploding.capabilities }),
    db,
    cursor: { kind: "PROVIDER_SUPPLIED", token: "CURSOR-TOKEN-SECRET" },
  });
  assert(
    refusedProvider.outcome === "REFUSED" && refusedProvider.failureCode === "PROVIDER_UNAVAILABLE",
    "A provider error returns a safe code",
  );
  const providerErrorText = JSON.stringify(refusedProvider);
  assert(!providerErrorText.includes("exploded"), "A provider exception message is never returned");
  assert(!providerErrorText.includes("CURSOR-TOKEN-SECRET"), "A provider error never leaks the cursor token");
  assert(!providerErrorText.includes("SIMULATED-Lot-SECRET"), "A provider error never leaks source data it quoted");

  const failingIngestionDb: RawIngestionDb = {
    $transaction: () => Promise.reject(new Error("prisma exploded on SIMULATED-LOT-1")),
  };
  const ingestionTarget = makeTestProvider();
  const refusedIngestion = await orchestrateFantasyRawIngestion({
    mode: "PERSIST",
    context: createFantasyProviderContext({ sourceState: FIXTURE_STATE, provider: ingestionTarget.provider, capabilities: ingestionTarget.capabilities }),
    db: failingIngestionDb,
  });
  assert(
    refusedIngestion.outcome === "REFUSED" && refusedIngestion.failureCode === "RAW_INGESTION_FAILED",
    "A raw-ingestion error returns a safe code",
  );
  assert(!JSON.stringify(refusedIngestion).includes("prisma exploded"), "A database error message is never returned");

  const noBatch = makeTestProvider({ returnsNull: true });
  const noBatchResult = await orchestrateFantasyRawIngestion({
    mode: "PERSIST",
    context: createFantasyProviderContext({ sourceState: FIXTURE_STATE, provider: noBatch.provider, capabilities: noBatch.capabilities }),
    db,
  });
  assert(noBatchResult.outcome === "NO_BATCH", "A provider with nothing to deliver reports NO_BATCH rather than failing");

  // Nothing returned may contain source rows or a cursor token.
  const resultsToScan: RawOrchestrationResult[] = [dryResult, persisted, replay, conflictResult, refusedUnconfigured, refusedNotImplemented, refusedContract, refusedProvider, refusedIngestion, noBatchResult];
  const scanned = JSON.stringify(resultsToScan);
  assert(!scanned.includes("SIMULATED-Shape"), "No orchestration result contains source rows");
  assert(!scanned.includes("SIMULATED-Remark"), "No orchestration result contains source field values");
  assert(!scanned.includes("PROVIDER-CURSOR-TOKEN-SECRET"), "No orchestration result contains a provider cursor token");
  assert(!scanned.includes("CURSOR-TOKEN-SECRET"), "No orchestration result contains a caller-supplied cursor token");
  assert(!/"rows"|"headers"|"rawPayload"/.test(scanned), "No orchestration result carries a raw payload field");

  // =========================================================================
  section("D. Cursor and capability handling");
  // =========================================================================
  const snapshotCursors: FantasySourceCursor[] = [];
  const snapshotProvider = makeTestProvider({ onFetch: (c) => snapshotCursors.push(c) });
  const snapshotResult = await orchestrateFantasyRawIngestion({
    mode: "DRY_RUN",
    context: createFantasyProviderContext({ sourceState: FIXTURE_STATE, provider: snapshotProvider.provider, capabilities: snapshotProvider.capabilities }),
    db,
  });
  assert(snapshotResult.outcome === "INGESTED", "A full-snapshot provider works without a cursor token");
  assert(snapshotCursors[0]?.kind === "FULL_SNAPSHOT" && snapshotCursors[0]?.token === null, "A full-snapshot provider is handed an explicit empty cursor");

  const cursorSeen: FantasySourceCursor[] = [];
  const cursorProvider = makeTestProvider({ deliveryMode: "PROVIDER_CURSOR", onFetch: (c) => cursorSeen.push(c) });
  const cursorResult = await orchestrateFantasyRawIngestion({
    mode: "PERSIST",
    context: createFantasyProviderContext({ sourceState: FIXTURE_STATE, provider: cursorProvider.provider, capabilities: cursorProvider.capabilities }),
    db,
    cursor: { kind: "PROVIDER_SUPPLIED", token: "CURSOR-TOKEN-SECRET" },
  });
  assert(cursorResult.outcome === "INGESTED", "A provider-cursor provider can be orchestrated");
  assert(cursorSeen[0]?.token === "CURSOR-TOKEN-SECRET", "The opaque cursor token reaches the provider in memory");
  const cursorBatchId = cursorResult.outcome === "INGESTED" ? cursorResult.rawBatchId : null;
  const cursorBatchRow = await db.fantasyRawBatch.findUniqueOrThrow({ where: { id: cursorBatchId! } });
  assert(cursorBatchRow.cursorKind === "PROVIDER_SUPPLIED", "Cursor capability is stored separately from the row data");
  assert(!JSON.stringify(cursorBatchRow).includes("PROVIDER-CURSOR-TOKEN-SECRET"), "The raw cursor token is never persisted");
  assert(!JSON.stringify(cursorResult).includes("cursor"), "The orchestration result exposes no cursor field at all");

  const storedRawRows = await db.fantasyRawRow.findMany({ where: { batchId: cursorBatchId! } });
  const rowPayload = storedRawRows.map((r) => r.rawPayloadJson).join(" ");
  assert(rowPayload.includes("SIMULATED-Doc Date"), "Date columns are stored as ordinary row data");
  assert(cursorBatchRow.cursorTokenHash !== null && !rowPayload.includes(cursorBatchRow.cursorTokenHash), "No date or document field is derived from or used as a cursor");
  assert(cursorBatchRow.providerBatchId !== cursorBatchRow.cursorTokenHash, "The batch identifier is not used as a cursor");

  const snapshotWithToken = makeTestProvider({
    deliveryMode: "FULL_SNAPSHOT",
    cursorOverride: { kind: "PROVIDER_SUPPLIED", token: "UNEXPLAINED-TOKEN" },
  });
  const mismatchA = await orchestrateFantasyRawIngestion({
    mode: "PERSIST",
    context: createFantasyProviderContext({ sourceState: FIXTURE_STATE, provider: snapshotWithToken.provider, capabilities: snapshotWithToken.capabilities }),
    db,
  });
  assert(
    mismatchA.outcome === "REFUSED" && mismatchA.failureCode === "DELIVERY_MODE_MISMATCH",
    "A snapshot provider returning an unexplained incremental token fails closed",
  );
  assert(!JSON.stringify(mismatchA).includes("UNEXPLAINED-TOKEN"), "A delivery-mode refusal never echoes the token");

  const cursorWithSnapshot = makeTestProvider({
    deliveryMode: "PROVIDER_CURSOR",
    cursorOverride: { kind: "FULL_SNAPSHOT", token: null },
  });
  const mismatchB = await orchestrateFantasyRawIngestion({
    mode: "PERSIST",
    context: createFantasyProviderContext({ sourceState: FIXTURE_STATE, provider: cursorWithSnapshot.provider, capabilities: cursorWithSnapshot.capabilities }),
    db,
  });
  assert(
    mismatchB.outcome === "REFUSED" && mismatchB.failureCode === "DELIVERY_MODE_MISMATCH",
    "A cursor provider returning a snapshot fails closed",
  );

  // =========================================================================
  section("E. RBAC and sanitized presentation");
  // =========================================================================
  resetRateLimits();
  const stamp = Date.now();
  const integrator = await makeUser(`p4-integrator-${stamp}`, "FANTASY_INTEGRATION");
  const reader = await makeUser(`p4-reader-${stamp}`, "MFG_VIEWER");
  const outsider = await makeUser(`p4-outsider-${stamp}`, "SALES_VIEWER");

  const anonStatus = await call(syncGET, { path: "/api/fantasy/sync" });
  assert(anonStatus.status === 401, `Unauthenticated source-status access is rejected (got ${anonStatus.status})`);
  const deniedStatus = await call(syncGET, { path: "/api/fantasy/sync", cookie: outsider.cookie });
  assert(deniedStatus.status === 403, `Unauthorized source-status access is rejected (got ${deniedStatus.status})`);
  assert(deniedStatus.json?.sourceState === undefined, "A denied source-status request returns no source state");

  const deniedSync = await call(syncPOST, { method: "POST", path: "/api/fantasy/sync", cookie: reader.cookie });
  assert(deniedSync.status === 403, `Unauthorized synchronization execution is rejected (got ${deniedSync.status})`);
  const anonSync = await call(syncPOST, { method: "POST", path: "/api/fantasy/sync" });
  assert(anonSync.status === 401, `Unauthenticated synchronization execution is rejected (got ${anonSync.status})`);

  const authorizedStatus = await call(syncGET, { path: "/api/fantasy/sync", cookie: integrator.cookie });
  assert(authorizedStatus.status === 200, "An authorized role can read the source status");
  const state = authorizedStatus.json?.sourceState;
  assert(state !== undefined, "The status response carries the centrally derived source state");
  assert(state?.effectiveState === "FIXTURE_SIMULATION", "The configured fixture source is reported as Fixture Simulation");
  assert(state?.isSimulated === true, "The status response marks fixture data as simulated");
  assert(state?.statusLabel === "Fixture Simulation", "The fixture UI label says simulation, not live");
  assert(typeof state?.configurationComplete === "boolean", "Configuration completeness is a boolean only");
  assert(state?.providerInstalled === false, "The status response reports that no live provider is installed");

  const stateKeys = Object.keys(state ?? {});
  const allowedKeys = [
    "configuredMode", "effectiveState", "runtimeHealth", "isSimulated", "providerInstalled",
    "configurationComplete", "lastSuccessAt", "lastFailureAt", "reasonCode", "statusLabel", "statusExplanation",
  ];
  assert(stateKeys.every((k) => allowedKeys.includes(k)), `The source state exposes only sanitized fields (${stateKeys.join(", ")})`);
  assert(!stateKeys.some((k) => /token|secret|key|url|password|credential|env/i.test(k)), "No credential-shaped field is exposed");

  const statusText = JSON.stringify(authorizedStatus.json);
  assert(!statusText.includes(process.env.DATABASE_URL ?? "@@none@@"), "No connection string appears in the status response");
  assert(!statusText.includes("FANTASY_SOURCE_MODE"), "No environment variable name appears in the status response");
  assert(!statusText.includes("cursorToken") && !statusText.includes("cursorTokenHash"), "No cursor token or token hash appears in the status response");
  assert(!statusText.includes("rawPayloadJson") && !statusText.includes("normalizedRecordJson"), "No raw payload appears in the status response");
  assert(!statusText.includes("SIMULATED-Shape"), "No raw Fantasy row value appears in the status response");

  // A not-configured source must render a controlled state, never a live claim.
  const previousMode = process.env.FANTASY_SOURCE_MODE;
  process.env.FANTASY_SOURCE_MODE = "FILE_IMPORT";
  try {
    resetRateLimits();
    const unconfiguredStatus = await call(syncGET, { path: "/api/fantasy/sync", cookie: integrator.cookie });
    assert(unconfiguredStatus.status === 200, "An unsupported source renders a controlled status instead of an exception");
    const badState = unconfiguredStatus.json?.sourceState;
    assert(badState?.effectiveState === "NOT_CONFIGURED", "An unsupported source is reported as Not Configured");
    assert(badState?.statusLabel === "Not Configured", "The not-configured UI label does not say live");
    assert(badState?.isSimulated === false, "An unsupported source is not labelled simulated either");
    assert(!JSON.stringify(badState).toLowerCase().includes("live fantasy"), "A not-configured status never mentions a live connection");

    resetRateLimits();
    const runsBeforeRefusal = await db.integrationSyncRun.count();
    const refusedRun = await call(syncPOST, { method: "POST", path: "/api/fantasy/sync", cookie: integrator.cookie });
    assert(refusedRun.status === 409, `An unsupported source refuses synchronization with a controlled status (got ${refusedRun.status})`);
    assert(
      (await db.integrationSyncRun.count()) === runsBeforeRefusal,
      "A refused synchronization creates no run record",
    );
    const lock = await db.syncCheckpoint.findUniqueOrThrow({ where: { source: "FANTASY" } });
    assert(lock.isLocked === false, "A refused synchronization takes no lock");
  } finally {
    if (previousMode === undefined) delete process.env.FANTASY_SOURCE_MODE;
    else process.env.FANTASY_SOURCE_MODE = previousMode;
  }

  // =========================================================================
  section("F. Canonical isolation and the legacy fixture path");
  // =========================================================================
  const historyState = await resolveFantasySourceStateWithHistory(db, { env: { FANTASY_SOURCE_MODE: "FIXTURE_SIMULATION" }, now: NOW });
  assert(historyState.effectiveState === "FIXTURE_SIMULATION", "The history-aware resolver agrees with the pure resolver");
  assert(historyState.isSimulated === true, "The history-aware resolver keeps fixture data marked simulated");

  const finalSnapshot = await canonicalSnapshot();
  assert(
    JSON.stringify(finalSnapshot.counts) === JSON.stringify(postHistoryBaseline.counts),
    "Canonical table counts are unchanged by everything after the deliberate history fixtures",
  );
  assert(JSON.stringify(finalSnapshot.checkpoints) === JSON.stringify(before.checkpoints), "Existing sync checkpoints are unchanged");
  assert((await db.fantasyRawBatch.count()) > 0, "Raw staging did receive the orchestrated batches");

  const orchestrationSource = readFileSync(path.join(process.cwd(), "src", "lib", "fantasy", "raw-orchestration.ts"), "utf8");
  for (const canonical of ["lotMasterRecord", "polishedStone", "roughStone", "salesRecord", "requirement", "planningCase", "planOption", "demandRun", "demandMetric", "syncCheckpoint"]) {
    // A delegate call, not the word: `security requirements` in a comment is not a write.
    assert(!orchestrationSource.includes(`.${canonical}.`), `Orchestration never calls the canonical delegate "${canonical}"`);
  }
  assert(!/new\s+[A-Za-z]*Provider/.test(orchestrationSource), "Orchestration instantiates no provider of its own");
  assert(
    /readonly context: FantasyProviderContext;/.test(orchestrationSource),
    "The orchestrator accepts only a provider context, never a loose provider plus source state",
  );
  assert(
    /if \(!isFantasyProviderContext\(/.test(orchestrationSource),
    "The context brand is checked at run time, not merely typed",
  );

  console.log("\n===============================================================================");
  console.log(`RESULT: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log("Failures:");
    for (const f of failures) console.log(`  - ${f}`);
  }
  console.log("===============================================================================");
  if (failed > 0) process.exit(1);
}

main()
  .catch((e) => {
    console.error("FATAL TEST FAILURE:", e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
