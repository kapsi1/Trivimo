import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dailyRollupPage, parseDailyRollup } from '../packages/adapters/google-health/daily-rollup.ts';

const day = (d: number, extra: object) => ({ civilStartTime: { date: { year: 2026, month: 3, day: d }, time: {} }, civilEndTime: { date: { year: 2026, month: 3, day: d + 1 } }, ...extra });

test('dzienny agregat zachowuje jawne zero, pomija brak i nie zamienia go w 0', () => {
  const raw = JSON.stringify({ rollupDataPoints: [day(29, { steps: { countSum: '0' } }), day(28, {}), day(27, { steps: { countSum: '3822' }, extra: 1 })], nextPageToken: 'next' });
  assert.deepEqual(parseDailyRollup(raw, 'steps'), { days: [{ date: '2026-03-29', value: '0', unit: 'steps' }, { date: '2026-03-27', value: '3822', unit: 'steps' }], nextPageToken: 'next' });
  assert.deepEqual(parseDailyRollup(JSON.stringify({ rollupDataPoints: [day(1, { distance: { millimetersSum: '5000000' } })] }), 'distance').days, [{ date: '2026-03-01', value: '5000000', unit: 'mm' }]);
  assert.deepEqual(parseDailyRollup('{}', 'steps'), { days: [], nextPageToken: null });
});

test('dzienny agregat odrzuca okna inne niż pełna doba, duplikaty i nieliczbowe wartości', () => {
  const shifted = { ...day(1, { steps: { countSum: '1' } }), civilStartTime: { date: { year: 2026, month: 3, day: 1 }, time: { hours: 1 } } };
  assert.throws(() => parseDailyRollup(JSON.stringify({ rollupDataPoints: [shifted] }), 'steps'), /unexpected_window/);
  assert.throws(() => parseDailyRollup(JSON.stringify({ rollupDataPoints: [{ ...day(1, { steps: { countSum: '1' } }), civilEndTime: { date: { year: 2026, month: 3, day: 3 } } }] }), 'steps'), /unexpected_window/);
  assert.throws(() => parseDailyRollup(JSON.stringify({ rollupDataPoints: [day(1, { steps: { countSum: '1' } }), day(1, { steps: { countSum: '2' } })] }), 'steps'), /duplicate_day/);
  assert.throws(() => parseDailyRollup(JSON.stringify({ rollupDataPoints: [day(1, { steps: { countSum: '-1' } })] }), 'steps'));
});

test('żądanie dailyRollUp: POST, doby cywilne, wszystkie źródła, token tylko w nagłówku', async () => {
  let seen: { url: string; init: RequestInit } | undefined;
  const fake: typeof fetch = async (url, init) => { seen = { url: String(url), init: init! }; return Response.json({ rollupDataPoints: [day(1, { steps: { countSum: '7' } })] }); };
  const page = await dailyRollupPage({ type: 'steps', start: '2026-03-01', end: '2026-03-02', pageToken: 'p' }, 'synthetic-token', fake);
  assert.equal(page.days.length, 1);
  assert.equal(seen!.url, 'https://health.googleapis.com/v4/users/me/dataTypes/steps/dataPoints:dailyRollUp');
  assert.equal(seen!.init.method, 'POST');
  const body = JSON.parse(String(seen!.init.body)) as Record<string, unknown>;
  const midnight = { hours: 0, minutes: 0, seconds: 0, nanos: 0 };
  assert.deepEqual(body.range, { start: { date: { year: 2026, month: 3, day: 1 }, time: midnight }, end: { date: { year: 2026, month: 3, day: 2 }, time: midnight } });
  assert.equal(body.windowSizeDays, 1); assert.equal(body.dataSourceFamily, 'users/me/dataSourceFamilies/all-sources'); assert.equal(body.pageToken, 'p');
  assert.doesNotMatch(String(seen!.init.body), /synthetic-token/);
  await assert.rejects(dailyRollupPage({ type: 'steps', start: '2026-03-01', end: '2026-06-30' }, 't', fake), /invalid_range/);
  await assert.rejects(dailyRollupPage({ type: 'steps', start: '2026-03-02', end: '2026-03-01' }, 't', fake), /invalid_range/);
  await assert.rejects(dailyRollupPage({ type: 'steps', start: '2026-03-01', end: '2026-03-02' }, 't', async () => new Response('', { status: 429 })), /google_http_429/);
});
