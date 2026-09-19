// Shared number formatting. Every compact currency figure in the app goes through here.

/** $7,832,258.67 → "$7.83M"; $952,880 → "$952.88K"; $950 → "$950". */
export function formatCompactCurrency(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const sign = value < 0 ? "-" : "";
  const a = Math.abs(value);
  if (a >= 1_000_000_000) return `${sign}$${(a / 1_000_000_000).toFixed(2)}B`;
  if (a >= 1_000_000) return `${sign}$${(a / 1_000_000).toFixed(2)}M`;
  if (a >= 1_000) return `${sign}$${(a / 1_000).toFixed(2)}K`;
  return `${sign}$${a.toFixed(0)}`;
}

/** Percentage rounded for display and export: 12.166435 → 12.2. */
export function roundPercent(value: number, decimals = 1): number {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}

export function formatPercent(value: number, decimals = 1): string {
  return `${roundPercent(value, decimals).toFixed(decimals)}%`;
}
