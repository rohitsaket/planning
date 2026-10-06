export const ANALYSIS_SOURCE_MODES = ["FIXTURE_SIMULATION", "LIVE_FANTASY", "NOT_ESTABLISHED"] as const;
export type AnalysisSourceMode = (typeof ANALYSIS_SOURCE_MODES)[number];

export const SIMULATION_BANNER_TEXT = "Fixture Simulation — not live Fantasy data";

export const SIMULATION_EXPORT_NOTICE = "SIMULATED / TEST FIXTURE DATA — not live Fantasy data";

export interface SourceDisclosure {
  readonly mode: AnalysisSourceMode;
  readonly simulated: boolean;
  readonly label: string;
  readonly bannerText: string | null;
}

const LABELS: Record<AnalysisSourceMode, string> = {
  FIXTURE_SIMULATION: "Fixture Simulation",
  LIVE_FANTASY: "Live Fantasy",
  NOT_ESTABLISHED: "Source not established",
};

export function resolveSourceDisclosure(input: {
  isSimulated: boolean | null | undefined;
  hasData: boolean;
}): SourceDisclosure {
  if (!input.hasData || input.isSimulated === null || input.isSimulated === undefined) {
    return {
      mode: "NOT_ESTABLISHED",
      simulated: false,
      label: LABELS.NOT_ESTABLISHED,
      bannerText: null,
    };
  }
  const mode: AnalysisSourceMode = input.isSimulated ? "FIXTURE_SIMULATION" : "LIVE_FANTASY";
  return {
    mode,
    simulated: input.isSimulated,
    label: LABELS[mode],
    bannerText: input.isSimulated ? SIMULATION_BANNER_TEXT : null,
  };
}

export const UNESTABLISHED_SOURCE: SourceDisclosure = resolveSourceDisclosure({
  isSimulated: null,
  hasData: false,
});

export function mergeSourceDisclosures(parts: readonly SourceDisclosure[]): SourceDisclosure {
  if (parts.some((p) => p.mode === "FIXTURE_SIMULATION")) {
    return resolveSourceDisclosure({ isSimulated: true, hasData: true });
  }
  if (parts.some((p) => p.mode === "LIVE_FANTASY")) {
    return resolveSourceDisclosure({ isSimulated: false, hasData: true });
  }
  return UNESTABLISHED_SOURCE;
}
