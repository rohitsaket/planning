import { businessDate, daysBetween } from "@/lib/analytics/reporting-date";
import { log } from "@/lib/api/log";

export interface Motivation {
  title: string;
  quote: string;
  author?: string;
  subtitle?: string;
}

export interface DailyMotivationPayload {
  quote: string;
  author: string;
  date: string;
  source: "zenquotes" | "fallback";
  attribution: { text: string; url: string } | null;
}

export const MOTIVATION_TITLE = "Daily Motivation";

export const ZENQUOTES_ATTRIBUTION = { text: "Inspirational quotes provided by ZenQuotes API", url: "https://zenquotes.io/" } as const;

const ZENQUOTES_URL = "https://zenquotes.io/api/today";
const FETCH_TIMEOUT_MS = 4000;
const NEGATIVE_CACHE_MS = 5 * 60_000;
const MAX_QUOTE_LEN = 400;
const MAX_AUTHOR_LEN = 120;

export const FALLBACK_MOTIVATIONS: { quote: string; subtitle?: string }[] = [
  { quote: "Small progress every day leads to big results.", subtitle: "A better you builds a stronger tomorrow." },
  { quote: "Excellence is built through consistent actions.", subtitle: "Make today count." },
  { quote: "Great teams turn everyday effort into extraordinary results.", subtitle: "Together we move forward." },
  { quote: "Focus on progress, not perfection.", subtitle: "Improve one step at a time." },
  { quote: "Success grows from discipline, teamwork and consistency.", subtitle: "Keep building." },
  { quote: "Measure twice, plan once, deliver with confidence.", subtitle: "Careful work carries further." },
  { quote: "Every accurate record makes the next decision easier.", subtitle: "Good data is a team effort." },
];

export function motivationIndexFor(date: string, length: number): number {
  if (length <= 0) return 0;
  const day = daysBetween("1970-01-01", date);
  return ((day % length) + length) % length;
}

export function localMotivationFor(date: string): { quote: string; subtitle?: string } {
  return FALLBACK_MOTIVATIONS[motivationIndexFor(date, FALLBACK_MOTIVATIONS.length)];
}

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

let dayCache: { date: string; payload: DailyMotivationPayload } | null = null;
let inFlight: Promise<DailyMotivationPayload> | null = null;
let retryAfter = 0;

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
    log("warn", "motivation.upstream_unreachable", { error: e instanceof Error ? e.message : String(e) });
    return null;
  }
}

export async function getDailyMotivation(now: Date, timezone: string): Promise<DailyMotivationPayload> {
  const date = businessDate(now, timezone);

  if (dayCache?.date === date) return dayCache.payload;
  dayCache = null;

  if ((process.env.MOTIVATION_SOURCE ?? "zenquotes") !== "zenquotes") return fallbackPayload(date);

  if (Date.now() < retryAfter) return fallbackPayload(date);

  if (!inFlight) {
    inFlight = (async () => {
      const fresh = await fetchZenQuotes(date);
      if (fresh) {
        dayCache = { date, payload: fresh };
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

export function toMotivationCard(p: DailyMotivationPayload): Motivation {
  return {
    title: MOTIVATION_TITLE,
    quote: p.quote,
    author: p.source === "zenquotes" ? p.author : undefined,
    subtitle: p.source === "fallback" ? localMotivationFor(p.date).subtitle : undefined,
  };
}

export const DEFAULT_MOTIVATION: Motivation = { title: MOTIVATION_TITLE, ...FALLBACK_MOTIVATIONS[0] };
