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

test('kalorie: kcalSum zachowuje zapis liczby bez zaokrąglenia, zero jest jawne, BMR nie jest rozdzielany', () => {
  const raw = '{"rollupDataPoints":[{"civilStartTime":{"date":{"year":2026,"month":3,"day":1}},"civilEndTime":{"date":{"year":2026,"month":3,"day":2}},"totalCalories":{"kcalSum":2234.123456789012}},{"civilStartTime":{"date":{"year":2026,"month":3,"day":2}},"civilEndTime":{"date":{"year":2026,"month":3,"day":3}},"totalCalories":{"kcalSum":0}},{"civilStartTime":{"date":{"year":2026,"month":3,"day":3}},"civilEndTime":{"date":{"year":2026,"month":3,"day":4}},"activeEnergyBurned":{"kcalSum":310.5}}]}';
  assert.deepEqual(parseDailyRollup(raw, 'total-calories').days, [{ date: '2026-03-01', value: '2234.123456789012', unit: 'kcal' }, { date: '2026-03-02', value: '0', unit: 'kcal' }]);
  assert.deepEqual(parseDailyRollup(raw, 'active-energy-burned').days, [{ date: '2026-03-03', value: '310.5', unit: 'kcal' }]);
  assert.throws(() => parseDailyRollup(raw.replace('2234.123456789012', '-5'), 'total-calories'));
  assert.deepEqual(parseDailyRollup(raw.replace('2234.123456789012', '1.5e3'), 'total-calories').days[0]?.value, '1500');
  assert.deepEqual(parseDailyRollup(raw.replace('2234.123456789012', '245.12345678901234'), 'total-calories').days[0]?.value, '245.12345678901234');
  assert.deepEqual(parseDailyRollup(raw.replace('2234.123456789012', '1.25E-5'), 'total-calories').days[0]?.value, '0.0000125');
  assert.deepEqual(parseDailyRollup(raw.replace('2234.123456789012', '2.50'), 'total-calories').days[0]?.value, '2.5');
});

test('rodzina źródeł jest jawna: domyślnie wszystkie źródła, można wskazać google-wearables, inne odrzucone', async () => {
  const families: unknown[] = [];
  const fake: typeof fetch = async (_url, init) => { families.push((JSON.parse(String(init!.body)) as Record<string, unknown>).dataSourceFamily); return Response.json({}); };
  await dailyRollupPage({ type: 'steps', start: '2026-03-01', end: '2026-03-02' }, 't', fake);
  await dailyRollupPage({ type: 'steps', start: '2026-03-01', end: '2026-03-02', family: 'google-wearables' }, 't', fake);
  await assert.rejects(dailyRollupPage({ type: 'steps', start: '2026-03-01', end: '2026-03-02', family: 'users/me/dataSourceFamilies/self-sources' as 'all-sources' }, 't', fake));
  assert.deepEqual(families, ['users/me/dataSourceFamilies/all-sources', 'users/me/dataSourceFamilies/google-wearables']);
});

test('kalorie total: limit 14 dni i pageSize 14, aktywne do 90 dni', async () => {
  const bodies: Record<string, unknown>[] = [];
  const fake: typeof fetch = async (_url, init) => { bodies.push(JSON.parse(String(init!.body)) as Record<string, unknown>); return Response.json({}); };
  await dailyRollupPage({ type: 'total-calories', start: '2026-03-01', end: '2026-03-15' }, 't', fake);
  await assert.rejects(dailyRollupPage({ type: 'total-calories', start: '2026-03-01', end: '2026-03-16' }, 't', fake), /invalid_range/);
  await dailyRollupPage({ type: 'active-energy-burned', start: '2026-03-01', end: '2026-05-30' }, 't', fake);
  assert.deepEqual(bodies.map((body) => body.pageSize), [14, 90]);
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
