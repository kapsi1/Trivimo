import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dailyRollupPage } from '../packages/adapters/google-health/daily-rollup.ts';
import { GoogleHttpError, parseRetryAfter, RateLimitedError, withRateLimitRetry } from '../packages/adapters/google-health/rate-limit.ts';

const now = Date.parse('2026-03-10T12:00:00Z');

test('Retry-After: sekundy i data HTTP; brak lub nieczytelna wartość to nieznane, nie zero', () => {
  assert.equal(parseRetryAfter('7', now), 7000);
  assert.equal(parseRetryAfter('0', now), 0);
  assert.equal(parseRetryAfter('Tue, 10 Mar 2026 12:00:30 GMT', now), 30000);
  assert.equal(parseRetryAfter('Tue, 10 Mar 2026 11:00:00 GMT', now), 0);
  for (const value of [null, '', ' ', '-5', '1.5', 'soon', '2026-03-10']) assert.equal(parseRetryAfter(value, now), null);
});

test('adapter: 429 i 503 zachowują kod błędu i opóźnienie producenta, inne kody bez opóźnienia', async () => {
  const error = await dailyRollupPage({ type: 'steps', start: '2026-03-01', end: '2026-03-02' }, 't', async () => new Response('', { status: 429, headers: { 'Retry-After': '12' } })).catch((caught: unknown) => caught);
  assert.ok(error instanceof GoogleHttpError);
  assert.deepEqual([error.message, error.retryAfterMs], ['google_http_429', 12000]);
  const unavailable = await dailyRollupPage({ type: 'steps', start: '2026-03-01', end: '2026-03-02' }, 't', async () => new Response('', { status: 503, headers: { 'Retry-After': '12' } })).catch((caught: unknown) => caught);
  assert.ok(unavailable instanceof GoogleHttpError);
  assert.deepEqual([unavailable.message, unavailable.retryAfterMs], ['google_http_503', 12000]);
  const other = await dailyRollupPage({ type: 'steps', start: '2026-03-01', end: '2026-03-02' }, 't', async () => new Response('', { status: 500, headers: { 'Retry-After': '12' } })).catch((caught: unknown) => caught);
  assert.ok(other instanceof GoogleHttpError);
  assert.deepEqual([other.message, other.retryAfterMs], ['google_http_500', null]);
});

test('ponowienie: tylko 429 i 503, opóźnienie producenta, w przeciwnym razie rosnący odstęp z rozrzutem', async () => {
  const sleeps: number[] = []; const sleep = async (ms: number) => { sleeps.push(ms); };
  let calls = 0;
  const value = await withRateLimitRetry(async () => { if (++calls < 3) throw new GoogleHttpError('google_http_429', calls === 1 ? 5000 : null); return 'ok'; }, { now: () => now, sleep, random: () => 1 });
  assert.deepEqual([value, calls, sleeps], ['ok', 3, [5000, 4000]]);

  sleeps.length = 0; calls = 0;
  const identity = await withRateLimitRetry(async () => { if (++calls < 3) throw new GoogleHttpError(calls === 1 ? 'google_identity_http_503' : 'google_http_503', null); return 'ok'; }, { now: () => now, sleep, random: () => 0 });
  assert.deepEqual([identity, calls, sleeps], ['ok', 3, [1000, 2000]]);

  sleeps.length = 0; calls = 0;
  await assert.rejects(withRateLimitRetry(async () => { calls++; throw new GoogleHttpError('google_http_500', null); }, { now: () => now, sleep }), /google_http_500/);
  assert.deepEqual([calls, sleeps], [1, []]);
  await assert.rejects(withRateLimitRetry(async () => { throw new Error('google_identity_http_401'); }, { now: () => now, sleep }), /google_identity_http_401/);
});

test('ponowienie: po wyczerpaniu prób albo zbyt długim opóźnieniu zwraca czas, przed którym nie wolno pytać', async () => {
  const sleeps: number[] = []; const sleep = async (ms: number) => { sleeps.push(ms); };
  const exhausted = await withRateLimitRetry(async () => { throw new Error('google_identity_http_429'); }, { now: () => now, sleep, random: () => 0 }).catch((caught: unknown) => caught);
  assert.ok(exhausted instanceof RateLimitedError);
  assert.deepEqual([exhausted.message, exhausted.retryAt, sleeps], ['google_identity_http_429', now + 8000, [1000, 2000, 4000]]);

  sleeps.length = 0;
  const long = await withRateLimitRetry(async () => { throw new GoogleHttpError('google_http_429', 600000); }, { now: () => now, sleep }).catch((caught: unknown) => caught);
  assert.ok(long instanceof RateLimitedError);
  assert.deepEqual([long.retryAt, sleeps], [now + 600000, []]);
});
