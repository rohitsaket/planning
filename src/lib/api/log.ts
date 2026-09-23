/**
 * Structured server logging.
 *
 * Lives on its own rather than inside `with-api.ts` so that a module which only needs to
 * log does not drag the API wrapper — and through it session resolution, the permission
 * model and the Prisma client — into whatever bundle imports it. `motivation.ts` is
 * imported by the sign-in screen for its constants; before this split that single import
 * pulled the entire server authentication stack into the client bundle.
 *
 * Callers pass a fixed event name and already-safe fields. Never pass a raw request
 * body, a credential, a session token or a source record.
 */
export function log(level: "info" | "warn" | "error", event: string, fields: Record<string, unknown>) {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, event, ...fields });
  if (level === "error") console.error(line);
  else console.log(line);
}
