export type SarinYieldRank = 1 | 2 | 3;

export interface SarinYieldRankStyle {
  readonly fill: string;
  readonly short: string;
  readonly label: string;
}

export const SARIN_YIELD_RANK_STYLE: Readonly<Record<SarinYieldRank, SarinYieldRankStyle>> = {
  1: { fill: "C6EFCE", short: "1st", label: "1st — Highest Yield" },
  2: { fill: "FFF2B2", short: "2nd", label: "2nd — Second Highest" },
  3: { fill: "F4D0A4", short: "3rd", label: "3rd — Third Highest" },
};

export const SARIN_YIELD_RANKS: readonly SarinYieldRank[] = [1, 2, 3];
