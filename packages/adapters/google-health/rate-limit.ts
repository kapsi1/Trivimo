/** Non-2xx Google response. The message stays the stable code (`google_http_429`); the delay comes from `Retry-After`. */
export class GoogleHttpError extends Error {
  constructor(code: string, readonly retryAfterMs: number | null) { super(code); }
}

/** `Retry-After` as delay-seconds or an HTTP date; anything else (or absent) is unknown, never zero. */
export function parseRetryAfter(header: string | null, nowMs: number): number | null {
  const value = header?.trim();
  if (!value) return null;
  if (/^\d{1,9}$/.test(value)) return Number(value) * 1000;
  const date = Date.parse(value);
  return Number.isNaN(date) || !/[a-z]/i.test(value) ? null : Math.max(0, date - nowMs);
}

export function googleHttpError(prefix: 'google_http' | 'google_identity_http', response: Response, nowMs = Date.now()): GoogleHttpError {
  return new GoogleHttpError(`${prefix}_${response.status}`, response.status === 429 ? parseRetryAfter(response.headers.get('retry-after'), nowMs) : null);
}

/** The run gave up after repeated 429; no request should be sent before `retryAt`. */
export class RateLimitedError extends Error {
  constructor(code: string, readonly retryAt: number) { super(code); }
}

export interface RetryPolicy { attempts: number; baseMs: number; maxWaitMs: number }
/** Four tries, 2 s doubling with jitter; a producer delay above two minutes stops the run instead of holding it. */
export const defaultRetryPolicy: RetryPolicy = { attempts: 4, baseMs: 2000, maxWaitMs: 120000 };
const rateLimited = (error: unknown): error is Error => error instanceof Error && /^google_(identity_)?http_429$/.test(error.message);

/**
 * Repeats one read request after 429 only: the producer's `Retry-After` when given, otherwise exponential backoff with
 * jitter. Safe because a page is committed only after a successful response, so a repeat sends the same saved cursor.
 */
export async function withRateLimitRetry<T>(call: () => Promise<T>, options: { policy?: RetryPolicy; now: () => number; sleep: (ms: number) => Promise<void>; random?: () => number }): Promise<T> {
  const policy = options.policy ?? defaultRetryPolicy; const random = options.random ?? Math.random;
  for (let attempt = 1; ; attempt++) {
    try { return await call(); } catch (error) {
      if (!rateLimited(error)) throw error;
      const given = error instanceof GoogleHttpError ? error.retryAfterMs : null;
      const wait = given ?? Math.round(policy.baseMs * 2 ** (attempt - 1) * (0.5 + random() / 2));
      if (attempt >= policy.attempts || wait > policy.maxWaitMs) throw new RateLimitedError(error.message, options.now() + Math.max(wait, policy.baseMs));
      await options.sleep(wait);
    }
  }
}
