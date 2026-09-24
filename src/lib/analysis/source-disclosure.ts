/**
 * ANALYSIS SOURCE DISCLOSURE — one statement of where the numbers on a page came from.
 *
 * Every Analysis page can show figures derived from fixture simulation. When it does, it
 * has to say so, on screen, every time. The banner was previously written out by hand in
 * each view from whatever field that view happened to have — `sourceState`, `isSimulated`,
 * or a `sourceLabel` with the words "Source: " already baked into it — and when those
 * views were edited the banner was simply deleted from six of them at once. A page then
 * presented a thousand simulated lots as though they were live.
 *
 * So the disclosure is resolved once, here, from the data the page actually read, and
 * rendered by one shared component. It is never inferred from `NODE_ENV`, from a feature
 * flag, or from any other client-side assumption about what the server is probably doing.
 *
 * Three states, and the third is not the same as either of the others:
 *
 *   - `FIXTURE_SIMULATION` — the records behind this page are simulated. Say so.
 *   - `LIVE_FANTASY`       — the records came from the live source.
 *   - `NOT_ESTABLISHED`    — there are no records to attribute. This is NOT "simulation":
 *                            claiming simulation for an empty page is as wrong as claiming
 *                            live, because nothing has been established either way.
 *
 * This module is deliberately free of database and server-only imports so a client
 * component can hold the type and render the banner.
 */

export const ANALYSIS_SOURCE_MODES = ["FIXTURE_SIMULATION", "LIVE_FANTASY", "NOT_ESTABLISHED"] as const;
export type AnalysisSourceMode = (typeof ANALYSIS_SOURCE_MODES)[number];

/** The exact wording the banner shows. Fixed so no page can soften it. */
export const SIMULATION_BANNER_TEXT = "Fixture Simulation — not live Fantasy data";

/** The wording carried into an export file, which is read away from the screen. */
export const SIMULATION_EXPORT_NOTICE = "SIMULATED / TEST FIXTURE DATA — not live Fantasy data";

export interface SourceDisclosure {
  readonly mode: AnalysisSourceMode;
  /** True only for `FIXTURE_SIMULATION`. The one field a banner needs to decide. */
  readonly simulated: boolean;
  /** Short label for a badge: "Fixture Simulation", "Live Fantasy", "Source not established". */
  readonly label: string;
  /** Banner sentence, or null when there is nothing to disclose. */
  readonly bannerText: string | null;
}

const LABELS: Record<AnalysisSourceMode, string> = {
  FIXTURE_SIMULATION: "Fixture Simulation",
  LIVE_FANTASY: "Live Fantasy",
  NOT_ESTABLISHED: "Source not established",
};

/**
 * Resolves the disclosure from what the page read.
 *
 * `isSimulated` is the flag persisted on the records themselves — `LotMasterRecord`,
 * `DemandRun` — not a configuration value. `hasData` distinguishes "these records are
 * live" from "there are no records", which is why a null or absent flag with no data
 * resolves to `NOT_ESTABLISHED` rather than defaulting to either extreme.
 */
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

/** A page with nothing to attribute yet. */
export const UNESTABLISHED_SOURCE: SourceDisclosure = resolveSourceDisclosure({
  isSimulated: null,
  hasData: false,
});

/**
 * Combines the disclosures of several inputs feeding one page.
 *
 * If any contributing dataset is simulated the page is simulated: a screen that mixes a
 * simulated demand run with live inventory is not a live screen, and the stricter answer
 * is the honest one.
 */
export function mergeSourceDisclosures(parts: readonly SourceDisclosure[]): SourceDisclosure {
  if (parts.some((p) => p.mode === "FIXTURE_SIMULATION")) {
    return resolveSourceDisclosure({ isSimulated: true, hasData: true });
  }
  if (parts.some((p) => p.mode === "LIVE_FANTASY")) {
    return resolveSourceDisclosure({ isSimulated: false, hasData: true });
  }
  return UNESTABLISHED_SOURCE;
}
