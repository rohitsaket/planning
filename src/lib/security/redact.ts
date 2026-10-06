const SENSITIVE_KEY = /^(authorization|proxy-authorization|cookie|set-cookie|password|passwd|pwd|secret|secrets?_key|api[-_]?key|access[-_]?token|refresh[-_]?token|id[-_]?token|token|client[-_]?secret|private[-_]?key|tokenenc)$/i;
const BEARER = /bearer\s+[a-z0-9\-._~+/=]+/gi;
const KV = /\b(password|passwd|pwd|secret|token|access_token|refresh_token|api[_-]?key)\s*[=:]\s*[^\s&;,"']+/gi;
export const REDACTED = "<redacted>";

export function redactString(s: string): string {
  return s.replace(BEARER, `Bearer ${REDACTED}`).replace(KV, (_m, k: string) => `${k}=${REDACTED}`);
}

export function redact<T>(value: T, depth = 0): T {
  if (depth > 8) return value;
  if (typeof value === "string") return redactString(value) as T;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1)) as T;
  if (value && typeof value === "object") {
    if (value instanceof Date) return value;
    if (value instanceof Error) return { name: value.name, message: redactString(value.message) } as T;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = SENSITIVE_KEY.test(k) ? REDACTED : redact(v, depth + 1);
    return out as T;
  }
  return value;
}

export function safeErrorMessage(e: unknown, max = 300): string {
  const m = e instanceof Error ? e.message : String(e);
  return redactString(m).replace(/\s+/g, " ").slice(0, max);
}
