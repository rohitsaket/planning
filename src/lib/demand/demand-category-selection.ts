/**
 * DEMAND RESULT — CATEGORY SELECTION RULE
 *
 * Which category Demand Result Details shows is decided here, in one place, so the page
 * cannot drift into picking a category the user did not ask for.
 *
 * The requested key is the canonical key the backend returns (for example
 * "GIA|HEART|1.70-1.99"). It is compared with strict equality only: never trimmed, re-cased,
 * normalized or partially matched, and never replaced by a positional fallback such as the
 * first category or the first category with a shortage.
 */

export type CategorySelectionState = "NONE" | "SELECTED" | "UNAVAILABLE";

export type CategorySelection<T> =
  | { state: "NONE"; category: null }
  | { state: "SELECTED"; category: T }
  | { state: "UNAVAILABLE"; category: null };

const NEUTRAL = { state: "NONE", category: null } as const;
const UNAVAILABLE = { state: "UNAVAILABLE", category: null } as const;

export function resolveCategorySelection<T extends { category: string }>(
  categories: readonly T[],
  requestedKey: string | null,
  options: { malformed?: boolean; runLoaded?: boolean } = {},
): CategorySelection<T> {
  // A parameter that could not be read is reported rather than quietly ignored, so a broken
  // link never looks like a deliberate neutral entry.
  if (options.malformed) return UNAVAILABLE;

  // Generic entry: no category was asked for, so none is chosen.
  if (!requestedKey) return NEUTRAL;

  const match = categories.find((c) => c.category === requestedKey);
  if (match) return { state: "SELECTED", category: match };

  // Until the run has loaded, absence proves nothing; the neutral state is held rather than
  // briefly claiming the category is unavailable.
  return options.runLoaded ? UNAVAILABLE : NEUTRAL;
}
