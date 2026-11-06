import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { dailySummaryPage, groupByDay, dailySummarySpecs, dailySummaryTypes, parseDailySummary } from '../packages/adapters/google-health/daily-summary.ts';
import { catalogCheckedAt, dataTypeCapabilities, supportOf } from '../packages/adapters/google-health/capabilities.ts';
import { createGoogleReadJob, commitGooglePage } from '../packages/storage/google-pages.ts';

const date = (d: number) => ({ year: 2026, month: 3, day: d });

test('dobowe podsumowania: wartości zachowują zapis liczby, brak pola nie jest zerem, nieznane pola są ignorowane', () => {
  const raw = '{"dataPoints":[{"dailyHeartRateVariability":{"date":{"year":2026,"month":3,"day":2},"averageHeartRateVariabilityMilliseconds":41.123456789012,"nonRemHeartRateBeatsPerMinute":"52","futureField":1}},{"dailyHeartRateVariability":{"date":{"year":2026,"month":3,"day":3},"entropy":0}}],"nextPageToken":"n"}';
  assert.deepEqual(parseDailySummary(raw, 'daily-heart-rate-variability'), { days: [
    { date: '2026-03-02', values: { averageHeartRateVariabilityMilliseconds: '41.123456789012', nonRemHeartRateBeatsPerMinute: '52' } },
    { date: '2026-03-03', values: { entropy: '0' } },
  ], nextPageToken: 'n' });
  assert.deepEqual(parseDailySummary('{}', 'daily-resting-heart-rate'), { days: [], nextPageToken: null });
});

test('dobowe podsumowania: pola wymagane, puste punkty i złe typy są odrzucane', () => {
  const point = (member: string, body: object) => JSON.stringify({ dataPoints: [{ [member]: body }] });
  assert.throws(() => parseDailySummary(point('dailyRestingHeartRate', { date: date(1) }), 'daily-resting-heart-rate'), /missing_field/);
  assert.throws(() => parseDailySummary(point('dailyHeartRateVariability', { date: date(1) }), 'daily-heart-rate-variability'), /empty_point/);
  assert.throws(() => parseDailySummary(point('dailyRestingHeartRate', { date: date(1), beatsPerMinute: 55 }), 'daily-resting-heart-rate'));
  assert.throws(() => parseDailySummary(point('dailyRespiratoryRate', { date: date(1), breathsPerMinute: '14' }), 'daily-respiratory-rate'));
});

test('dobowe podsumowania: SpO₂, VO₂max i temperatura (ujemna, enum, boolean)', () => {
  const spo2 = JSON.stringify({ dataPoints: [{ dailyOxygenSaturation: { date: date(4), averagePercentage: 96.5, lowerBoundPercentage: 93, upperBoundPercentage: 99 } }] });
  assert.deepEqual(parseDailySummary(spo2, 'daily-oxygen-saturation').days[0]?.values, { averagePercentage: '96.5', lowerBoundPercentage: '93', upperBoundPercentage: '99' });
  const vo2 = JSON.stringify({ dataPoints: [{ dailyVo2Max: { date: date(4), vo2Max: 44.2, estimated: true, cardioFitnessLevel: 'GOOD' } }] });
  assert.deepEqual(parseDailySummary(vo2, 'daily-vo2-max').days[0]?.values, { vo2Max: '44.2', estimated: 'true', cardioFitnessLevel: 'GOOD' });
  const temp = JSON.stringify({ dataPoints: [{ dailySleepTemperatureDerivations: { date: date(4), nightlyTemperatureCelsius: 33.5, relativeNightlyStddev30dCelsius: -0.3 } }] });
  assert.deepEqual(parseDailySummary(temp, 'daily-sleep-temperature-derivations').days[0]?.values, { nightlyTemperatureCelsius: '33.5', relativeNightlyStddev30dCelsius: '-0.3' });
  assert.throws(() => parseDailySummary(vo2.replace('GOOD', 'good'), 'daily-vo2-max'));
});

test('dobowe podsumowania: żądanie reconcile ma filtr daty w snake_case, zakres półotwarty i stronicowanie', async () => {
  const urls: URL[] = [];
  const fake: typeof fetch = async (url) => { urls.push(new URL(String(url))); return Response.json({ nextPageToken: 'p2' }); };
  const page = await dailySummaryPage({ type: 'daily-resting-heart-rate', start: '2026-03-01', end: '2026-03-08', pageToken: 'p1' }, 't', fake);
  assert.equal(page.nextPageToken, 'p2');
  assert.equal(urls[0]?.pathname, '/v4/users/me/dataTypes/daily-resting-heart-rate/dataPoints:reconcile');
  assert.equal(urls[0]?.searchParams.get('dataSourceFamily'), 'users/me/dataSourceFamilies/all-sources');
  assert.equal(urls[0]?.searchParams.get('filter'), 'daily_resting_heart_rate.date >= "2026-03-01" AND daily_resting_heart_rate.date < "2026-03-08"');
  assert.equal(urls[0]?.searchParams.get('pageToken'), 'p1');
  await assert.rejects(dailySummaryPage({ type: 'daily-resting-heart-rate', start: '2026-03-01', end: '2026-03-01' }, 't', fake), /invalid_range/);
  await assert.rejects(dailySummaryPage({ type: 'daily-resting-heart-rate', start: '2026-01-01', end: '2026-06-01' }, 't', fake), /invalid_range/);
  await assert.rejects(dailySummaryPage({ type: 'steps' as 'daily-vo2-max', start: '2026-03-01', end: '2026-03-02' }, 't', fake));
});

