/**
 * The three yield-rank highlights of a Sarin output (design v1.7 §15.13 and the client's
 * Blue, White and Pink output workbooks), shared by the on-screen preview and the XLSX
 * export so the two can never drift. The rank itself is always computed on the server
 * (sarin/yield-rank.ts); this module only names and colours it.
 *
 * Client-safe: no server imports.
 */

export type SarinYieldRank = 1 | 2 | 3;

export interface SarinYieldRankStyle {
  /** ARGB-free hex fill, exactly as the client's reference workbooks use it. */
  readonly fill: string;
  readonly short: string;
  /** Text for the rank, so colour is never the only indication. */
  readonly label: string;
}

export const SARIN_YIELD_RANK_STYLE: Readonly<Record<SarinYieldRank, SarinYieldRankStyle>> = {
  1: { fill: "C6EFCE", short: "1st", label: "1st — Highest Yield" },
  2: { fill: "FFF2B2", short: "2nd", label: "2nd — Second Highest" },
  3: { fill: "F4D0A4", short: "3rd", label: "3rd — Third Highest" },
};

export const SARIN_YIELD_RANKS: readonly SarinYieldRank[] = [1, 2, 3];
