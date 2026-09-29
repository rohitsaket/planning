// Plan option validation warnings are stored as text: usually a JSON array of messages,
// sometimes a single message. This turns them into readable lines for display and never
// shows a raw serialized object: an entry without a message becomes a generic label.

const GENERIC = "Validation warning";

function toMessage(entry: unknown): string {
  if (typeof entry === "string") return entry.trim() || GENERIC;
  if (typeof entry === "number" || typeof entry === "boolean") return String(entry);
  if (entry && typeof entry === "object" && typeof (entry as { message?: unknown }).message === "string") {
    return (entry as { message: string }).message.trim() || GENERIC;
  }
  return GENERIC;
}

export function parseValidationWarnings(raw: string | null | undefined): string[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [raw];
  }
  return Array.isArray(parsed) ? parsed.map(toMessage) : [toMessage(parsed)];
}
