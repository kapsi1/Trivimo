import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { createApp } from '../apps/server/app.ts';
import { DayZoneService } from '../apps/server/day-zone-service.ts';
import { coveredDays, planSync } from '../apps/server/google-sync.ts';
import { initializeTakeoutStore } from '../packages/adapters/takeout/import.ts';
import { dayBounds } from '../packages/domain/day-zone.ts';
import {
  currentStoreVersion, migrateCalorieJobs, migrateCanonicalDays, migrateCsvImports, migrateCsvNotes, migrateDailyRollups, migrateDailySummaries, migrateDayZone, migrateGooglePages,
  migratePageWindows, migrateReadPolicy, migrateSourceAccounts, migrateSourceLists, migrateUserNotes, migrateWindowJobs,
} from '../packages/storage/canonical-days.ts';
import { dayZoneState, readDayZone, saveDayZone } from '../packages/storage/day-zone.ts';
import { readDaySeries } from '../packages/storage/google-day-series.ts';
import { projectGoogleDays, publishGoogleDays } from '../packages/storage/google-day-snapshots.ts';
import { commitGooglePage, createGoogleReadJob, type GoogleJobKind } from '../packages/storage/google-pages.ts';
import { verifyTakeout } from '../packages/storage/verify-takeout.ts';

