/**
 * Server Configuration for Fantasy Data Source.
 * The active source mode is controlled strictly server-side.
 */

import { CanonicalSourceMode } from "./canonical";

export interface FantasyServerConfig {
  sourceMode: CanonicalSourceMode;
  isSimulation: boolean;
  fixtureBatchCount: number;
}

export function getFantasyConfig(): FantasyServerConfig {
  // Mode is controlled via server environment, default is FIXTURE
  const rawMode = (process.env.FANTASY_SOURCE_MODE || "FIXTURE").toUpperCase();
  const sourceMode: CanonicalSourceMode =
    rawMode === "FANTASY_API" ? "FANTASY_API" :
    rawMode === "FILE_IMPORT" ? "FILE_IMPORT" : "FIXTURE";

  return {
    sourceMode,
    isSimulation: sourceMode === "FIXTURE",
    fixtureBatchCount: 5,
  };
}
