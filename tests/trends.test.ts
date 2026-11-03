import assert from 'node:assert/strict';
import { test } from 'node:test';
import { lastMeasurement, segments, trendPoints, trendSummary, type TrendDay } from '../apps/web/src/trends.ts';

const value = (status: string, numerator: string, denominator = '1') => ({ status, value: { numerator, denominator } });
const none = (status: string) => ({ status, value: null });
function day(date: string, weight: ReturnType<typeof value> | ReturnType<typeof none>, steps: ReturnType<typeof value> | ReturnType<typeof none>, model?: string): TrendDay {
  const unsupported = none('unsupported');
  return { date, snapshot: { metrics: { weight, body_fat: unsupported, steps, distance: unsupported, total_energy: steps, active_energy: unsupported }, ...(model ? { energy: { model } } : {}) } };
}

const days: TrendDay[] = [
  day('2026-06-03', none('missing'), value('provisional', '500')),
  day('2026-06-01', value('valid', '1611', '20'), value('valid', '0'), 'legacy'),
  day('2026-06-02', none('missing'), none('incomparable')),
  { date: '2026-05-31', snapshot: null },
];

test('trendy: brak i nieporównywalne to luka, nie zero; zero producenta zostaje zerem; kolejność dat', () => {
  const steps = trendPoints(days, 'steps');
  assert.deepEqual(steps.map((point) => [point.date, point.value, point.provisional]), [['2026-05-31', null, false], ['2026-06-01', 0, false], ['2026-06-02', null, false], ['2026-06-03', 500, true]]);
  assert.deepEqual(trendPoints(days, 'total_energy').map((point) => point.legacy), [false, true, false, false]);
  assert.equal(trendPoints(days, 'steps')[1]!.legacy, false);
});

test('trendy: średnia tylko z dób potwierdzonych, z liczbą dób z wartością i luk', () => {
  assert.deepEqual(trendSummary(trendPoints(days, 'steps')), { mean: 0, valid: 1, total: 4, gaps: 2 });
  assert.deepEqual(trendSummary(trendPoints(days, 'body_fat')), { mean: null, valid: 0, total: 4, gaps: 4 });
});

test('trendy: ostatni znany pomiar z datą i odcinki linii nie łączą luk', () => {
  assert.deepEqual(lastMeasurement(trendPoints(days, 'weight')), { date: '2026-06-01', value: 80.55 });
  assert.equal(lastMeasurement(trendPoints(days, 'body_fat')), null);
  const points = [1, null, 2, 3, null, null, 4].map((item, index) => ({ date: `2026-06-0${index + 1}`, value: item, provisional: false, legacy: false }));
  assert.deepEqual(segments(points), [[0], [2, 3], [6]]);
});