const digest = createHash('sha256').update('synthetic-account').digest('hex');
const civil = (date: string) => { const [year, month, day] = date.split('-').map(Number); return { date: { year, month, day } }; };
const next = (date: string) => new Date(Date.parse(`${date}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
function read(db: DatabaseSync, kind: GoogleJobKind, start: string, end: string, points: unknown[]) {
  const id = createGoogleReadJob(db, digest, kind, start, end);
  commitGooglePage(db, id, null, JSON.stringify({ rollupDataPoints: points }));
}
/** Ten-minute step windows of one day of the zone; the first window holds all `total` steps. */
function stepWindows(date: string, zone: string, total: number) {
  const bounds = dayBounds(date, zone), start = Date.parse(bounds.start), count = (Date.parse(bounds.end) - start) / 600000;
  return Array.from({ length: count }, (_, index) => index === 0 ? { startTime: new Date(start).toISOString(), endTime: new Date(start + 600000).toISOString(), steps: { countSum: String(total) } } : null).filter(Boolean);
}
const dailySteps = (date: string, total: number) => ({ civilStartTime: civil(date), civilEndTime: civil(next(date)), steps: { countSum: String(total) } });

async function store() {
  const dir = mkdtempSync(join(tmpdir(), 'trivimo-zone-')); const path = join(dir, 'db.sqlite'); const db = new DatabaseSync(path);
  initializeTakeoutStore(db);
  await migrateCanonicalDays(db, join(dir, 'v1.sqlite')); await migrateUserNotes(db, join(dir, 'v2.sqlite'));
  await migrateSourceAccounts(db, join(dir, 'v3.sqlite'), true); await migrateGooglePages(db, join(dir, 'v4.sqlite'));
  await migrateDailyRollups(db, join(dir, 'v5.sqlite')); await migrateCalorieJobs(db, join(dir, 'v6.sqlite')); await migrateWindowJobs(db, join(dir, 'v7.sqlite')); await migrateReadPolicy(db, join(dir, 'v8.sqlite')); await migrateSourceLists(db, join(dir, 'v9.sqlite')); await migrateCsvImports(db, join(dir, 'v10.sqlite')); await migrateCsvNotes(db, join(dir, 'v11.sqlite')); await migratePageWindows(db, join(dir, 'v12.sqlite'));
  return { dir, path, db, dispose: () => { db.close(); rmSync(dir, { recursive: true, force: true }); } };
}

test('migracja 14 zapisuje strefę Warszawy jako wersję początkową; sklep bez ustawienia jest dobą warszawską', async () => {
  const { dir, path, db, dispose } = await store();
  try {
    assert.equal(readDayZone(db), 'Europe/Warsaw'); // version 13: no setting yet
    await migrateDayZone(db, join(dir, 'v13.sqlite'));
    assert.equal(db.prepare('PRAGMA user_version').get()?.user_version, 14);
    const state = dayZoneState(db);
    assert.deepEqual([state.zone, state.revision, state.rule, state.staleDays, state.history.map((item) => [item.revision, item.zone, item.reason])], ['Europe/Warsaw', 1, 'day-zone-v1', 0, [[1, 'Europe/Warsaw', 'initial']]]);
    verifyTakeout(path);
    // the setting keeps its history: a new version per change, nothing overwritten; the same zone is not a change
    assert.deepEqual(saveDayZone(db, 'UTC', '2026-11-06T10:00:00.000Z'), { changed: true, revision: 2 });
    assert.deepEqual(saveDayZone(db, 'UTC', '2026-11-06T10:01:00.000Z'), { changed: false, revision: 2 });
    assert.throws(() => saveDayZone(db, 'Mars/Base', '2026-11-06T10:02:00.000Z'));
    assert.deepEqual(dayZoneState(db).history.map((item) => [item.revision, item.zone]), [[1, 'Europe/Warsaw'], [2, 'UTC']]);
    verifyTakeout(path);
  } finally { dispose(); }
});

test('zmiana strefy przelicza doby z zapisanych oryginałów jako nowe wersje, bez zera i bez utraty historii', async () => {
  const { dir, path, db, dispose } = await store();
  try {
    await migrateDayZone(db, join(dir, 'v13.sqlite')); await migrateDailySummaries(db, join(dir, 'v14.sqlite'));
    const now = Date.parse('2026-06-12T08:00:00Z'), date = '2026-06-10';
    // the day as Warsaw cuts it: the producer's daily value equals the sum of the day's windows
    read(db, 'steps', date, next(date), [dailySteps(date, 100)]);
    read(db, 'steps-10m', dayBounds(date, 'Europe/Warsaw').start, dayBounds(date, 'Europe/Warsaw').end, stepWindows(date, 'Europe/Warsaw', 100));
    assert.deepEqual(publishGoogleDays(db, date, date, now), { published: 1, unchanged: 0 });
    const warsaw = projectGoogleDays(db, date, date, now)[0]!;
    assert.deepEqual([warsaw.zone, warsaw.metrics.steps.status], ['Europe/Warsaw', 'valid']);
    // publishing again changes nothing (the zone is part of the content, not a reason to republish)
    assert.deepEqual(publishGoogleDays(db, date, date, now), { published: 0, unchanged: 1 });

    const service = new DayZoneService(path, () => false, () => now);
    assert.equal((await service.change('UTC')).changed, true);
    const utc = DayZoneRead(db, date);
    // the windows read for Warsaw bounds do not cover the UTC day: the producer's daily value cannot be matched to it, so the day is
    // incomparable (not valid, not zero), and the originals stay
    assert.deepEqual([utc.revision, utc.zone, utc.steps], [2, 'UTC', 'incomparable']);
    assert.equal(dayZoneState(db).staleDays, 0);
    assert.deepEqual(readDaySeries(db, 'steps', date), null);

    // the windows of the UTC day are read: the same day is valid again in the new zone
    read(db, 'steps-10m', dayBounds(date, 'UTC').start, dayBounds(date, 'UTC').end, stepWindows(date, 'UTC', 100));
    assert.deepEqual(publishGoogleDays(db, date, date, now), { published: 1, unchanged: 0 });
    assert.deepEqual([DayZoneRead(db, date).revision, DayZoneRead(db, date).steps], [3, 'valid']);
    assert.equal(readDaySeries(db, 'steps', date)?.windows, 1);

    // back to Warsaw: the Warsaw reading was never deleted, so the day returns with its original value
    await service.change('Europe/Warsaw');
    assert.deepEqual([DayZoneRead(db, date).revision, DayZoneRead(db, date).zone, DayZoneRead(db, date).steps], [4, 'Europe/Warsaw', 'valid']);
    const history = db.prepare('SELECT revision, json_extract(payload, \'$.zone\') AS zone FROM daily_snapshots WHERE day = ? ORDER BY revision').all(date).map((row) => [row.revision, row.zone]);
    assert.deepEqual(history, [[1, 'Europe/Warsaw'], [2, 'UTC'], [3, 'UTC'], [4, 'Europe/Warsaw']]);
    verifyTakeout(path);
  } finally { dispose(); }
});

function DayZoneRead(db: DatabaseSync, date: string) {
  const row = db.prepare('SELECT revision, payload FROM daily_snapshots WHERE day = ? ORDER BY revision DESC LIMIT 1').get(date)!;
  const payload = JSON.parse(String(row.payload)) as { zone?: string; metrics: { steps: { status: string } } };
  return { revision: Number(row.revision), zone: payload.zone, steps: payload.metrics.steps.status };
}

test('stare snapshoty bez strefy są dobami warszawskimi i czekają na przeliczenie po zmianie strefy', async () => {
  const { dir, path, db, dispose } = await store();
  try {
    await migrateDayZone(db, join(dir, 'v13.sqlite')); await migrateDailySummaries(db, join(dir, 'v14.sqlite'));
    // a snapshot published before version 14 has no zone field
    const legacy = { date: '2026-05-01', metrics: Object.fromEntries(['weight', 'body_fat', 'steps', 'distance', 'total_energy', 'active_energy'].map((key) => [key, { status: 'missing', value: null }])), issues: [], revision: 1, notes: [] };
    db.prepare('INSERT INTO daily_snapshots VALUES (?, 1, ?)').run('2026-05-01', JSON.stringify(legacy));
    assert.deepEqual([dayZoneState(db).days, dayZoneState(db).staleDays], [1, 0]);
    saveDayZone(db, 'Asia/Kolkata', '2026-11-06T10:00:00.000Z');
    // the zone changed but the days were not recomputed yet: the state says so instead of passing the old cut off as new
    assert.deepEqual([dayZoneState(db).zone, dayZoneState(db).staleDays], ['Asia/Kolkata', 1]);
    const service = new DayZoneService(path, () => false, () => Date.parse('2026-06-12T08:00:00Z'));
    // the same request resumes an interrupted recomputation
    const result = await service.change('Asia/Kolkata');
    assert.deepEqual([result.changed, result.staleDays, result.published], [false, 0, 1]);
    assert.equal(DayZoneRead(db, '2026-05-01').zone, 'Asia/Kolkata');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM daily_snapshots WHERE day = ?').get('2026-05-01')?.n, 2);
  } finally { dispose(); }
});

test('serwis nie zmienia strefy podczas odświeżania ani na nieznaną strefę', async () => {
  const { dir, path, db, dispose } = await store();
  try {
    await migrateDayZone(db, join(dir, 'v13.sqlite')); await migrateDailySummaries(db, join(dir, 'v14.sqlite'));
    await assert.rejects(new DayZoneService(path, () => true).change('UTC'), /sync_running/);
    await assert.rejects(new DayZoneService(path).change('Mars/Base'), /invalid_zone/);
    await assert.rejects(new DayZoneService(path).change('+02:00'), /invalid_zone/);
    assert.equal(readDayZone(db), 'Europe/Warsaw');
    assert.equal(new DayZoneService(path).state().zone, 'Europe/Warsaw');
    assert.ok(new DayZoneService(path).state().zones.includes('Asia/Kolkata'));
  } finally { dispose(); }
});

test('planowanie odczytów używa granic doby ze strefy sklepu, a pokrycie nie zależy od podziału na porcje (także przy dobie 23 h)', async () => {
  const { dir, db, dispose } = await store();
  try {
    await migrateDayZone(db, join(dir, 'v13.sqlite')); await migrateDailySummaries(db, join(dir, 'v14.sqlite'));
    saveDayZone(db, 'Asia/Kolkata', '2026-11-06T10:00:00.000Z');
    const plan = planSync(db, '2026-06-10', Date.parse('2026-06-10T09:00:00Z'), 600000);
    const windowed = plan.find((read) => read.kind === 'steps-10m' && read.last === '2026-06-09')!, civilDays = plan.find((read) => read.kind === 'steps' && read.last === '2026-06-09')!;
    // windows hold the UTC bounds of the zone's days (+5:30), producer aggregates keep civil dates
    assert.deepEqual([windowed.begin, windowed.end], ['2026-06-06T18:30:00.000Z', '2026-06-09T18:30:00.000Z']);
    assert.deepEqual([civilDays.begin, civilDays.end], ['2026-06-07', '2026-06-10']);

    saveDayZone(db, 'America/New_York', '2026-11-06T11:00:00.000Z'); // 2026-03-08 has 23 hours there
    const bounds = (first: string, last: string) => [dayBounds(first, 'America/New_York').start, dayBounds(last, 'America/New_York').end] as const;
    const one = (first: string, last: string) => read(db, 'steps-10m', ...bounds(first, last), []);
    one('2026-03-07', '2026-03-09');
    const whole = [...coveredDays(db, 'steps-10m', '2026-03-06', '2026-03-10')];
    db.exec('DELETE FROM google_read_pages; DELETE FROM google_read_jobs');
    one('2026-03-07', '2026-03-07'); one('2026-03-08', '2026-03-08'); one('2026-03-09', '2026-03-09');
    assert.deepEqual([...coveredDays(db, 'steps-10m', '2026-03-06', '2026-03-10')], whole);
    assert.deepEqual(whole, ['2026-03-07', '2026-03-08', '2026-03-09']);
    // a chunk cut by the old zone's bounds covers only the days of the new zone that lie wholly inside it (03-09 ends after the chunk)
    db.exec('DELETE FROM google_read_pages; DELETE FROM google_read_jobs');
    read(db, 'steps-10m', dayBounds('2026-03-07', 'Europe/Warsaw').start, dayBounds('2026-03-09', 'Europe/Warsaw').end, []);
    assert.deepEqual([...coveredDays(db, 'steps-10m', '2026-03-06', '2026-03-10')], ['2026-03-07', '2026-03-08']);
  } finally { dispose(); }
});

test('REST: odczyt i zmiana strefy wymagają sesji, nagłówka żądania i poprawnej strefy', async () => {
  const { dir, path, db, dispose } = await store();
  await migrateDayZone(db, join(dir, 'v13.sqlite')); await migrateDailySummaries(db, join(dir, 'v14.sqlite'));
  const server = createApp(new DatabaseSync(':memory:'), db, undefined, [], undefined, undefined, undefined, undefined, new DayZoneService(path, () => false, () => Date.parse('2026-06-12T08:00:00Z')));
  try {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address(); assert.ok(address && typeof address !== 'string');
    const base = `http://127.0.0.1:${address.port}`;
    assert.equal((await fetch(`${base}/api/settings/day-zone`)).status, 401);
    const cookie = (await fetch(`${base}/api/session`)).headers.get('set-cookie')?.split(';')[0]; assert.ok(cookie);
    const state = await (await fetch(`${base}/api/settings/day-zone`, { headers: { Cookie: cookie } })).json() as { zone: string; revision: number };
    assert.deepEqual([state.zone, state.revision], ['Europe/Warsaw', 1]);
    const post = (body: object, extra: Record<string, string> = { 'X-Trivimo-Request': '1' }) => fetch(`${base}/api/settings/day-zone`, { method: 'POST', headers: { Cookie: cookie, Origin: 'http://localhost:5173', 'Content-Type': 'application/json', ...extra }, body: JSON.stringify(body) });
    assert.equal((await post({ zone: 'UTC' }, {})).status, 403);
    assert.equal((await post({ zone: 'Mars/Base' })).status, 400);
    assert.deepEqual(await (await post({ zone: 'Mars/Base' })).json(), { error: 'invalid_zone' });
    assert.equal((await post({ zone: 'UTC', extra: 1 })).status, 400);
    const changed = await (await post({ zone: 'UTC' })).json() as { zone: string; revision: number; changed: boolean };
    assert.deepEqual([changed.zone, changed.revision, changed.changed], ['UTC', 2, true]);
    assert.equal(readDayZone(db), 'UTC');
  } finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); dispose(); }
});
