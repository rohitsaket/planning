// Fixed-window in-memory limiter. Adequate for the single-process deployment this
// app uses; move to a shared store if the app is ever run as multiple instances.
const buckets = new Map<string, { count: number; resetAt: number }>();

export interface RateLimit {
  limit: number;
  windowMs: number;
}

export function consume(key: string, rule: RateLimit, now = Date.now()): { ok: boolean; retryAfterSeconds: number } {
  if (buckets.size > 10_000) {
    for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
  }
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + rule.windowMs });
    return { ok: true, retryAfterSeconds: 0 };
  }
  b.count += 1;
  if (b.count > rule.limit) return { ok: false, retryAfterSeconds: Math.ceil((b.resetAt - now) / 1000) };
  return { ok: true, retryAfterSeconds: 0 };
}

export function resetRateLimits() {
  buckets.clear();
}

export const LIMITS = {
  login: { limit: 10, windowMs: 5 * 60_000 }, // per username
  loginPerClient: { limit: 100, windowMs: 5 * 60_000 }, // per client IP (one shared bucket when the IP is unknown)
  mutation: { limit: 60, windowMs: 60_000 },
  upload: { limit: 10, windowMs: 60_000 },
  expensive: { limit: 30, windowMs: 60_000 },
  broadcast: { limit: 20, windowMs: 60_000 },
  batch: { limit: 3, windowMs: 60_000 },
} satisfies Record<string, RateLimit>;
