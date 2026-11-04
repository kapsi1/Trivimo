import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseHeartRateWindows } from '../packages/adapters/google-health/window-rollup.ts';
import { forecastRestingEnergy, minRestWindows } from '../packages/domain/energy-forecast.ts';
import { warsawDay } from '../packages/domain/warsaw-day.ts';
import { createDemoDatabase } from '../packages/storage/days.ts';
import { readEnergyForecast } from '../packages/storage/google-energy-forecast.ts';
import { readHeartRateDay, readHeartRateRange } from '../packages/storage/google-heart-rate.ts';

const point = (start: string, extra: object) => ({ startTime: start, endTime: new Date(Date.parse(start) + 600000).toISOString(), ...extra });
function store() {
  const db = createDemoDatabase();
  db.exec(`CREATE TABLE google_read_jobs (id TEXT PRIMARY KEY, account_digest TEXT NOT NULL, kind TEXT NOT NULL, range_start TEXT NOT NULL, range_end TEXT NOT NULL, cursor TEXT, state TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE google_read_pages (job_id TEXT NOT NULL, page_number INTEGER NOT NULL, request_cursor TEXT, next_cursor TEXT, raw_json TEXT NOT NULL, digest TEXT NOT NULL, received_at TEXT NOT NULL);`);
  return db;
}
function save(db: ReturnType<typeof store>, id: string, kind: string, start: string, end: string, raw: string) {
  db.prepare("INSERT INTO google_read_jobs VALUES (?, ?, ?, ?, ?, NULL, 'complete', ?)").run(id, 'a'.repeat(64), kind, start, end, '2026-03-05T00:00:00.000Z');
  db.prepare("INSERT INTO google_read_pages VALUES (?, 1, NULL, NULL, ?, 'd', 'x')").run(id, raw);
}

test('tętno okien: średnia, min i maks.; okno bez tętna pomijane; brak min/maks. nie jest zgadywany', () => {
  const raw = JSON.stringify({ rollupDataPoints: [point('2026-03-01T10:10:00Z', { heartRate: { beatsPerMinuteAvg: 90.5, beatsPerMinuteMin: 80, beatsPerMinuteMax: 99 } }), point('2026-03-01T10:00:00Z', { heartRate: { beatsPerMinuteAvg: 70 } }), point('2026-03-01T10:20:00Z', {})] });
  assert.deepEqual(parseHeartRateWindows(raw), [
    { start: '2026-03-01T10:00:00.000Z', avg: 70, min: 70, max: 70 },
    { start: '2026-03-01T10:10:00.000Z', avg: 90.5, min: 80, max: 99 },
  ]);
  assert.throws(() => parseHeartRateWindows(JSON.stringify({ rollupDataPoints: [point('2026-03-01T10:05:00Z', { heartRate: { beatsPerMinuteAvg: 1 } })] })), /unexpected_window/);
});

test('tętno doby i zakresu: nieodczytana doba to brak odczytu, nie zero; doba z odczytem bez okien ma 0 okien; DST', () => {
  const db = store();
  try {
    const day = warsawDay('2026-03-29'); const t0 = Date.parse(day.start);
    const at = (minutes: number) => new Date(t0 + minutes * 60000).toISOString();
    save(db, 'h', 'heart-rate-10m', day.start, day.end, JSON.stringify({ rollupDataPoints: [point(at(0), { heartRate: { beatsPerMinuteAvg: 60, beatsPerMinuteMin: 55, beatsPerMinuteMax: 66 } }), point(at(600), { heartRate: { beatsPerMinuteAvg: 100, beatsPerMinuteMin: 90, beatsPerMinuteMax: 130 } })] }));
    const empty = warsawDay('2026-03-30');
    save(db, 'e', 'heart-rate-10m', empty.start, empty.end, JSON.stringify({}));
    const one = readHeartRateDay(db, '2026-03-29');
    assert.equal(one?.dayWindows, 138);
    assert.equal(one?.windows.length, 2);
    assert.equal(readHeartRateDay(db, '2026-03-31'), null);
    const [dst, read, unread] = readHeartRateRange(db, '2026-03-29', '2026-03-31');
    assert.deepEqual(dst, { date: '2026-03-29', read: true, windows: 2, avg: 80, min: 55, max: 130 });
    assert.deepEqual(read, { date: '2026-03-30', read: true, windows: 0, avg: null, min: null, max: null });
    assert.deepEqual(unread, { date: '2026-03-31', read: false, windows: 0, avg: null, min: null, max: null });
  } finally { db.close(); }
});

test('prognoza spalonych kalorii: stawka z okien bez kroków i aktywnych, brak wejścia to brak prognozy, DST', () => {
  const day = warsawDay('2026-10-25'); const start = Date.parse(day.start), end = Date.parse(day.end);
  assert.equal((end - start) / 3600000, 25);
  const w = (index: number, value: string | null) => ({ start: start + index * 600000, value });
  // 12 windows so far: 8 resting at 1.5 kcal, 4 active at 6 kcal
  const total = Array.from({ length: 12 }, (_, index) => w(index, index < 8 ? '1.5' : '6'));
  const steps = [w(8, '300'), w(9, '200'), w(10, '100'), w(11, '50'), w(0, '0')];
  const active = [w(8, '4'), w(9, '4'), w(10, '4'), w(11, '4')];
  const forecast = forecastRestingEnergy({ dayStart: start, dayEnd: end, total, steps, active });
  assert.ok(forecast);
  assert.equal(forecast.rule, 'prognoza-spoczynek-v0');
  assert.equal(forecast.restWindows, 8);
  assert.equal(forecast.burnedKcal, 36);
  assert.equal(forecast.restRateKcalPerHour, 9);
  assert.equal(forecast.remainingWindows, 150 - 12);
  assert.equal(forecast.forecastKcal, 36 + 1.5 * 138);
  assert.equal(forecast.asOf, new Date(start + 12 * 600000).toISOString());
  // unknown steps or active reads are not zero activity
  assert.equal(forecastRestingEnergy({ dayStart: start, dayEnd: end, total, steps: null, active }), null);
  assert.equal(forecastRestingEnergy({ dayStart: start, dayEnd: end, total, steps, active: null }), null);
  // too few resting windows give no rate
  assert.equal(forecastRestingEnergy({ dayStart: start, dayEnd: end, total: total.slice(minRestWindows - 1), steps, active }), null);
  assert.equal(forecastRestingEnergy({ dayStart: start, dayEnd: end, total: [], steps, active }), null);
});

test('prognoza tylko dla bieżącej doby warszawskiej, z zapisanych okien', () => {
  const db = store();
  try {
    const day = warsawDay('2026-06-10'); const t0 = Date.parse(day.start);
    const at = (index: number) => new Date(t0 + index * 600000).toISOString();
    const kcal = (index: number, value: number) => point(at(index), { totalCalories: { kcalSum: value } });
    save(db, 't', 'total-calories-10m', day.start, day.end, JSON.stringify({ rollupDataPoints: Array.from({ length: 10 }, (_, index) => kcal(index, 1.2)) }));
    save(db, 's', 'steps-10m', day.start, day.end, JSON.stringify({}));
    save(db, 'a', 'active-energy-10m', day.start, day.end, JSON.stringify({}));
    const noon = t0 + 12 * 3600000;
    const result = readEnergyForecast(db, '2026-06-10', noon);
    assert.ok(result);
    assert.equal(result.restWindows, 10);
    assert.equal(result.remainingWindows, 134);
    assert.equal(readEnergyForecast(db, '2026-06-10', noon + 86400000), null);
  } finally { db.close(); }
});
