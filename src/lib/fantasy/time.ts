export const BUSINESS_TIMEZONE = "Asia/Kolkata";
export const IST_OFFSET_MINUTES = 330;

export function nowUTC(): Date {
  return new Date();
}

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

export function getISTDateString(dateOrIso: Date | string): string {
  const d = typeof dateOrIso === "string" ? new Date(dateOrIso) : dateOrIso;
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(d);
}

export function parseISTDateToUTC(istDateStr: string, endOfDay = false): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(istDateStr.trim());
  if (!match) {
    throw new Error(`Invalid IST date format: "${istDateStr}". Expected YYYY-MM-DD.`);
  }

  const [, yStr, mStr, dStr] = match;
  const year = parseInt(yStr, 10);
  const month = parseInt(mStr, 10) - 1;
  const day = parseInt(dStr, 10);

  const baseUtc = Date.UTC(year, month, day, endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0, endOfDay ? 999 : 0);
  return new Date(baseUtc - IST_OFFSET_MINUTES * 60 * 1000);
}

export function isValidISODate(isoStr: string | null | undefined): boolean {
  if (!isoStr || typeof isoStr !== "string") return false;
  const d = new Date(isoStr);
  return !isNaN(d.getTime()) && isoStr.includes("T");
}
