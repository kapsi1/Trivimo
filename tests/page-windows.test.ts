import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { initializeTakeoutStore } from '../packages/adapters/takeout/import.ts';
import { warsawDay } from '../packages/domain/warsaw-day.ts';
import { migrateCalorieJobs, migrateCanonicalDays, migrateDailyRollups, migrateGooglePages, migratePageWindows, migrateReadPolicy, migrateSourceLists, migrateCsvImports, migrateCsvNotes, migrateSourceAccounts, migrateUserNotes, migrateWindowJobs } from '../packages/storage/canonical-days.ts';
import { commitGooglePage, createGoogleReadJob, type GoogleJobKind } from '../packages/storage/google-pages.ts';
import { pageParsers, removeUnusedPageWindows } from '../packages/storage/google-page-windows.ts';
import { applyReadPolicy, registerAutomaticJob } from '../packages/storage/google-read-policy.ts';
import { savedWindows, warsawDays } from '../packages/storage/google-band-share-day.ts';
import { readHeartRateDay } from '../packages/storage/google-heart-rate.ts';
import { verifyTakeout } from '../packages/storage/verify-takeout.ts';

const account = createHash('sha256').update('synthetic-account').digest('hex');
/** Ten-minute step windows of a Warsaw day; `seed` makes the page content (and digest) unique to the test. */
function steps(date: string, count: number, seed: number) {
  const start = Date.parse(warsawDay(date).start);
  return Array.from({ length: count }, (_, index) => ({ startTime: new Date(start + index * 600000).toISOString(), endTime: new Date(start + (index + 1) * 600000).toISOString(), steps: { countSum: String(seed * 100 + index) } }));
}
function heart(date: string, count: number, bpm: number) {
  const start = Date.parse(warsawDay(date).start);
  return Array.from({ length: count }, (_, index) => ({ startTime: new Date(start + index * 600000).toISOString(), endTime: new Date(start + (index + 1) * 600000).toISOString(), heartRate: { beatsPerMinuteAvg: bpm, beatsPerMinuteMin: bpm - 5, beatsPerMinuteMax: bpm + 5 } }));
}
function read(db: DatabaseSync, kind: GoogleJobKind, date: string, points: unknown[]): string {
  const id = createGoogleReadJob(db, account, kind, warsawDay(date).start, warsawDay(date).end);
  commitGooglePage(db, id, null, JSON.stringify({ rollupDataPoints: points }));
  return id;
}
async function v12() {
  const dir = mkdtempSync(join(tmpdir(), 'trivimo-windows-')); const path = join(dir, 'db.sqlite'); const db = new DatabaseSync(path);
  initializeTakeoutStore(db);
  await migrateCanonicalDays(db, join(dir, 'v1.sqlite')); await migrateUserNotes(db, join(dir, 'v2.sqlite'));
  await migrateSourceAccounts(db, join(dir, 'v3.sqlite'), true); await migrateGooglePages(db, join(dir, 'v4.sqlite'));
  await migrateDailyRollups(db, join(dir, 'v5.sqlite')); await migrateCalorieJobs(db, join(dir, 'v6.sqlite')); await migrateWindowJobs(db, join(dir, 'v7.sqlite')); await migrateReadPolicy(db, join(dir, 'v8.sqlite')); await migrateSourceLists(db, join(dir, 'v9.sqlite')); await migrateCsvImports(db, join(dir, 'v10.sqlite')); await migrateCsvNotes(db, join(dir, 'v11.sqlite'));
  return { dir, path, db, dispose: () => { db.close(); rmSync(dir, { recursive: true, force: true }); } };
}
const rows = (db: DatabaseSync) => db.prepare('SELECT parser FROM google_page_windows ORDER BY parser').all().map((row) => String(row.parser));

test('migracja 12→13: kopia, okna pochodne każdej zapisanej strony okien równe parserowi, oryginały bez zmian', async () => {
  const { dir, path, db, dispose } = await v12();
  try {
    read(db, 'steps-10m', '2026-05-01', steps('2026-05-01', 4, 1));
    read(db, 'heart-rate-10m', '2026-05-01', heart('2026-05-01', 3, 80));
    const daily = createGoogleReadJob(db, account, 'steps', '2026-05-01', '2026-05-02');
    commitGooglePage(db, daily, null, JSON.stringify({ rollupDataPoints: [] }));
    const pages = db.prepare('SELECT job_id, page_number, raw_json, digest FROM google_read_pages ORDER BY job_id').all().map((row) => ({ ...row }));
    await migratePageWindows(db, join(dir, 'v12.sqlite'));
    assert.ok(existsSync(join(dir, 'v12.sqlite')));
    assert.equal(db.prepare('PRAGMA user_version').get()?.user_version, 13);
    // the daily page has no derived windows; the heart-rate page has both its parsers
    assert.deepEqual(rows(db), ['heart-rate-detail@1', 'window:heart-rate@1', 'window:steps@1']);
    assert.deepEqual(db.prepare('SELECT job_id, page_number, raw_json, digest FROM google_read_pages ORDER BY job_id').all().map((row) => ({ ...row })), pages);
    verifyTakeout(path);
  } finally { dispose(); }
});