test('dobowe podsumowania: zadanie zapisuje oryginał strony i odrzuca stronę niezgodną z typem bez przesuwania kursora', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE google_read_jobs (id TEXT PRIMARY KEY, account_digest TEXT, kind TEXT, range_start TEXT, range_end TEXT, cursor TEXT, state TEXT, created_at TEXT);
    CREATE TABLE google_read_pages (job_id TEXT, page_number INTEGER, request_cursor TEXT, next_cursor TEXT, raw_json TEXT, digest TEXT, fetched_at TEXT, PRIMARY KEY (job_id, page_number))`);
  const digest = 'a'.repeat(64);
  assert.throws(() => createGoogleReadJob(db, digest, 'daily-resting-heart-rate', '2026-03-01T00:00:00Z', '2026-03-02T00:00:00Z'), /invalid_range/);
  const id = createGoogleReadJob(db, digest, 'daily-resting-heart-rate', '2026-03-01', '2026-03-08');
  const bad = JSON.stringify({ dataPoints: [{ dailyRestingHeartRate: { date: date(1) } }] });
  assert.throws(() => commitGooglePage(db, id, null, bad), /missing_field/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM google_read_pages').get()?.n, 0);
  const good = JSON.stringify({ dataPoints: [{ dailyRestingHeartRate: { date: date(1), beatsPerMinute: '0' } }] });
  assert.deepEqual(commitGooglePage(db, id, null, good), { complete: true, pageNumber: 1 });
  assert.equal(db.prepare('SELECT raw_json FROM google_read_pages').get()?.raw_json, good);
});

test('rejestr możliwości: unikalne ID, dobowe typy tylko list/reconcile, status wynika z operacji i czytnika', () => {
  assert.match(catalogCheckedAt, /^\d{4}-\d{2}-\d{2}$/);
  const ids = dataTypeCapabilities.map((item) => item.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const item of dataTypeCapabilities.filter((entry) => entry.category === 'daily')) assert.deepEqual(item.operations, ['list', 'reconcile']);
  for (const type of dailySummaryTypes) {
    const item = dataTypeCapabilities.find((entry) => entry.id === type);
    assert.ok(item, type);
    assert.equal(supportOf(item), 'read-implemented');
  }
  assert.equal(Object.keys(dailySummarySpecs).length, 6);
  assert.equal(supportOf(dataTypeCapabilities.find((item) => item.id === 'moods')!), 'write-only');
  assert.equal(supportOf(dataTypeCapabilities.find((item) => item.id === 'sleep')!), 'readable-pending');
  assert.equal(dataTypeCapabilities.find((item) => item.id === 'skin-temperature-sensors')?.beta, true);
});

test('ta sama doba kilka razy: identyczne powtórzenia się łączą, różne punkty są konfliktem w stałej kolejności, nic nie jest wybierane', () => {
  const point = (bpm: string, extra: object = {}) => ({ date: '2026-03-01', values: { beatsPerMinute: bpm, ...extra } });
  assert.deepEqual([...groupByDay([point('55'), point('55')])], [['2026-03-01', { status: 'value', values: { beatsPerMinute: '55' } }]]);
  const a = groupByDay([point('56'), point('55')]), b = groupByDay([point('55'), point('56')]);
  assert.deepEqual(a, b);
  assert.deepEqual(a.get('2026-03-01'), { status: 'conflict', candidates: [{ beatsPerMinute: '55' }, { beatsPerMinute: '56' }] });
  // the same value with an extra optional field is a different point, not a refinement to merge
  assert.equal(groupByDay([point('55'), point('55', { entropy: '1' })]).get('2026-03-01')?.status, 'conflict');
  const raw = JSON.stringify({ dataPoints: [1, 2].map((n) => ({ dailyRestingHeartRate: { date: date(1), beatsPerMinute: String(50 + n) } })) });
  assert.equal(parseDailySummary(raw, 'daily-resting-heart-rate').days.length, 2); // a page with two points for one day is stored, not refused
});

test('NaN producenta (tekst) w polu opcjonalnym oznacza brak pola, w wymaganym błąd; inne teksty są odrzucane', () => {
  const temp = (body: object) => JSON.stringify({ dataPoints: [{ dailySleepTemperatureDerivations: { date: date(4), ...body } }] });
  assert.deepEqual(parseDailySummary(temp({ nightlyTemperatureCelsius: 33.5, baselineTemperatureCelsius: 'NaN', relativeNightlyStddev30dCelsius: 'NaN' }), 'daily-sleep-temperature-derivations').days[0]?.values, { nightlyTemperatureCelsius: '33.5' });
  assert.throws(() => parseDailySummary(temp({ nightlyTemperatureCelsius: 'NaN' }), 'daily-sleep-temperature-derivations'), /missing_field/);
  assert.throws(() => parseDailySummary(temp({ nightlyTemperatureCelsius: 33.5, baselineTemperatureCelsius: 'Infinity' }), 'daily-sleep-temperature-derivations'));
});
