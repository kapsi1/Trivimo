import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseWindowRollup, windowRollupPage } from '../packages/adapters/google-health/window-rollup.ts';
import { createDemoDatabase } from '../packages/storage/days.ts';
import { readBandShareDay } from '../packages/storage/google-band-share-day.ts';
import { warsawDay } from '../packages/domain/warsaw-day.ts';

const point = (start: string, extra: object) => ({ startTime: start, endTime: new Date(Date.parse(start) + 600000).toISOString(), ...extra });

test('okna 10-minutowe: tętno to dowód obecności, kcal zachowują zapis, złe okna są odrzucane', () => {
  const heart = JSON.stringify({ rollupDataPoints: [point('2026-03-01T10:10:00Z', { heartRate: { beatsPerMinuteAvg: 90.5, beatsPerMinuteMin: 80, beatsPerMinuteMax: 99 } }), point('2026-03-01T10:00:00Z', {})] });
  assert.deepEqual(parseWindowRollup(heart, 'heart-rate').windows, [{ start: '2026-03-01T10:10:00.000Z', end: '2026-03-01T10:20:00.000Z', value: null }]);
  const active = '{"rollupDataPoints":[{"startTime":"2026-03-01T10:00:00Z","endTime":"2026-03-01T10:10:00Z","activeEnergyBurned":{"kcalSum":0}},{"startTime":"2026-03-01T10:10:00Z","endTime":"2026-03-01T10:20:00Z","activeEnergyBurned":{"kcalSum":12.3456789012345678}}]}';
  assert.deepEqual(parseWindowRollup(active, 'active-energy-burned').windows.map((window) => window.value), ['0', '12.3456789012345678']);
  assert.throws(() => parseWindowRollup(JSON.stringify({ rollupDataPoints: [{ ...point('2026-03-01T10:10:00Z', { heartRate: { beatsPerMinuteAvg: 1 } }), endTime: '2026-03-01T10:30:00Z' }] }), 'heart-rate'), /unexpected_window/);
  assert.throws(() => parseWindowRollup(JSON.stringify({ rollupDataPoints: [point('2026-03-01T10:05:00Z', { heartRate: { beatsPerMinuteAvg: 1 } })] }), 'heart-rate'), /unexpected_window/);
  assert.throws(() => parseWindowRollup(JSON.stringify({ rollupDataPoints: [point('2026-03-01T10:00:00Z', { heartRate: { beatsPerMinuteAvg: 1 } }), point('2026-03-01T10:00:00Z', { heartRate: { beatsPerMinuteAvg: 2 } })] }), 'heart-rate'), /duplicate_window/);
});

test('żądanie rollUp: okno 600 s, zakres UTC, wszystkie źródła, limit 14 dni', async () => {
  let body: Record<string, unknown> | undefined; let url = '';
  const fake: typeof fetch = async (address, init) => { url = String(address); body = JSON.parse(String(init!.body)) as Record<string, unknown>; return Response.json({}); };
  await windowRollupPage({ type: 'heart-rate', start: '2026-03-01T00:00:00Z', end: '2026-03-02T00:00:00Z' }, 't', fake);
  assert.equal(url, 'https://health.googleapis.com/v4/users/me/dataTypes/heart-rate/dataPoints:rollUp');
  assert.deepEqual(body, { range: { startTime: '2026-03-01T00:00:00.000Z', endTime: '2026-03-02T00:00:00.000Z' }, windowSize: '600s', pageSize: 10000, dataSourceFamily: 'users/me/dataSourceFamilies/all-sources' });
  await assert.rejects(windowRollupPage({ type: 'heart-rate', start: '2026-03-01T00:00:00Z', end: '2026-03-16T00:00:00Z' }, 't', fake), /invalid_range/);
  await assert.rejects(windowRollupPage({ type: 'heart-rate', start: '2026-03-01T00:03:00Z', end: '2026-03-02T00:00:00Z' }, 't', fake), /invalid_range/);
});

function store() {
  const db = createDemoDatabase();
  db.exec(`CREATE TABLE google_read_jobs (id TEXT PRIMARY KEY, account_digest TEXT NOT NULL, kind TEXT NOT NULL, range_start TEXT NOT NULL, range_end TEXT NOT NULL, cursor TEXT, state TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE google_read_pages (job_id TEXT NOT NULL, page_number INTEGER NOT NULL, request_cursor TEXT, next_cursor TEXT, raw_json TEXT NOT NULL, digest TEXT NOT NULL, received_at TEXT NOT NULL);`);
  return db;
}
function save(db: ReturnType<typeof store>, id: string, kind: string, start: string, end: string, raw: string, state = 'complete') {
  db.prepare('INSERT INTO google_read_jobs VALUES (?, ?, ?, ?, ?, NULL, ?, ?)').run(id, 'a'.repeat(64), kind, start, end, state, '2026-03-05T00:00:00.000Z');
  db.prepare("INSERT INTO google_read_pages VALUES (?, 1, NULL, NULL, ?, 'd', 'x')").run(id, raw);
}

test('udział opaski: okna tętna dzielą aktywne kcal, brakujący odczyt nie jest zerem, DST zmienia liczbę okien', () => {
  const db = store();
  try {
    const day = warsawDay('2026-03-02'); const t0 = Date.parse(day.start);
    const at = (minutes: number) => new Date(t0 + minutes * 60000).toISOString();
    save(db, 'h', 'heart-rate-10m', day.start, day.end, JSON.stringify({ rollupDataPoints: [point(at(0), { heartRate: { beatsPerMinuteAvg: 70 } }), point(at(10), { heartRate: { beatsPerMinuteAvg: 71 } }), point(at(600), { heartRate: { beatsPerMinuteAvg: 90 } })] }));
    // before the activity job exists the split is unavailable, not zero
    const early = readBandShareDay(db, '2026-03-02');
    assert.equal(early.totalWindows, 144); assert.deepEqual(early.heartRate, { windows: 3 }); assert.equal(early.activeEnergy, null); assert.equal(early.activeEnergyRead, false);
    const kcal = (minutes: number, value: number) => ({ ...point(at(minutes), {}), activeEnergyBurned: { kcalSum: value } });
    save(db, 'a', 'active-energy-10m', day.start, day.end, JSON.stringify({ rollupDataPoints: [kcal(0, 0), kcal(10, 2.5), kcal(20, 1.25), kcal(600, 40)] }));
    const split = readBandShareDay(db, '2026-03-02');
    assert.deepEqual(split.activeEnergy, { bandKcal: '42.50', bandWindows: 3, otherKcal: '1.25', otherWindows: 1 });
    // a running job or a job not covering the whole Warsaw day is not used
    db.prepare("UPDATE google_read_jobs SET state = 'running' WHERE id = 'h'").run();
    assert.equal(readBandShareDay(db, '2026-03-02').heartRate, null);
    db.prepare("UPDATE google_read_jobs SET state = 'complete', range_end = ? WHERE id = 'h'").run(at(600));
    assert.equal(readBandShareDay(db, '2026-03-02').heartRate, null);
    assert.equal(readBandShareDay(db, '2026-03-29').totalWindows, 138);
    assert.equal(readBandShareDay(db, '2026-10-25').totalWindows, 150);
  } finally { db.close(); }
});
