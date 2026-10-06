export const DEFAULT_ANALYTICS_TIMEZONE = "UTC";

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function analyticsTimeZone(): string {
  const tz = process.env.ANALYTICS_TIMEZONE?.trim();
  if (!tz) return DEFAULT_ANALYTICS_TIMEZONE;
  if (!isValidTimeZone(tz)) throw new Error(`ANALYTICS_TIMEZONE "${tz}" is not a valid IANA timezone`);
  return tz;
}

const partsCache = new Map<string, Intl.DateTimeFormat>();
function formatter(tz: string) {
  let f = partsCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    partsCache.set(tz, f);
  }
  return f;
}

function zonedParts(instant: Date, tz: string) {
  const p: Record<string, number> = {};
  for (const part of formatter(tz).formatToParts(instant)) if (part.type !== "literal") p[part.type] = Number(part.value);
  return p as { year: number; month: number; day: number; hour: number; minute: number; second: number };
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

export function businessDate(instant: Date, tz: string): string {
  const p = zonedParts(instant, tz);
  return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}`;
}

export function businessMonth(instant: Date, tz: string): string {
  return businessDate(instant, tz).slice(0, 7);
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

export function startOfBusinessDay(date: string, tz: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const utcGuess = Date.UTC(y, m - 1, d);
  let instant = utcGuess;
  for (let i = 0; i < 2; i++) {
    const p = zonedParts(new Date(instant), tz);
    const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    instant = utcGuess - (asUtc - instant);
  }
  return new Date(instant);
}

export interface BusinessWindow {
  timezone: string;
  startDate: string;
  endDate: string;
  start: Date;
  endExclusive: Date;
}

export function businessWindow(now: Date, days: number, tz: string): BusinessWindow {
  const endDate = businessDate(now, tz);
  const startDate = addDays(endDate, -(days - 1));
  return { timezone: tz, startDate, endDate, start: startOfBusinessDay(startDate, tz), endExclusive: startOfBusinessDay(addDays(endDate, 1), tz) };
}
