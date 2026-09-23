// Daily employee motivation shown on the sign-in screen.
//
// Source: ZenQuotes (https://zenquotes.io/api/today), fetched SERVER-SIDE ONLY
// and cached for the business day. The browser never contacts ZenQuotes — it
// would leak employee IPs to a third party, need a CSP exception, and break the
// "same quote for everyone" guarantee.
//
// The quote is keyed to the business calendar date in the reporting timezone, so
// it is identical for every employee all day and rolls over once at the
// organisation's midnight. If ZenQuotes is unavailable the deterministic local
// list below is used instead; sign-in is never blocked or delayed by it.
//
// EXTENSION POINT: when administrators can schedule their own messages,
// `resolveDailyMotivation` is the only function that changes — look up the row
// for `date` first, then fall through to the provider chain already here.

import { businessDate, daysBetween } from "@/lib/analytics/reporting-date";
import { log } from "@/lib/api/log";

export interface Motivation {
  title: string;
  quote: string;
  author?: string;
  subtitle?: string;
}

/** The API contract for GET /api/public/daily-motivation. */
export interface DailyMotivationPayload {
  quote: string;
  author: string;
  date: string;
  source: "zenquotes" | "fallback";
  attribution: { text: string; url: string } | null;
}

export const MOTIVATION_TITLE = "Daily Motivation";

// ZenQuotes' free tier requires visible attribution crediting the API.
export const ZENQUOTES_ATTRIBUTION = { text: "Inspirational quotes provided by ZenQuotes API", url: "https://zenquotes.io/" } as const;

const ZENQUOTES_URL = "https://zenquotes.io/api/today";
const FETCH_TIMEOUT_MS = 4000;
// While the upstream is failing, stop retrying on every request. Short enough
// that the real quote appears soon after ZenQuotes recovers.
const NEGATIVE_CACHE_MS = 5 * 60_000;
const MAX_QUOTE_LEN = 400;
const MAX_AUTHOR_LEN = 120;

/** Used when ZenQuotes is unavailable. Order is significant: it fixes the rotation. */
export const FALLBACK_MOTIVATIONS: { quote: string; subtitle?: string }[] = [
  { quote: "Small progress every day leads to big results.", subtitle: "A better you builds a stronger tomorrow." },
  { quote: "Excellence is built through consistent actions.", subtitle: "Make today count." },
  { quote: "Great teams turn everyday effort into extraordinary results.", subtitle: "Together we move forward." },
  { quote: "Focus on progress, not perfection.", subtitle: "Improve one step at a time." },
  { quote: "Success grows from discipline, teamwork and consistency.", subtitle: "Keep building." },
  { quote: "Measure twice, plan once, deliver with confidence.", subtitle: "Careful work carries further." },
  { quote: "Every accurate record makes the next decision easier.", subtitle: "Good data is a team effort." },
];

/**
 * Index for a business date. Days since the epoch modulo the list length gives a
 * stable value for the whole day and a different one tomorrow.
 */
export function motivationIndexFor(date: string, length: number): number {
  if (length <= 0) return 0;
  const day = daysBetween("1970-01-01", date);
  return ((day % length) + length) % length; // non-negative for pre-epoch dates
}

export function localMotivationFor(date: string): { quote: string; subtitle?: string } {
  return FALLBACK_MOTIVATIONS[motivationIndexFor(date, FALLBACK_MOTIVATIONS.length)];
}

/**
 * ZenQuotes returns `[{ q, a, h }]`. This is untrusted third-party input: accept
 * it only if it is the exact shape expected, then strip control characters and
 * bound the length. React escapes on render, so the remaining risk is layout
 * damage and log injection, not script execution.
 */
export function parseZenQuotes(raw: unknown): { quote: string; author: string } | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const first = raw[0] as Record<string, unknown> | undefined;
  if (!first || typeof first !== "object") return null;
  if (typeof first.q !== "string") return null;

  const clean = (v: string, max: number) =>
    v
      .replace(/[\u0000-\u001f\u007f]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, max);

  const quote = clean(first.q, MAX_QUOTE_LEN);
  if (!quote) return null;
  const author = (typeof first.a === "string" ? clean(first.a, MAX_AUTHOR_LEN) : "") || "Unknown";
  return { quote, author };
}

// Cached for the business day. Single-process deployment (same assumption the
// rate limiter documents); a multi-instance rollout should move this to Redis so
// every instance serves one quote.
let dayCache: { date: string; payload: DailyMotivationPayload } | null = null;
let inFlight: Promise<DailyMotivationPayload> | null = null;
let retryAfter = 0;

/** Test seam — resets cache state. */
export function resetMotivationCache() {
  dayCache = null;
  inFlight = null;
  retryAfter = 0;
}

function fallbackPayload(date: string): DailyMotivationPayload {
  return { quote: localMotivationFor(date).quote, author: "Unknown", date, source: "fallback", attribution: null };
}

async function fetchZenQuotes(date: string): Promise<DailyMotivationPayload | null> {
  try {
    const res = await fetch(ZENQUOTES_URL, {
      // Our own cache is the caching layer; don't let fetch serve a stale day.
      cache: "no-store",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      log("warn", "motivation.upstream_status", { status: res.status });
      return null;
    }
    const parsed = parseZenQuotes(await res.json());
    if (!parsed) {
      log("warn", "motivation.upstream_shape", { note: "unexpected ZenQuotes payload" });
      return null;
    }
    return { ...parsed, date, source: "zenquotes", attribution: { ...ZENQUOTES_ATTRIBUTION } };
  } catch (e) {
    // Timeout, DNS, TLS, offline — all non-fatal.
    log("warn", "motivation.upstream_unreachable", { error: e instanceof Error ? e.message : String(e) });
    return null;
  }
}

/**
 * The day's motivation. Returns the cached value when present, otherwise fetches
 * once (concurrent callers share the in-flight promise) and falls back locally.
 * Never throws — the sign-in screen must not depend on this succeeding.
 */
export async function getDailyMotivation(now: Date, timezone: string): Promise<DailyMotivationPayload> {
  const date = businessDate(now, timezone);

  if (dayCache?.date === date) return dayCache.payload;
  dayCache = null; // day rolled over

  // Providers can be disabled for offline/air-gapped installs or tests.
  if ((process.env.MOTIVATION_SOURCE ?? "zenquotes") !== "zenquotes") return fallbackPayload(date);

  // Upstream recently failed: serve the local quote without hammering it.
  if (Date.now() < retryAfter) return fallbackPayload(date);

  if (!inFlight) {
    inFlight = (async () => {
      const fresh = await fetchZenQuotes(date);
      if (fresh) {
        dayCache = { date, payload: fresh }; // pinned for the rest of the business day
        retryAfter = 0;
        return fresh;
      }
      retryAfter = Date.now() + NEGATIVE_CACHE_MS;
      return fallbackPayload(date);
    })().finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}

/** Shapes the API payload for the sign-in card. */
export function toMotivationCard(p: DailyMotivationPayload): Motivation {
  return {
    title: MOTIVATION_TITLE,
    quote: p.quote,
    author: p.source === "zenquotes" ? p.author : undefined,
    subtitle: p.source === "fallback" ? localMotivationFor(p.date).subtitle : undefined,
  };
}

/** Rendered immediately by the client so the panel never shifts while the API loads. */
export const DEFAULT_MOTIVATION: Motivation = { title: MOTIVATION_TITLE, ...FALLBACK_MOTIVATIONS[0] };
