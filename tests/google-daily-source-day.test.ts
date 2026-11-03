import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDemoDatabase } from '../packages/storage/days.ts';
import { readGoogleDailySourceDay } from '../packages/storage/google-daily-source-day.ts';

function store() {
  const db = createDemoDatabase();
  db.exec(`CREATE TABLE google_read_jobs (id TEXT PRIMARY KEY, account_digest TEXT NOT NULL, kind TEXT NOT NULL, range_start TEXT NOT NULL, range_end TEXT NOT NULL, cursor TEXT, state TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE google_read_pages (job_id TEXT NOT NULL, page_number INTEGER NOT NULL, request_cursor TEXT, next_cursor TEXT, raw_json TEXT NOT NULL, digest TEXT NOT NULL, received_at TEXT NOT NULL);`);
  return db;
}
const point = (day: number, extra: object) => ({ civilStartTime: { date: { year: 2026, month: 3, day } }, civilEndTime: { date: { year: 2026, month: 3, day: day + 1 } }, ...extra });
function job(db: ReturnType<typeof store>, id: string, kind: string, start: string, end: string, account: string, points: object[]) {
  db.prepare("INSERT INTO google_read_jobs VALUES (?, ?, ?, ?, ?, NULL, 'complete', ?)").run(id, account.repeat(64), kind, start, end, '2026-03-05T00:00:00.000Z');
  db.prepare("INSERT INTO google_read_pages VALUES (?, 1, NULL, NULL, ?, 'd', '2026-03-05T00:00:00.000Z')").run(id, JSON.stringify({ rollupDataPoints: points }));
}

test('agregaty dzienne: dokładne przeliczenie, jawne zero, brak nie jest zerem, osobno steps i distance', () => {
  const db = store();
  try {
    job(db, 'a', 'steps', '2026-03-01', '2026-03-04', 'a', [point(1, { steps: { countSum: '0' } }), point(2, { steps: { countSum: '3822' } })]);
    job(db, 'b', 'distance', '2026-03-01', '2026-03-03', 'a', [point(1, { distance: { millimetersSum: '5000123' } }), point(2, { distance: { millimetersSum: '999' } })]);
    const zero = readGoogleDailySourceDay(db, 'steps', '2026-03-01');
    assert.deepEqual(zero.rows.map((row) => [row.originalValue, row.converted]), [['0', { value: '0', unit: 'szt.' }]]);
    assert.deepEqual(readGoogleDailySourceDay(db, 'steps', '2026-03-02').rows.map((row) => row.converted?.value), ['3822']);
    assert.deepEqual(readGoogleDailySourceDay(db, 'distance', '2026-03-01').rows.map((row) => row.converted), [{ value: '5.000123', unit: 'km' }]);
    assert.deepEqual(readGoogleDailySourceDay(db, 'distance', '2026-03-02').rows.map((row) => row.converted), [{ value: '0.000999', unit: 'km' }]);
    const missing = readGoogleDailySourceDay(db, 'steps', '2026-03-03');
    assert.equal(missing.rows.length, 0); assert.equal(missing.jobs.length, 1); assert.equal(missing.coverage, 'unknown');
    assert.equal(readGoogleDailySourceDay(db, 'steps', '2026-03-04').jobs.length, 0);
    assert.equal(readGoogleDailySourceDay(db, 'distance', '2026-03-03').jobs.length, 0);
  } finally { db.close(); }
});

test('agregaty dzienne: kalorie są pokazane jako kcal bez kwalifikacji, total i active osobno', () => {
  const db = store();
  try {
    const kcal = (key: string, value: string) => ({ civilStartTime: { date: { year: 2026, month: 3, day: 1 } }, civilEndTime: { date: { year: 2026, month: 3, day: 2 } }, [key]: { kcalSum: 1 } });
    db.prepare("INSERT INTO google_read_jobs VALUES ('t', ?, 'total-calories', '2026-03-01', '2026-03-02', NULL, 'complete', 'x')").run('a'.repeat(64));
    db.prepare("INSERT INTO google_read_pages VALUES ('t', 1, NULL, NULL, ?, 'd', 'x')").run(JSON.stringify({ rollupDataPoints: [kcal('totalCalories', '1')] }).replace('"kcalSum":1', '"kcalSum":2234.5'));
    const total = readGoogleDailySourceDay(db, 'total-calories', '2026-03-01');
    assert.deepEqual(total.rows.map((row) => [row.originalValue, row.unit, row.converted]), [['2234.5', 'kcal', { value: '2234.5', unit: 'kcal' }]]);
    assert.equal(readGoogleDailySourceDay(db, 'active-energy-burned', '2026-03-01').jobs.length, 0);
  } finally { db.close(); }
});

test('agregaty dzienne: powtórzone odczyty nie są sumowane, a różne konta są oznaczone', () => {
  const db = store();
  try {
    job(db, 'a', 'steps', '2026-03-01', '2026-03-02', 'a', [point(1, { steps: { countSum: '10' } })]);
    job(db, 'b', 'steps', '2026-03-01', '2026-03-02', 'b', [point(1, { steps: { countSum: '12' } })]);
    const review = readGoogleDailySourceDay(db, 'steps', '2026-03-01');
    assert.equal(review.rows.length, 2); assert.equal(review.multipleAccounts, true);
    assert.deepEqual(review.rows.map((row) => row.originalValue).sort(), ['10', '12']);
  } finally { db.close(); }
});