test('okna pochodne: zapis razem ze stroną, odczyt z warstwy, usunięcie po polityce i wykrycie niezgodności przy weryfikacji', async () => {
  const { dir, path, db, dispose } = await v12();
  try {
    await migratePageWindows(db, join(dir, 'v12.sqlite'));
    const first = read(db, 'steps-10m', '2026-05-02', steps('2026-05-02', 3, 2));
    assert.deepEqual(rows(db), ['window:steps@1']);
    const day = warsawDays('2026-05-02', '2026-05-02');
    assert.deepEqual(savedWindows(db, 'steps-10m', 'steps', day).get('2026-05-02')?.map((window) => window.value), ['200', '201', '202']);
    const heartJob = read(db, 'heart-rate-10m', '2026-05-03', heart('2026-05-03', 2, 91));
    assert.deepEqual(readHeartRateDay(db, '2026-05-03')?.windows.map((window) => [window.avg, window.min, window.max]), [[91, 86, 96], [91, 86, 96]]);
    assert.ok(heartJob);

    // the read takes the derived row (a page not yet seen by this process): a changed row is what the read returns,
    // and the restore check refuses it because it no longer equals the parser's output of the original
    const other = read(db, 'steps-10m', '2026-05-04', steps('2026-05-04', 2, 4));
    const digest = String(db.prepare('SELECT digest FROM google_read_pages WHERE job_id = ?').get(other)?.digest);
    const changed = JSON.stringify(pageParsers['window:steps@1'](String(db.prepare('SELECT raw_json FROM google_read_pages WHERE job_id = ?').get(other)?.raw_json)).map((window) => ({ ...window, value: '7' })));
    db.prepare("UPDATE google_page_windows SET windows = ? WHERE digest = ? AND parser = 'window:steps@1'").run(changed, digest);
    assert.deepEqual(savedWindows(db, 'steps-10m', 'steps', warsawDays('2026-05-04', '2026-05-04')).get('2026-05-04')?.map((window) => window.value), ['7', '7']);
    assert.throws(() => verifyTakeout(path), /invalid_page_windows/);
    // restored to the parser's output of the original, the store passes again
    db.prepare("UPDATE google_page_windows SET windows = ? WHERE digest = ? AND parser = 'window:steps@1'").run(JSON.stringify(pageParsers['window:steps@1'](String(db.prepare('SELECT raw_json FROM google_read_pages WHERE job_id = ?').get(other)?.raw_json))), digest);
    verifyTakeout(path);

    // a newer automatic read replaces the older one: its page goes, and so do derived rows no other page uses
    registerAutomaticJob(db, first);
    const newer = read(db, 'steps-10m', '2026-05-02', steps('2026-05-02', 3, 5));
    registerAutomaticJob(db, newer);
    const before = db.prepare("SELECT COUNT(*) AS n FROM google_page_windows WHERE parser = 'window:steps@1'").get()?.n;
    applyReadPolicy(db, newer, Date.parse('2026-06-01T00:00:00Z'));
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM google_read_jobs WHERE id = ?').get(first)?.n, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM google_page_windows WHERE parser = 'window:steps@1'").get()?.n, Number(before) - 1);
    verifyTakeout(path);
  } finally { dispose(); }
});

test('okna pochodne: ta sama treść strony w zadaniach różnych rodzajów (np. pusta strona) ma wiersze każdego z nich', async () => {
  const { dir, path, db, dispose } = await v12();
  try {
    await migratePageWindows(db, join(dir, 'v12.sqlite'));
    read(db, 'steps-10m', '2026-05-05', []);
    const heartJob = read(db, 'heart-rate-10m', '2026-05-05', []);
    const digest = String(db.prepare('SELECT digest FROM google_read_pages WHERE job_id = ?').get(heartJob)?.digest);
    assert.equal(db.prepare('SELECT COUNT(DISTINCT digest) AS n FROM google_read_pages').get()?.n, 1);
    assert.deepEqual(rows(db), ['heart-rate-detail@1', 'window:heart-rate@1', 'window:steps@1']);
    verifyTakeout(path);
    // the heart-rate page goes: its rows go, the steps row of the same text stays
    db.prepare('DELETE FROM google_read_pages WHERE job_id = ?').run(heartJob);
    db.prepare('DELETE FROM google_read_jobs WHERE id = ?').run(heartJob);
    removeUnusedPageWindows(db, [digest]);
    assert.deepEqual(rows(db), ['window:steps@1']);
    verifyTakeout(path);
    db.prepare('DELETE FROM google_page_windows').run();
    assert.throws(() => verifyTakeout(path), /missing_page_windows/);
  } finally { dispose(); }
});
