import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { initializeTakeoutStore } from '../packages/adapters/takeout/import.ts';
import { warsawDay } from './helpers/warsaw-day.ts';
import { migrateCalorieJobs, migrateCanonicalDays, migrateDailyRollups, migrateGooglePages, migrateReadPolicy, migrateSourceLists, migrateCsvImports, migrateCsvNotes, migratePageWindows, migrateDayZone, migrateSourceAccounts, migrateUserNotes, migrateWindowJobs, readCanonicalDay } from '../packages/storage/canonical-days.ts';
import { compareGoogleDays } from '../packages/storage/google-day-snapshots.ts';
import { readBandShareRange } from '../packages/storage/google-band-share-day.ts';
import { commitGooglePage, createGoogleReadJob, type GoogleJobKind } from '../packages/storage/google-pages.ts';
import { changedDays, GoogleSyncService } from '../apps/server/google-sync.ts';
import { TakeoutService } from '../apps/server/takeout-service.ts';

const account = createHash('sha256').update('synthetic-account').digest('hex');
const civil = (date: string) => { const [year, month, day] = date.split('-').map(Number); return { date: { year, month, day } }; };
const next = (date: string) => new Date(Date.parse(`${date}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
function read(db: DatabaseSync, kind: GoogleJobKind, start: string, end: string, points: unknown[], createdAt: string): string {
  const id = createGoogleReadJob(db, account, kind, start, end);
  // kcalSum is a JSON number in the API; the fixtures write it as text and patch it into a number literal
  commitGooglePage(db, id, null, JSON.stringify({ rollupDataPoints: points }).replace(/"kcalSum":"([\d.]+)"/g, '"kcalSum":$1'));
  db.prepare('UPDATE google_read_jobs SET created_at = ? WHERE id = ?').run(createdAt, id);
  return id;
}
const total = (date: string, kcal: string) => [{ civilStartTime: civil(date), civilEndTime: civil(next(date)), totalCalories: { kcalSum: kcal } }];
function heart(date: string, measured: number) {
  const start = Date.parse(warsawDay(date).start);
  return Array.from({ length: measured }, (_, index) => ({ startTime: new Date(start + index * 600000).toISOString(), endTime: new Date(start + (index + 1) * 600000).toISOString(), heartRate: { beatsPerMinuteAvg: 80 } }));
}

function legacy(date: string) {
  const start = Date.parse(warsawDay(date).start), count = (Date.parse(warsawDay(date).end) - start) / 600000;
  return Array.from({ length: count }, (_, index) => index).filter((index) => index % 30 === 0).map((index) => ({ startTime: new Date(start + index * 600000).toISOString(), endTime: new Date(start + (index + 1) * 600000).toISOString(), totalCalories: { kcalSum: '420.1' } }));
}

async function store() {
  const dir = mkdtempSync(join(tmpdir(), 'trivimo-incremental-')); const path = join(dir, 'db.sqlite'); const db = new DatabaseSync(path);
  initializeTakeoutStore(db);
  await migrateCanonicalDays(db, join(dir, 'v1.sqlite')); await migrateUserNotes(db, join(dir, 'v2.sqlite'));
  await migrateSourceAccounts(db, join(dir, 'v3.sqlite'), true); await migrateGooglePages(db, join(dir, 'v4.sqlite'));
  await migrateDailyRollups(db, join(dir, 'v5.sqlite')); await migrateCalorieJobs(db, join(dir, 'v6.sqlite')); await migrateWindowJobs(db, join(dir, 'v7.sqlite')); await migrateReadPolicy(db, join(dir, 'v8.sqlite')); await migrateSourceLists(db, join(dir, 'v9.sqlite')); await migrateCsvImports(db, join(dir, 'v10.sqlite')); await migrateCsvNotes(db, join(dir, 'v11.sqlite')); await migratePageWindows(db, join(dir, 'v12.sqlite')); await migrateDayZone(db, join(dir, 'v13.sqlite'));
  return { dir, path, db, dispose: () => { db.close(); rmSync(dir, { recursive: true, force: true }); } };
}

test('dni do ponownej projekcji: zakresy dodanych, ukończonych i usuniętych zadań oraz doby od ostatniej projekcji', () => {
  const before = new Map([['job:a', 'steps\t2026-03-01\t2026-03-03'], ['job:b', `heart-rate-10m\t${warsawDay('2026-04-10').start}\t${warsawDay('2026-04-10').end}`], ['job:c', 'steps\t2026-05-01\t2026-05-02']]);
  const after = new Map([['job:a', 'steps\t2026-03-01\t2026-03-03'], ['job:c', 'steps\t2026-05-01\t2026-05-02'], ['job:d', 'distance\t2026-02-27\t2026-03-02']]);
  // b removed (one Warsaw day), d added (clipped to the window start), a and c unchanged; the last projection was on 06-11
  assert.deepEqual(changedDays(before, after, '2026-06-11', '2026-02-28', '2026-06-12', 'Europe/Warsaw'), [['2026-02-28', '2026-03-01'], ['2026-04-10', '2026-04-10'], ['2026-06-11', '2026-06-12']]);
  assert.deepEqual(changedDays(after, after, '2026-06-12', '2026-01-01', '2026-06-12', 'Europe/Warsaw'), [['2026-06-12', '2026-06-12']]);
});

test('projekcja przyrostowa daje te same snapshoty co pełna: nowy odczyt, usunięty nowszy odczyt i koniec doby w toku', async () => {
  const { path, db, dispose } = await store();
  try {
    let clock = Date.parse('2026-06-12T08:00:00Z');
    const service = new GoogleSyncService(path, {} as never, { intervalMinutes: 15, now: () => clock, execute: async () => {} });
    const matches = () => { const result = compareGoogleDays(db, '2026-01-01', '2026-06-13', clock); assert.deepEqual([result.differing, result.unpublished], [[], []]); return result.matched; };
    // windows of the older energy model (a few long intervals), so the day's total is comparable and shown
    read(db, 'total-calories-10m', warsawDay('2026-03-10').start, warsawDay('2026-03-10').end, legacy('2026-03-10'), '2026-03-11T06:00:00.000Z');
    read(db, 'heart-rate-10m', warsawDay('2026-03-10').start, warsawDay('2026-03-10').end, [], '2026-03-11T06:00:00.000Z');
    read(db, 'total-calories', '2026-03-10', '2026-03-11', total('2026-03-10', '1800'), '2026-03-11T06:00:00.000Z');
    read(db, 'total-calories-10m', warsawDay('2026-06-12').start, warsawDay('2026-06-12').end, legacy('2026-06-12'), '2026-06-12T07:50:00.000Z');
    read(db, 'heart-rate-10m', warsawDay('2026-06-12').start, warsawDay('2026-06-12').end, [], '2026-06-12T07:50:00.000Z');
    read(db, 'total-calories', '2026-06-12', '2026-06-13', total('2026-06-12', '900'), '2026-06-12T07:50:00.000Z');
    const first = await service.runOnce();
    assert.deepEqual([first.result, first.energy], ['ok', { published: 2, unchanged: 0 }]);
    assert.equal(matches(), 2);

    // a newer read of an old day (outside the days since the last projection) and a new day
    const newer = read(db, 'total-calories', '2026-03-10', '2026-03-11', total('2026-03-10', '2100'), '2026-06-12T08:05:00.000Z');
    read(db, 'heart-rate-10m', warsawDay('2026-05-20').start, warsawDay('2026-05-20').end, heart('2026-05-20', 3), '2026-06-12T08:06:00.000Z');
    read(db, 'total-calories', '2026-05-20', '2026-05-21', total('2026-05-20', '2000'), '2026-06-12T08:06:00.000Z');
    clock += 15 * 60000;
    const second = await service.runOnce();
    assert.deepEqual(second.energy, { published: 2, unchanged: 1 });
    assert.deepEqual(readCanonicalDay(db, '2026-03-10')?.metrics.total_energy.value, { numerator: '2100', denominator: '1' });
    assert.equal(matches(), 3);

    // the newer read removed again: the older one counts once more
    db.prepare('DELETE FROM google_read_pages WHERE job_id = ?').run(newer);
    db.prepare('DELETE FROM google_read_job_meta WHERE job_id = ?').run(newer);
    db.prepare('DELETE FROM google_read_jobs WHERE id = ?').run(newer);
    clock += 15 * 60000;
    await service.runOnce();
    assert.deepEqual(readCanonicalDay(db, '2026-03-10')?.metrics.total_energy.value, { numerator: '1800', denominator: '1' });
    assert.equal(matches(), 3);

    // no new read: the day read in progress has ended since, so its snapshot changes with time alone
    const before = readCanonicalDay(db, '2026-06-12');
    clock = Date.parse('2026-06-13T08:00:00Z');
    const later = await service.runOnce();
    assert.deepEqual(later.energy, { published: 1, unchanged: 0 });
    assert.equal(readCanonicalDay(db, '2026-06-12')?.revision, (before?.revision ?? 0) + 1);
    assert.equal(matches(), 3);
  } finally { dispose(); }
});

test('zapamiętane strony okien: klucz to digest treści, różne strony nie mieszają się, a ta sama treść daje ten sam wynik', async () => {
  const { db, dispose } = await store();
  try {
    read(db, 'heart-rate-10m', warsawDay('2026-05-20').start, warsawDay('2026-05-20').end, heart('2026-05-20', 3), '2026-05-21T06:00:00.000Z');
    read(db, 'heart-rate-10m', warsawDay('2026-05-21').start, warsawDay('2026-05-21').end, heart('2026-05-21', 5), '2026-05-22T06:00:00.000Z');
    const windows = () => readBandShareRange(db, '2026-05-20', '2026-05-21').map((day) => day.heartRate?.windows ?? null);
    assert.deepEqual(windows(), [3, 5]);
    assert.deepEqual(windows(), [3, 5]);
    // a newer read of 05-20 with other content wins, also after the older page was cached
    read(db, 'heart-rate-10m', warsawDay('2026-05-20').start, warsawDay('2026-05-20').end, heart('2026-05-20', 7), '2026-05-23T06:00:00.000Z');
    assert.deepEqual(windows(), [7, 5]);
  } finally { dispose(); }
});

test('podgląd importu odrzuca ścieżki UNC i urządzeń zanim dotknie dysku', async () => {
  const service = new TakeoutService(join(tmpdir(), 'trivimo-unused', 'db.sqlite'));
  for (const path of ['\\\\host\\share\\Takeout', '//host/share/Takeout', '\\\\?\\C:\\Takeout', '\\\\.\\C:\\Takeout']) await assert.rejects(service.preview(path), /invalid_directory/);
});
