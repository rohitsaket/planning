/**
 * Time and Timezone utilities for Diamond Planning ERP.
 * 
 * Business timezone is Indian Standard Time (IST): Asia/Kolkata (UTC+05:30).
 * Rule: Technical timestamps are stored in UTC; business displays and calendar date
 * windows (e.g. 90-day demand intervals) are evaluated in IST.
 */

export const BUSINESS_TIMEZONE = "Asia/Kolkata";
export const IST_OFFSET_MINUTES = 330; // +05:30 = 330 minutes

/**
 * Returns the current date/time in UTC ISO format.
 */
export function nowUTC(): Date {
  return new Date();
}

/**
 * Converts a UTC Date or ISO string into an IST formatted string.
 * Example: "21 Sep 2026, 16:30:00 IST"
 */
export function formatIST(dateOrIso: Date | string | null | undefined, includeSeconds = true): string {
  if (!dateOrIso) return "—";
  try {
    const d = typeof dateOrIso === "string" ? new Date(dateOrIso) : dateOrIso;
    if (isNaN(d.getTime())) return "—";

    const options: Intl.DateTimeFormatOptions = {
      timeZone: BUSINESS_TIMEZONE,
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    };
    if (includeSeconds) options.second = "2-digit";

    return new Intl.DateTimeFormat("en-IN", options).format(d) + " IST";
  } catch {
    return String(dateOrIso);
  }
}

/**
 * Converts a UTC Date or ISO string into an IST calendar date string (YYYY-MM-DD).
 */
export function getISTDateString(dateOrIso: Date | string): string {
  const d = typeof dateOrIso === "string" ? new Date(dateOrIso) : dateOrIso;
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(d); // Returns YYYY-MM-DD
}

/**
 * Parses an IST date string (YYYY-MM-DD) and returns the start-of-day UTC Date.
 * E.g., "2026-09-21" in IST starts at 2026-09-20T18:30:00.000Z.
 */
export function parseISTDateToUTC(istDateStr: string, endOfDay = false): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(istDateStr.trim());
  if (!match) {
    throw new Error(`Invalid IST date format: "${istDateStr}". Expected YYYY-MM-DD.`);
  }

  const [, yStr, mStr, dStr] = match;
  const year = parseInt(yStr, 10);
  const month = parseInt(mStr, 10) - 1;
  const day = parseInt(dStr, 10);

  // UTC midnight for the given day, then subtract 5h30m (330 minutes)
  const baseUtc = Date.UTC(year, month, day, endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0, endOfDay ? 999 : 0);
  return new Date(baseUtc - IST_OFFSET_MINUTES * 60 * 1000);
}

/**
 * Validates whether an ISO string represents a valid UTC date.
 */
export function isValidISODate(isoStr: string | null | undefined): boolean {
  if (!isoStr || typeof isoStr !== "string") return false;
  const d = new Date(isoStr);
  return !isNaN(d.getTime()) && isoStr.includes("T");
}
